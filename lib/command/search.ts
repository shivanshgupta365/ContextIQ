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

function buildHydraHit(memory: RecalledMemory): CommandSearchHit | null {
  if (!memory.content.trim()) return null;

  return {
    id: `hydra-${memory.id ?? crypto.randomUUID()}`,
    type: (memory.metadata.entity_type || "note") as CommandSearchHit["type"],
    title:
      memory.metadata.account_name ||
      memory.metadata.contact_name ||
      memory.metadata.topic ||
      "Recalled memory",
    snippet: memory.content.slice(0, 280),
    provider: memory.metadata.integration_source ?? null,
    occurredAt: memory.metadata.created_at,
    relevance: Number(memory.score ?? 0.95),
    ref: {
      entity_type: (memory.metadata.entity_type || "note") as CommandSearchHit["type"],
      entity_id: memory.id ?? "",
      provider: memory.metadata.integration_source ?? null,
    },
  };
}

function buildIndexedHit(row: SearchRow, query: string): CommandSearchHit | null {
  const body = `${row.title ?? ""}\n${row.body}`.trim();
  const score = scoreTextMatch(query, body) + scoreRecency(row.synced_at);

  if (score <= 0) return null;

  const provider = ((row.normalized_payload?.provider as string | undefined) ??
    null) as IntegrationProvider | null;

  return {
    id: `index-${row.id}`,
    type: row.entity_type as CommandSearchHit["type"],
    title: row.title ?? "Context entry",
    snippet: row.body.slice(0, 280),
    provider,
    occurredAt: row.synced_at,
    relevance: score,
    ref: {
      entity_type: row.entity_type as CommandSearchHit["type"],
      entity_id: row.entity_id,
      provider,
    },
  };
}

function buildStructuredHit(input: {
  id: string;
  type: CommandSearchHit["type"];
  title: string;
  snippet: string;
  occurredAt: string | null;
  provider: IntegrationProvider | null;
  query: string;
}): CommandSearchHit | null {
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

export async function runCommandSearch(
  input: CommandSearchRequest,
): Promise<CommandSearchResponse> {
  const supabase = await getSupabaseServerClient();
  const limit = Math.max(1, Math.min(input.limit ?? 12, 50));
  const timeframeDays = Math.max(1, Math.min(input.timeframeDays ?? 30, 365));
  const sinceIso = new Date(
    Date.now() - timeframeDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const hydraHits = await (async () => {
    if (!input.hydraTenantId) return [] as CommandSearchHit[];
    try {
      const recalled = await fullRecall({
        tenantId: input.hydraTenantId,
        query: input.query,
        filters: {
          workspace_id: input.workspaceId,
          ...(input.accountId ? { account_id: input.accountId } : {}),
          ...(input.personId ? { contact_id: input.personId } : {}),
        },
        topK: Math.max(limit, 8),
      });
      return recalled
        .map(buildHydraHit)
        .filter((hit): hit is CommandSearchHit => Boolean(hit));
    } catch (error) {
      console.error("Hydra command recall failed", error);
      return [] as CommandSearchHit[];
    }
  })();

  const [indexResult, messagesResult, conversationsResult, notesResult, activitiesResult] =
    await Promise.all([
      supabase
        .from("search_index_entries")
        .select("id,entity_type,entity_id,title,body,normalized_payload,synced_at")
        .eq("workspace_id", input.workspaceId)
        .gte("synced_at", sinceIso)
        .order("synced_at", { ascending: false })
        .limit(200),
      supabase
        .from("messages")
        .select("id,body,sent_at,normalized_payload,direction")
        .eq("workspace_id", input.workspaceId)
        .gte("sent_at", sinceIso)
        .order("sent_at", { ascending: false })
        .limit(120),
      supabase
        .from("conversations")
        .select("id,subject,channel,last_message_at,normalized_payload")
        .eq("workspace_id", input.workspaceId)
        .gte("last_message_at", sinceIso)
        .order("last_message_at", { ascending: false })
        .limit(80),
      supabase
        .from("notes")
        .select("id,title,content,created_at,topic,source_type")
        .eq("workspace_id", input.workspaceId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("activities")
        .select("id,title,description,occurred_at,activity_type,metadata")
        .eq("workspace_id", input.workspaceId)
        .gte("occurred_at", sinceIso)
        .order("occurred_at", { ascending: false })
        .limit(80),
    ]);

  if (indexResult.error) throw indexResult.error;
  if (messagesResult.error) throw messagesResult.error;
  if (conversationsResult.error) throw conversationsResult.error;
  if (notesResult.error) throw notesResult.error;
  if (activitiesResult.error) throw activitiesResult.error;

  const indexedHits = ((indexResult.data ?? []) as SearchRow[])
    .map((row) => buildIndexedHit(row, input.query))
    .filter((hit): hit is CommandSearchHit => Boolean(hit));

  const messageHits = (
    (messagesResult.data ?? []) as Array<Record<string, unknown>>
  )
    .map((row) =>
      buildStructuredHit({
        id: String(row.id),
        type: "message",
        title: `Message (${String(row.direction ?? "unknown")})`,
        snippet: String(row.body ?? ""),
        occurredAt: (row.sent_at as string | null) ?? null,
        provider:
          ((row.normalized_payload as Record<string, unknown> | null)
            ?.provider as IntegrationProvider | null) ?? null,
        query: input.query,
      }),
    )
    .filter((hit): hit is CommandSearchHit => Boolean(hit));

  const conversationHits = (
    (conversationsResult.data ?? []) as Array<Record<string, unknown>>
  )
    .map((row) =>
      buildStructuredHit({
        id: String(row.id),
        type: "conversation",
        title: String(row.subject ?? `Conversation (${String(row.channel ?? "channel")})`),
        snippet: String(row.channel ?? "Conversation"),
        occurredAt: (row.last_message_at as string | null) ?? null,
        provider:
          ((row.normalized_payload as Record<string, unknown> | null)
            ?.provider as IntegrationProvider | null) ?? null,
        query: input.query,
      }),
    )
    .filter((hit): hit is CommandSearchHit => Boolean(hit));

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
                  : null,
        query: input.query,
      }),
    )
    .filter((hit): hit is CommandSearchHit => Boolean(hit));

  const activityHits = (
    (activitiesResult.data ?? []) as Array<Record<string, unknown>>
  )
    .map((row) =>
      buildStructuredHit({
        id: String(row.id),
        type: "activity",
        title: String(row.title ?? "Activity"),
        snippet: String(row.description ?? ""),
        occurredAt: (row.occurred_at as string | null) ?? null,
        provider:
          String((row.metadata as Record<string, unknown> | null)?.integration_source ?? "")
            .toLowerCase()
            .includes("gmail")
            ? "gmail"
            : String((row.metadata as Record<string, unknown> | null)?.integration_source ?? "")
                  .toLowerCase()
                  .includes("outlook")
              ? "outlook"
              : String((row.metadata as Record<string, unknown> | null)?.integration_source ?? "")
                    .toLowerCase()
                    .includes("linkedin")
                ? "linkedin"
                : String((row.metadata as Record<string, unknown> | null)?.integration_source ?? "")
                      .toLowerCase()
                      .includes("slack")
                  ? "slack"
                  : null,
        query: input.query,
      }),
    )
    .filter((hit): hit is CommandSearchHit => Boolean(hit));

  return {
    query: input.query,
    hits: dedupeHits(
      [
        ...hydraHits,
        ...indexedHits,
        ...messageHits,
        ...conversationHits,
        ...noteHits,
        ...activityHits,
      ],
      limit,
    ),
  };
}
