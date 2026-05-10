import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Account, Contact, IntegrationProvider } from "@/types";

function titleCase(value: string) {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeDomain(input: string | null | undefined) {
  if (!input) return null;
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
}

export function extractDomainFromEmail(email: string | null | undefined) {
  if (!email) return null;
  return normalizeDomain(email.split("@")[1] ?? "");
}

export function parseRecipientLabel(value: string | null | undefined) {
  if (!value) {
    return { name: null, email: null };
  }

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch?.[0]?.toLowerCase() ?? null;
  const stripped = value.replace(/<[^>]+>/g, "").replace(/"/g, "").trim();
  const name = stripped && stripped !== email ? stripped : null;

  return { name, email };
}

export function deriveDisplayNameFromEmail(email: string) {
  return titleCase(email.split("@")[0] ?? email);
}

export function deriveAccountNameFromDomain(domain: string) {
  const label = domain.split(".")[0] ?? domain;
  return titleCase(label);
}

export async function ensureAccountForEmail(input: {
  workspaceId: string;
  userId: string;
  email: string;
  provider: IntegrationProvider;
  nameHint?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  const domain = extractDomainFromEmail(input.email);
  if (!domain) return null;

  const { data: existing } = await supabase
    .from("accounts")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("domain", domain)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return existing as Account;
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      workspace_id: input.workspaceId,
      name: input.nameHint?.trim() || deriveAccountNameFromDomain(domain),
      domain,
      stage: "discovery",
      priority: "medium",
      owner_name: null,
      notes_summary: `Imported from ${input.provider}`,
      last_contacted_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to create account projection.");
  }

  return data as Account;
}

export async function ensureOrganizationForAccount(input: {
  workspaceId: string;
  userId: string;
  account: Account;
  provider: IntegrationProvider;
}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("organizations")
    .upsert(
      {
        workspace_id: input.workspaceId,
        owner_user_id: input.userId,
        account_id: input.account.id,
        name: input.account.name,
        domain: input.account.domain,
        industry: input.account.industry,
        source_provider: input.provider,
        source_object_type: "organization",
        source_object_id: input.account.id,
        dedupe_key: `account:${input.account.id}`,
        normalized_payload: {
          account_id: input.account.id,
          account_name: input.account.name,
          account_domain: input.account.domain,
        },
        embedding_status: "not_indexed",
        synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,dedupe_key" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to project organization.");
  }

  return data as { id: string };
}

export async function ensureContactForEmail(input: {
  workspaceId: string;
  accountId: string;
  email: string;
  name?: string | null;
  title?: string | null;
  linkedinUrl?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  const normalizedEmail = input.email.toLowerCase();

  const { data: existing } = await supabase
    .from("contacts")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("email", normalizedEmail)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return existing as Contact;
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: input.workspaceId,
      account_id: input.accountId,
      name: input.name?.trim() || deriveDisplayNameFromEmail(normalizedEmail),
      email: normalizedEmail,
      title: input.title ?? null,
      role_type: "other",
      communication_style: null,
      preference_summary: null,
      importance_level: "medium",
      linkedin_url: input.linkedinUrl ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to create contact projection.");
  }

  return data as Contact;
}

export async function ensurePersonProjection(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  organizationId: string | null;
  contact: Contact;
  sourceObjectId: string;
  phone?: string | null;
}) {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("people")
    .upsert(
      {
        workspace_id: input.workspaceId,
        owner_user_id: input.userId,
        organization_id: input.organizationId,
        contact_id: input.contact.id,
        full_name: input.contact.name,
        email: input.contact.email,
        title: input.contact.title,
        linkedin_url: input.contact.linkedin_url,
        phone: input.phone ?? null,
        source_provider: input.provider,
        source_object_type: "person",
        source_object_id: input.sourceObjectId,
        dedupe_key: `contact:${input.contact.id}`,
        normalized_payload: {
          contact_id: input.contact.id,
          account_id: input.contact.account_id,
          email: input.contact.email,
          linkedin_url: input.contact.linkedin_url,
          role_type: input.contact.role_type,
        },
        embedding_status: "not_indexed",
        synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,dedupe_key" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to project person.");
  }

  return data as { id: string; full_name: string; email: string | null };
}

export async function ensureIdentityAlias(input: {
  workspaceId: string;
  userId: string;
  personId: string;
  provider: string;
  aliasType: string;
  aliasValue: string;
  sourceProvider: IntegrationProvider;
  sourceObjectId: string;
}) {
  const supabase = getSupabaseAdminClient();
  const value = input.aliasValue.trim().toLowerCase();
  if (!value) return;

  await supabase.from("identity_aliases").upsert(
    {
      workspace_id: input.workspaceId,
      owner_user_id: input.userId,
      person_id: input.personId,
      provider: input.provider,
      alias_type: input.aliasType,
      alias_value: value,
      source_provider: input.sourceProvider,
      source_object_type: "identity_alias",
      source_object_id: input.sourceObjectId,
      dedupe_key: `${input.provider}:${input.aliasType}:${value}`,
      normalized_payload: {
        person_id: input.personId,
        alias_value: value,
      },
      embedding_status: "not_indexed",
      synced_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,dedupe_key" },
  );
}

export async function upsertPersonSource(input: {
  workspaceId: string;
  userId: string;
  personId: string;
  sourceProvider: IntegrationProvider;
  sourceObjectId: string;
  sourceUserId?: string | null;
  sourceProfileUrl?: string | null;
  sourceEmail?: string | null;
  sourceDisplayName?: string | null;
  lastSeenAt?: string | null;
  normalizedPayload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();

  const dedupeKey = [
    input.sourceProvider,
    input.personId,
    input.sourceUserId ?? input.sourceEmail ?? input.sourceObjectId,
  ].join(":");

  await supabase.from("person_sources").upsert(
    {
      workspace_id: input.workspaceId,
      owner_user_id: input.userId,
      person_id: input.personId,
      source_provider: input.sourceProvider,
      source_user_id: input.sourceUserId ?? null,
      source_profile_url: input.sourceProfileUrl ?? null,
      source_email: input.sourceEmail ?? null,
      source_display_name: input.sourceDisplayName ?? null,
      source_object_type: "person_source",
      source_object_id: input.sourceObjectId,
      dedupe_key: dedupeKey,
      normalized_payload: input.normalizedPayload ?? {},
      last_seen_at: input.lastSeenAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,dedupe_key" },
  );
}

export async function upsertPersonThreadLink(input: {
  workspaceId: string;
  userId: string;
  personId: string;
  conversationId: string;
  provider: IntegrationProvider;
  sourceObjectId: string;
  role?: string;
  lastSeenAt?: string | null;
  normalizedPayload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();

  await supabase.from("person_thread_links").upsert(
    {
      workspace_id: input.workspaceId,
      owner_user_id: input.userId,
      person_id: input.personId,
      conversation_id: input.conversationId,
      role: input.role ?? "participant",
      source_provider: input.provider,
      source_object_type: "person_thread_link",
      source_object_id: input.sourceObjectId,
      dedupe_key: `${input.provider}:person_thread:${input.personId}:${input.conversationId}`,
      normalized_payload: input.normalizedPayload ?? {},
      last_seen_at: input.lastSeenAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,dedupe_key" },
  );
}

export async function upsertRelationshipMemory(input: {
  workspaceId: string;
  userId: string;
  personId: string;
  provider: IntegrationProvider;
  sourceObjectId: string;
  summary: string;
  relationshipType?: string;
  status?: string;
  sentiment?: string | null;
  lastInteractionAt?: string | null;
  topics?: string[];
  pendingActions?: string[];
  sourceRefs?: Array<Record<string, unknown>>;
  hydraMemoryId?: string | null;
  normalizedPayload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();

  await supabase.from("relationship_memories").upsert(
    {
      workspace_id: input.workspaceId,
      owner_user_id: input.userId,
      person_id: input.personId,
      summary: input.summary,
      relationship_type: input.relationshipType ?? "contact",
      status: input.status ?? "active",
      sentiment: input.sentiment ?? null,
      last_interaction_at: input.lastInteractionAt ?? new Date().toISOString(),
      topics: input.topics ?? [],
      pending_actions: input.pendingActions ?? [],
      source_refs: input.sourceRefs ?? [],
      hydradb_memory_id: input.hydraMemoryId ?? null,
      source_provider: input.provider,
      source_object_type: "relationship_memory",
      source_object_id: input.sourceObjectId,
      dedupe_key: `${input.provider}:relationship:${input.personId}:${input.sourceObjectId}`,
      normalized_payload: input.normalizedPayload ?? {},
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,dedupe_key" },
  );
}

export async function upsertRelationshipEdge(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  sourceObjectId: string;
  fromEntityType: string;
  fromEntityId: string;
  edgeType: string;
  toEntityType: string;
  toEntityId: string;
  weight?: number;
  sourceRefs?: Array<Record<string, unknown>>;
  normalizedPayload?: Record<string, unknown>;
  lastSeenAt?: string | null;
}) {
  const supabase = getSupabaseAdminClient();

  await supabase.from("relationship_edges").upsert(
    {
      workspace_id: input.workspaceId,
      owner_user_id: input.userId,
      from_entity_type: input.fromEntityType,
      from_entity_id: input.fromEntityId,
      edge_type: input.edgeType,
      to_entity_type: input.toEntityType,
      to_entity_id: input.toEntityId,
      weight: input.weight ?? 1,
      source_refs: input.sourceRefs ?? [],
      source_provider: input.provider,
      source_object_type: "relationship_edge",
      source_object_id: input.sourceObjectId,
      dedupe_key: `${input.provider}:edge:${input.fromEntityType}:${input.fromEntityId}:${input.edgeType}:${input.toEntityType}:${input.toEntityId}`,
      normalized_payload: input.normalizedPayload ?? {},
      last_seen_at: input.lastSeenAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,dedupe_key" },
  );
}

export async function ensureConversationProjection(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  organizationId?: string | null;
  personId?: string | null;
  channel: string;
  subject?: string | null;
  status?: string | null;
  lastMessageAt?: string | null;
  sourceObjectId: string;
  normalizedPayload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("conversations")
    .upsert(
      {
        workspace_id: input.workspaceId,
        owner_user_id: input.userId,
        organization_id: input.organizationId ?? null,
        person_id: input.personId ?? null,
        channel: input.channel,
        subject: input.subject ?? null,
        status: input.status ?? "active",
        last_message_at: input.lastMessageAt ?? new Date().toISOString(),
        source_provider: input.provider,
        source_object_type: "conversation",
        source_object_id: input.sourceObjectId,
        dedupe_key: `${input.provider}:conversation:${input.sourceObjectId}`,
        normalized_payload: input.normalizedPayload ?? {},
        embedding_status: "not_indexed",
        synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,dedupe_key" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to project conversation.");
  }

  return data as { id: string };
}

export async function upsertMessageProjection(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  conversationId: string;
  organizationId?: string | null;
  personId?: string | null;
  sourceObjectId: string;
  direction: "inbound" | "outbound" | "internal";
  body: string;
  sentAt?: string | null;
  normalizedPayload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("messages")
    .upsert(
      {
        workspace_id: input.workspaceId,
        owner_user_id: input.userId,
        conversation_id: input.conversationId,
        organization_id: input.organizationId ?? null,
        person_id: input.personId ?? null,
        direction: input.direction,
        body: input.body,
        sent_at: input.sentAt ?? new Date().toISOString(),
        source_provider: input.provider,
        source_object_type: "message",
        source_object_id: input.sourceObjectId,
        dedupe_key: `${input.provider}:message:${input.sourceObjectId}`,
        normalized_payload: input.normalizedPayload ?? {},
        embedding_status: "not_indexed",
        synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,dedupe_key" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to project message.");
  }

  return data as { id: string };
}

export async function upsertMeetingProjection(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  organizationId?: string | null;
  topic: string;
  startsAt?: string | null;
  endsAt?: string | null;
  attendeePersonIds?: string[];
  status?: string | null;
  sourceObjectId: string;
  normalizedPayload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("meetings")
    .upsert(
      {
        workspace_id: input.workspaceId,
        owner_user_id: input.userId,
        organization_id: input.organizationId ?? null,
        topic: input.topic,
        starts_at: input.startsAt ?? null,
        ends_at: input.endsAt ?? null,
        status: input.status ?? "confirmed",
        attendee_person_ids: input.attendeePersonIds ?? [],
        source_provider: input.provider,
        source_object_type: "meeting",
        source_object_id: input.sourceObjectId,
        dedupe_key: `${input.provider}:meeting:${input.sourceObjectId}`,
        normalized_payload: input.normalizedPayload ?? {},
        embedding_status: "not_indexed",
        synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,dedupe_key" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to project meeting.");
  }

  return data as { id: string };
}

export async function upsertDocumentProjection(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  organizationId?: string | null;
  personId?: string | null;
  title: string;
  body: string;
  kind: string;
  sourceObjectId: string;
  normalizedPayload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("documents")
    .upsert(
      {
        workspace_id: input.workspaceId,
        owner_user_id: input.userId,
        organization_id: input.organizationId ?? null,
        person_id: input.personId ?? null,
        title: input.title,
        body: input.body,
        kind: input.kind,
        source_provider: input.provider,
        source_object_type: "document",
        source_object_id: input.sourceObjectId,
        dedupe_key: `${input.provider}:document:${input.sourceObjectId}`,
        normalized_payload: input.normalizedPayload ?? {},
        embedding_status: "not_indexed",
        synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,dedupe_key" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to project document.");
  }

  return data as { id: string };
}

export async function upsertSearchIndexEntry(input: {
  workspaceId: string;
  userId: string;
  entityType: string;
  entityId: string;
  title?: string | null;
  body: string;
  provider: IntegrationProvider;
  sourceObjectId: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase.from("search_index_entries").upsert(
    {
      workspace_id: input.workspaceId,
      owner_user_id: input.userId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      title: input.title ?? null,
      body: input.body,
      metadata: input.metadata ?? {},
      source_provider: input.provider,
      source_object_type: "search_index_entry",
      source_object_id: input.sourceObjectId,
      dedupe_key: `${input.provider}:search:${input.entityType}:${input.sourceObjectId}`,
      normalized_payload: {
        provider: input.provider,
        ...(input.metadata ?? {}),
      },
      embedding_status: "pending",
      synced_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,dedupe_key" },
  );

  if (error) {
    throw error;
  }
}
