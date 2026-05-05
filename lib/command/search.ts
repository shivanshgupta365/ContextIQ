import { fullRecall } from "@/lib/hydradb/client";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  CommandSearchHit,
  CommandSearchRequest,
  CommandSearchResponse,
  IntegrationProvider,
  RecalledMemory,
} from "@/types";

type SearchRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string | null;
  body: string;
  normalized_payload: Record<string, unknown> | null;
  synced_at: string | null;
};

type SearchScope = {
  accountId: string | null;
  contactId: string | null;
  organizationId: string | null;
  personId: string | null;
};

type ScopedStructuredInput = {
  id: string;
  type: CommandSearchHit["type"];
  title: string;
  snippet: string;
  occurredAt: string | null;
  provider: IntegrationProvider | null;
  query: string;
  href?: string | null;
  accountId?: string | null;
  contactId?: string | null;
};

function tokenizeQuery(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9@._-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreTextMatch(query: string, haystack: string) {
  const normalizedHaystack = haystack.toLowerCase();
  const tokens = tokenizeQuery(query);

  if (tokens.length === 0) return 0;

  let score = 0;
  for (const token of tokens) {
    if (normalizedHaystack.includes(token)) {
      score += token.length >= 6 ? 2 : 1;
    }
  }

  if (normalizedHaystack.includes(query.toLowerCase())) {
    score += 3;
  }

  return score;
}

function scoreRecency(occurredAt: string | null | undefined) {
  if (!occurredAt) return 0;
  const timestamp = new Date(occurredAt).getTime();
  if (Number.isNaN(timestamp)) return 0;
  const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  if (ageDays <= 3) return 1.2;
  if (ageDays <= 14) return 0.8;
  if (ageDays <= 30) return 0.4;
  return 0.1;
}

function mapProvider(value: string | null | undefined): IntegrationProvider | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["gmail", "outlook", "slack", "linkedin", "manual"].includes(normalized)) {
    return normalized as IntegrationProvider;
  }
  return null;
}

function buildHref(input: {
  type: CommandSearchHit["type"];
  entityId: string;
  accountId?: string | null;
  contactId?: string | null;
}) {
  if (input.accountId) {
    if (input.contactId) {
      return `/accounts/${input.accountId}?contact=${encodeURIComponent(input.contactId)}`;
    }
    return `/accounts/${input.accountId}`;
  }

  switch (input.type) {
    case "organization":
      return `/accounts/${input.entityId}`;
    case "person":
      return "/people";
    case "conversation":
    case "message":
      return "/conversations";
    case "meeting":
      return "/meetings";
    case "document":
    case "note":
      return "/notes-briefs";
    case "activity":
      return "/activity-audit";
    default:
      return "/command-center";
  }
}

function buildHydraHit(memory: RecalledMemory): CommandSearchHit | null {
  if (!memory.content.trim()) return null;

  const entityType = (memory.metadata.entity_type || "note") as CommandSearchHit["type"];
  const accountId = memory.metadata.account_id ?? null;
  const contactId = memory.metadata.contact_id ?? null;

  return {
    id: `hydra-${memory.id ?? crypto.randomUUID()}`,
    type: entityType,
    title:
      memory.metadata.account_name ||
      memory.metadata.contact_name ||
      memory.metadata.topic ||
      "Recalled memory",
    snippet: memory.content.slice(0, 280),
    provider: memory.metadata.integration_source ?? null,
    occurredAt: memory.metadata.created_at,
    relevance: Number(memory.score ?? 0.95),
    href: buildHref({
      type: entityType,
      entityId: memory.id ?? "",
      accountId,
      contactId,
    }),
    accountId,
    contactId,
    ref: {
      entity_type: entityType,
      entity_id: memory.id ?? "",
      provider: memory.metadata.integration_source ?? null,
    },
  };
}

