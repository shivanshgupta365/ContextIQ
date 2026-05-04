import type { Account, ActivityRecord, Contact, Note, RecalledMemory } from "@/types";
import { getServerEnv } from "@/lib/env";

interface EnsureHydraTenantInput {
  tenantId: string;
  tenantName: string;
  tenantDescription?: string;
}

interface HydraMemoryPayload {
  content: string;
  metadata: Record<string, unknown>;
}

interface HydraRecallInput {
  tenantId: string;
  query: string;
  filters?: Record<string, unknown>;
  topK?: number;
}

async function hydraFetch<T>(path: string, init: RequestInit) {
  const env = getServerEnv();
  const response = await fetch(`${env.HYDRADB_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.HYDRADB_API_KEY}`,
      "x-api-key": env.HYDRADB_API_KEY,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HydraDB ${path} failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

export async function ensureHydraTenant(input: EnsureHydraTenantInput) {
  try {
    await hydraFetch("/tenants/create", {
      method: "POST",
      body: JSON.stringify({
        tenant_id: input.tenantId,
        tenant_name: input.tenantName,
        tenant_description: input.tenantDescription,
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);

    if (
      message.includes("already exists") ||
      message.includes("409") ||
      message.includes("duplicate") ||
      (message.includes("403") && message.includes("plan limit reached"))
    ) {
      return;
    }

    throw error;
  }
}

export async function addMemories(input: {
  tenantId: string;
  memories: HydraMemoryPayload[];
}) {
  return hydraFetch<{ memory_ids?: string[]; ids?: string[] }>(
    "/add_memory",
    {
      method: "POST",
      body: JSON.stringify({
        tenant_id: input.tenantId,
        memories: input.memories.map((memory) => ({
          content: memory.content,
          document_metadata: memory.metadata,
        })),
      }),
    },
  );
}

export async function fullRecall(input: HydraRecallInput) {
  const result = await hydraFetch<{
    memories?: Array<{
      id?: string;
      content?: string;
      score?: number;
      document_metadata?: Record<string, unknown>;
    }>;
    results?: Array<{
      id?: string;
      content?: string;
      score?: number;
      document_metadata?: Record<string, unknown>;
    }>;
  }>("/full_recall", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: input.tenantId,
      q: input.query,
      query: input.query,
      top_k: input.topK ?? 6,
      limit: input.topK ?? 6,
      document_metadata: input.filters ?? {},
    }),
  });

  const rawMemories = result.memories ?? result.results ?? [];

  return rawMemories.map(
    (memory): RecalledMemory => ({
      id: memory.id,
      content: memory.content ?? "",
      score: memory.score,
      metadata: {
        workspace_id: String(memory.document_metadata?.workspace_id ?? ""),
        account_id: String(memory.document_metadata?.account_id ?? ""),
        contact_id:
          memory.document_metadata?.contact_id == null
            ? null
            : String(memory.document_metadata.contact_id),
        source_type: String(memory.document_metadata?.source_type ?? "memory"),
        topic:
          memory.document_metadata?.topic == null
            ? null
            : String(memory.document_metadata.topic),
        importance_level:
          memory.document_metadata?.importance_level == null
            ? null
            : String(memory.document_metadata.importance_level),
        stage:
          memory.document_metadata?.stage == null
            ? null
            : String(memory.document_metadata.stage),
        created_at: String(
          memory.document_metadata?.created_at ?? new Date().toISOString(),
        ),
        created_by:
          memory.document_metadata?.created_by == null
            ? null
            : String(memory.document_metadata.created_by),
        entity_type: String(memory.document_metadata?.entity_type ?? "memory"),
        account_name:
          memory.document_metadata?.account_name == null
            ? null
            : String(memory.document_metadata.account_name),
        contact_name:
          memory.document_metadata?.contact_name == null
            ? null
            : String(memory.document_metadata.contact_name),
        contact_role_type:
          memory.document_metadata?.contact_role_type == null
            ? null
            : String(memory.document_metadata.contact_role_type),
        integration_source:
          memory.document_metadata?.integration_source == null
            ? null
            : (String(memory.document_metadata.integration_source) as
                | "gmail"
                | "linkedin"
                | "outlook"
                | "slack"),
      },
    }),
  );
}

export function buildNoteMemoryPayload(input: {
  note: Note;
  account: Account;
  contact: Contact | null;
  userId: string;
}) {
  const normalizedTopic = (input.note.topic ?? "").toLowerCase();
  const inferredIntegrationSource =
    normalizedTopic.includes("gmail") || input.note.source_type === "email_summary"
      ? "gmail"
      : normalizedTopic.includes("outlook")
        ? "outlook"
      : normalizedTopic.includes("linkedin")
        ? "linkedin"
        : normalizedTopic.includes("slack")
          ? "slack"
        : null;

  return {
    content: input.note.content,
    metadata: {
      workspace_id: input.note.workspace_id,
      account_id: input.note.account_id,
      contact_id: input.note.contact_id,
      source_type: input.note.source_type,
      topic: input.note.topic,
      importance_level: input.note.importance_level,
      stage: input.account.stage,
      created_at: input.note.created_at,
      created_by: input.userId,
      entity_type: "note",
      account_name: input.account.name,
      contact_name: input.contact?.name ?? null,
      contact_role_type: input.contact?.role_type ?? null,
      integration_source: inferredIntegrationSource,
    },
  };
}

export function buildActivityMemoryPayload(input: {
  activity: ActivityRecord;
  account: Account;
  contact: Contact | null;
  userId: string;
}) {
  const topicValue =
    typeof input.activity.metadata?.topic === "string"
      ? input.activity.metadata.topic
      : input.activity.activity_type;
  const normalizedTopic = String(topicValue ?? "").toLowerCase();
  const inferredIntegrationSource = normalizedTopic.includes("gmail")
    ? "gmail"
    : normalizedTopic.includes("outlook")
      ? "outlook"
    : normalizedTopic.includes("linkedin")
      ? "linkedin"
      : normalizedTopic.includes("slack")
        ? "slack"
      : null;

  const content =
    input.activity.description?.trim() ||
    `${input.activity.title}. Activity type: ${input.activity.activity_type}.`;

  return {
    content,
    metadata: {
      workspace_id: input.activity.workspace_id,
      account_id: input.activity.account_id,
      contact_id: input.activity.contact_id,
      source_type: "activity_summary",
      topic: topicValue,
      importance_level:
        typeof input.activity.metadata?.importance_level === "string"
          ? input.activity.metadata.importance_level
          : "medium",
      stage: input.account.stage,
      created_at: input.activity.occurred_at,
      created_by: input.userId,
      entity_type: "activity",
      account_name: input.account.name,
      contact_name: input.contact?.name ?? null,
      contact_role_type: input.contact?.role_type ?? null,
      integration_source: inferredIntegrationSource,
    },
  };
}