function buildIndexedHit(row: SearchRow, query: string): CommandSearchHit | null {
  const body = `${row.title ?? ""}\n${row.body}`.trim();
  const score = scoreTextMatch(query, body) + scoreRecency(row.synced_at);

  if (score <= 0) return null;

  const provider = mapProvider(String(row.normalized_payload?.provider ?? ""));
  const accountId =
    typeof row.normalized_payload?.account_id === "string"
      ? (row.normalized_payload.account_id as string)
      : null;
  const contactId =
    typeof row.normalized_payload?.contact_id === "string"
      ? (row.normalized_payload.contact_id as string)
      : null;

  return {
    id: `index-${row.id}`,
    type: row.entity_type as CommandSearchHit["type"],
    title: row.title ?? "Context entry",
    snippet: row.body.slice(0, 280),
    provider,
    occurredAt: row.synced_at,
    relevance: score,
    href: buildHref({
      type: row.entity_type as CommandSearchHit["type"],
      entityId: row.entity_id,
      accountId,
      contactId,
    }),
    accountId,
    contactId,
    ref: {
      entity_type: row.entity_type as CommandSearchHit["type"],
      entity_id: row.entity_id,
      provider,
    },
  };
}

function buildStructuredHit(input: ScopedStructuredInput): CommandSearchHit | null {
  const score =
    scoreTextMatch(input.query, `${input.title}\n${input.snippet}`) +
    scoreRecency(input.occurredAt);

  if (score <= 0) return null;

  return {
    id: `${input.type}-${input.id}`,
    type: input.type,
    title: input.title,
    snippet: input.snippet.slice(0, 280),
    provider: input.provider,
    occurredAt: input.occurredAt,
    relevance: score,
    href:
      input.href ??
      buildHref({
        type: input.type,
        entityId: input.id,
        accountId: input.accountId,
        contactId: input.contactId,
      }),
    accountId: input.accountId ?? null,
    contactId: input.contactId ?? null,
    ref: {
      entity_type: input.type,
      entity_id: input.id,
      provider: input.provider,
    },
  };
}

function dedupeHits(hits: CommandSearchHit[], limit: number) {
  const seen = new Set<string>();
  const deduped: CommandSearchHit[] = [];

  for (const hit of hits.sort((left, right) => right.relevance - left.relevance)) {
    const key = `${hit.ref.entity_type}:${hit.ref.entity_id}:${hit.provider ?? "none"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(hit);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

function hitMatchesScope(hit: CommandSearchHit, scope: SearchScope): boolean {
  if (!scope.accountId && !scope.contactId && !scope.organizationId && !scope.personId) {
    return true;
  }

  if (scope.personId && hit.ref.entity_type === "person" && hit.ref.entity_id === scope.personId) {
    return true;
  }
  if (scope.contactId && hit.contactId === scope.contactId) return true;
  if (scope.accountId && hit.accountId === scope.accountId) return true;
  if (
    scope.organizationId &&
    hit.ref.entity_type === "organization" &&
    hit.ref.entity_id === scope.organizationId
  ) {
    return true;
  }

  return false;
}

function hitToMemory(hit: CommandSearchHit, query: string): RecalledMemory {
  return {
    id: hit.id,
    content: hit.snippet,
    metadata: {
      workspace_id: "search",
      account_id: hit.accountId ?? "",
      contact_id: hit.contactId ?? null,
      source_type: `${hit.type}_search_hit`,
      topic: query,
      importance_level: hit.relevance >= 5 ? "high" : "medium",
      stage: null,
      created_at: hit.occurredAt ?? new Date().toISOString(),
      entity_type: hit.type,
      account_name: hit.type === "organization" ? hit.title : null,
      contact_name: hit.type === "person" ? hit.title : null,
      contact_role_type: null,
      integration_source:
        hit.provider === "gmail" ||
        hit.provider === "linkedin" ||
        hit.provider === "outlook" ||
        hit.provider === "slack"
          ? hit.provider
          : null,
    },
    score: hit.relevance,
  };
}

export async function runCommandSearch(
  input: CommandSearchRequest,
): Promise<CommandSearchResponse> {
  const supabase = await getSupabaseServerClient();
  const limit = Math.max(1, Math.min(input.limit ?? 12, 50));
  const timeframeDays = Math.max(1, Math.min(input.timeframeDays ?? 30, 365));
  const sinceIso = new Date(
    Date.now() - timeframeDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [organizationsResult, accountsResult, contactsResult, peopleResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("id,account_id")
      .eq("workspace_id", input.workspaceId),
    supabase
      .from("accounts")
      .select("id,name,domain,industry,owner_name,stage,priority,last_contacted_at")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("contacts")
      .select("id,account_id,name,email,title,role_type,updated_at")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(120),
    supabase
      .from("people")
      .select("id,contact_id,organization_id,full_name,email,title,source_provider,updated_at")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(120),
  ]);

  if (organizationsResult.error) throw organizationsResult.error;
  if (accountsResult.error) throw accountsResult.error;
  if (contactsResult.error) throw contactsResult.error;
  if (peopleResult.error) throw peopleResult.error;

  const organizations = (organizationsResult.data ?? []) as Array<Record<string, unknown>>;
  const accounts = (accountsResult.data ?? []) as Array<Record<string, unknown>>;
  const contacts = (contactsResult.data ?? []) as Array<Record<string, unknown>>;
  const people = (peopleResult.data ?? []) as Array<Record<string, unknown>>;

  const accountById = new Map(accounts.map((account) => [String(account.id), account]));
  const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));
  const organizationToAccountId = new Map<string, string>();
  const accountToOrganizationId = new Map<string, string>();

  for (const organization of organizations) {
    const organizationId = String(organization.id);
    const accountId =
      typeof organization.account_id === "string" ? String(organization.account_id) : null;
    if (!accountId) continue;
    organizationToAccountId.set(organizationId, accountId);
    if (!accountToOrganizationId.has(accountId)) {
      accountToOrganizationId.set(accountId, organizationId);
    }
  }

  const personMetaById = new Map(
    people.map((person) => {
      const organizationId =
        typeof person.organization_id === "string" ? String(person.organization_id) : null;
      const contactId = typeof person.contact_id === "string" ? String(person.contact_id) : null;
      const linkedContact = contactId ? contactById.get(contactId) : null;
      const accountId =
        (organizationId ? organizationToAccountId.get(organizationId) : null) ??
        (typeof linkedContact?.account_id === "string" ? String(linkedContact.account_id) : null);

      return [
        String(person.id),
        {
          personId: String(person.id),
          contactId,
          organizationId,
          accountId,
        },
      ];
    }),
  );

  const scope: SearchScope = {
    accountId: input.accountId ?? null,
    contactId: null,
    organizationId: input.accountId ? accountToOrganizationId.get(input.accountId) ?? null : null,
    personId: input.personId ?? null,
  };

  if (input.personId) {
    const personScope = personMetaById.get(input.personId);
    if (personScope) {
      scope.personId = personScope.personId;
      scope.contactId = personScope.contactId;
      scope.organizationId = personScope.organizationId;
      scope.accountId = personScope.accountId ?? scope.accountId;
    }
  }

  let degraded = false;
  let degradedReason: string | null = null;
  const hydraHits = await (async () => {
    if (!input.hydraTenantId) return [] as CommandSearchHit[];
    try {
      const recalled = await fullRecall({
        tenantId: input.hydraTenantId,
        query: input.query,
        filters: {
          workspace_id: input.workspaceId,
          ...(scope.accountId ? { account_id: scope.accountId } : {}),
          ...(scope.contactId ? { contact_id: scope.contactId } : {}),
        },
        topK: Math.max(limit, 8),
      });
      return recalled
        .map(buildHydraHit)
        .filter((hit): hit is CommandSearchHit => Boolean(hit))
        .filter((hit) => hitMatchesScope(hit, scope));
    } catch (error) {
      degraded = true;
      degradedReason = error instanceof Error ? error.message : "Hydra recall failed";
      console.error("Hydra command recall failed", error);
      return [] as CommandSearchHit[];
    }
  })();

  const [
    indexResult,
    messagesResult,
    conversationsResult,
    notesResult,
    activitiesResult,
    meetingsResult,
    documentsResult,
  ] = await Promise.all([
    supabase
      .from("search_index_entries")
      .select("id,entity_type,entity_id,title,body,normalized_payload,synced_at")
      .eq("workspace_id", input.workspaceId)
      .gte("synced_at", sinceIso)
      .order("synced_at", { ascending: false })
      .limit(240),
    supabase
      .from("messages")
      .select("id,body,sent_at,normalized_payload,direction,organization_id,person_id")
      .eq("workspace_id", input.workspaceId)
      .gte("sent_at", sinceIso)
      .order("sent_at", { ascending: false })
      .limit(120),
    supabase
      .from("conversations")
      .select("id,subject,channel,last_message_at,normalized_payload,organization_id,person_id")
      .eq("workspace_id", input.workspaceId)
      .gte("last_message_at", sinceIso)
      .order("last_message_at", { ascending: false })
      .limit(80),
    supabase
      .from("notes")
      .select("id,title,content,created_at,topic,source_type,account_id,contact_id")
      .eq("workspace_id", input.workspaceId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("activities")
      .select("id,title,description,occurred_at,activity_type,metadata,account_id,contact_id")
      .eq("workspace_id", input.workspaceId)
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: false })
      .limit(80),
    supabase
      .from("meetings")
      .select("id,topic,starts_at,status,source_provider,organization_id,attendee_person_ids")
      .eq("workspace_id", input.workspaceId)
      .order("starts_at", { ascending: false })
      .limit(80),
    supabase
      .from("documents")
      .select("id,title,body,kind,updated_at,source_provider,organization_id,person_id")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(80),
  ]);

  if (indexResult.error) throw indexResult.error;
  if (messagesResult.error) throw messagesResult.error;
  if (conversationsResult.error) throw conversationsResult.error;
  if (notesResult.error) throw notesResult.error;
  if (activitiesResult.error) throw activitiesResult.error;
  if (meetingsResult.error) throw meetingsResult.error;
  if (documentsResult.error) throw documentsResult.error;

  const indexedHits = ((indexResult.data ?? []) as SearchRow[])
    .map((row) => buildIndexedHit(row, input.query))
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const messageHits = ((messagesResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const personId = typeof row.person_id === "string" ? String(row.person_id) : null;
      const personMeta = personId ? personMetaById.get(personId) : null;
      const organizationId =
        typeof row.organization_id === "string" ? String(row.organization_id) : null;
      return buildStructuredHit({
        id: String(row.id),
        type: "message",
        title: `Message (${String(row.direction ?? "unknown")})`,
        snippet: String(row.body ?? ""),
        occurredAt: (row.sent_at as string | null) ?? null,
        provider: mapProvider(
          String((row.normalized_payload as Record<string, unknown> | null)?.provider ?? ""),
        ),
        query: input.query,
        accountId:
          (organizationId ? organizationToAccountId.get(organizationId) || null : null) ||
          personMeta?.accountId ||
          null,
        contactId: personMeta?.contactId ?? null,
      });
    })
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const conversationHits = ((conversationsResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const personId = typeof row.person_id === "string" ? String(row.person_id) : null;
      const personMeta = personId ? personMetaById.get(personId) : null;
      const organizationId =
        typeof row.organization_id === "string" ? String(row.organization_id) : null;
      return buildStructuredHit({
        id: String(row.id),
        type: "conversation",
        title: String(row.subject ?? `Conversation (${String(row.channel ?? "channel")})`),
        snippet: String(row.channel ?? "Conversation"),
        occurredAt: (row.last_message_at as string | null) ?? null,
        provider: mapProvider(
          String((row.normalized_payload as Record<string, unknown> | null)?.provider ?? ""),
        ),
        query: input.query,
        accountId:
          (organizationId ? organizationToAccountId.get(organizationId) || null : null) ||
          personMeta?.accountId ||
          null,
        contactId: personMeta?.contactId ?? null,
      });
    })
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const noteHits = ((notesResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) =>
      buildStructuredHit({
        id: String(row.id),
        type: "note",
        title: String(row.title ?? row.topic ?? "Workspace note"),
        snippet: String(row.content ?? ""),
        occurredAt: (row.created_at as string | null) ?? null,
        provider:
          String(row.source_type ?? "").includes("email") ||
          String(row.topic ?? "").toLowerCase().includes("gmail")
            ? "gmail"
            : String(row.topic ?? "").toLowerCase().includes("outlook")
              ? "outlook"
              : String(row.topic ?? "").toLowerCase().includes("linkedin")
                ? "linkedin"
                : String(row.topic ?? "").toLowerCase().includes("slack")
                  ? "slack"
                  : String(row.source_type ?? "").includes("uploaded")
                    ? "manual"
                    : null,
        query: input.query,
        accountId: (row.account_id as string | null) ?? null,
        contactId: (row.contact_id as string | null) ?? null,
      }),
    )
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const activityHits = ((activitiesResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) =>
      buildStructuredHit({
        id: String(row.id),
        type: "activity",
        title: String(row.title ?? "Activity"),
        snippet: String(row.description ?? ""),
        occurredAt: (row.occurred_at as string | null) ?? null,
        provider: mapProvider(
          String((row.metadata as Record<string, unknown> | null)?.integration_source ?? ""),
        ),
        query: input.query,
        accountId: (row.account_id as string | null) ?? null,
        contactId: (row.contact_id as string | null) ?? null,
      }),
    )
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const accountHits = accounts
    .map((row) =>
      buildStructuredHit({
        id: String(row.id),
        type: "organization",
        title: String(row.name ?? "Account"),
        snippet: [row.domain, row.industry, row.owner_name, row.stage, row.priority]
          .filter(Boolean)
          .join(" • "),
        occurredAt: (row.last_contacted_at as string | null) ?? null,
        provider: "manual",
        query: input.query,
        accountId: String(row.id),
      }),
    )
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const contactHits = contacts
    .map((row) =>
      buildStructuredHit({
        id: String(row.id),
        type: "person",
        title: String(row.name ?? "Contact"),
        snippet: [row.email, row.title, row.role_type].filter(Boolean).join(" • "),
        occurredAt: (row.updated_at as string | null) ?? null,
        provider: "manual",
        query: input.query,
        accountId: (row.account_id as string | null) ?? null,
        contactId: String(row.id),
      }),
    )
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const peopleHits = people
    .map((row) => {
      const linkedContact =
        typeof row.contact_id === "string" ? contactById.get(String(row.contact_id)) : null;
      const organizationId =
        typeof row.organization_id === "string" ? String(row.organization_id) : null;
      const accountId =
        (organizationId ? organizationToAccountId.get(organizationId) || null : null) ||
        (typeof linkedContact?.account_id === "string" ? String(linkedContact.account_id) : null);
      return buildStructuredHit({
        id: String(row.id),
        type: "person",
        title: String(row.full_name ?? linkedContact?.name ?? "Person"),
        snippet: [row.email, row.title, linkedContact?.role_type].filter(Boolean).join(" • "),
        occurredAt: (row.updated_at as string | null) ?? null,
        provider: mapProvider(String(row.source_provider ?? "")),
        query: input.query,
        accountId,
        contactId:
          typeof row.contact_id === "string" ? String(row.contact_id) : null,
      });
    })
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const meetingHits = ((meetingsResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const organizationId =
        typeof row.organization_id === "string" ? String(row.organization_id) : null;
      return buildStructuredHit({
        id: String(row.id),
        type: "meeting",
        title: String(row.topic ?? "Meeting"),
        snippet: String(row.status ?? "meeting"),
        occurredAt: (row.starts_at as string | null) ?? null,
        provider: mapProvider(String(row.source_provider ?? "")),
        query: input.query,
        accountId: organizationId ? organizationToAccountId.get(organizationId) ?? null : null,
      });
    })
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const documentHits = ((documentsResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const personId = typeof row.person_id === "string" ? String(row.person_id) : null;
      const personMeta = personId ? personMetaById.get(personId) : null;
      const organizationId =
        typeof row.organization_id === "string" ? String(row.organization_id) : null;
      return buildStructuredHit({
        id: String(row.id),
        type: "document",
        title: String(row.title ?? "Document"),
        snippet: [row.kind, row.body].filter(Boolean).join("\n"),
        occurredAt: (row.updated_at as string | null) ?? null,
        provider: mapProvider(String(row.source_provider ?? "")),
        query: input.query,
        accountId:
          (organizationId ? organizationToAccountId.get(organizationId) || null : null) ||
          personMeta?.accountId ||
          null,
        contactId: personMeta?.contactId ?? null,
      });
    })
    .filter((hit): hit is CommandSearchHit => Boolean(hit))
    .filter((hit) => hitMatchesScope(hit, scope));

  const hits = dedupeHits(
    [
      ...hydraHits,
      ...indexedHits,
      ...accountHits,
      ...contactHits,
      ...peopleHits,
      ...meetingHits,
      ...documentHits,
      ...messageHits,
      ...conversationHits,
      ...noteHits,
      ...activityHits,
    ],
    limit,
  );

  return {
    query: input.query,
    hits,
    degraded,
    degraded_reason: degradedReason,
    memories: hits
      .filter((hit) => hit.accountId != null || hit.contactId != null)
      .slice(0, 6)
      .map((hit) => hitToMemory(hit, input.query)),
  };
}
