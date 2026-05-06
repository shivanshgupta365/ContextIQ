import type { Account, ActivityRecord, Contact, Note, RecalledMemory } from "@/types";
import { getHydraEnv } from "@/lib/env";
import {
  inferIntegrationSourceForActivity,
  inferIntegrationSourceForMemory,
  inferIntegrationSourceForNote,
} from "@/lib/integrations/provider-source";

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

type HydraAddMemoryResponse = {
  memory_ids?: string[];
  ids?: string[];
  results?: Array<{
    source_id?: string;
    memory_id?: string;
    id?: string;
  }>;
};

type HydraRecallResponse = {
  chunks?: Array<{
    source_id?: string;
    chunk_content?: string;
    content?: string;
    relevancy_score?: number;
    score?: number;
    metadata?: Record<string, unknown>;
    document_metadata?: Record<string, unknown>;
  }>;
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
};

function normalizeRecallFilters(filters?: Record<string, unknown>) {
  if (!filters) return undefined;

  if (
    "document_metadata" in filters ||
    "metadata" in filters ||
    "additional_metadata" in filters
  ) {
    return filters;
  }

  return {
    document_metadata: filters,
  };
}

async function hydraFetch<T>(path: string, init: RequestInit) {
  const env = getHydraEnv();
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
  const response = await hydraFetch<HydraAddMemoryResponse>(
    "/memories/add_memory",
    {
      method: "POST",
      body: JSON.stringify({
        tenant_id: input.tenantId,
        memories: input.memories.map((memory) => ({
          text: memory.content,
          infer: false,
          title:
            typeof memory.metadata.entity_type === "string"
              ? String(memory.metadata.entity_type)
              : "memory",
          additional_metadata: memory.metadata,
        })),
      }),
    },
  );

  const responseIds =
    response.results
      ?.map((result) => result.source_id ?? result.memory_id ?? result.id)
      .filter((value): value is string => typeof value === "string" && value.length > 0) ?? [];

  return {
    ...response,
    memory_ids:
      response.memory_ids && response.memory_ids.length > 0
        ? response.memory_ids
        : responseIds,
    ids:
      response.ids && response.ids.length > 0
        ? response.ids
        : responseIds,
  };
}

export async function fullRecall(input: HydraRecallInput) {
  const result = await hydraFetch<HydraRecallResponse>("/recall/full_recall", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: input.tenantId,
      query: input.query,
      max_results: input.topK ?? 6,
      metadata_filters: normalizeRecallFilters(input.filters),
    }),
  });

  const rawMemories =
    result.chunks?.map((chunk) => ({
      id: chunk.source_id,
      content: chunk.chunk_content ?? chunk.content,
      score: chunk.relevancy_score ?? chunk.score,
      document_metadata:
        chunk.metadata?.document_metadata && typeof chunk.metadata.document_metadata === "object"
          ? (chunk.metadata.document_metadata as Record<string, unknown>)
          : chunk.document_metadata ??
            (chunk.metadata as Record<string, unknown> | undefined) ??
            {},
    })) ??
    result.memories ??
    result.results ??
    [];

  return rawMemories.map((memory): RecalledMemory => {
    const metadata = memory.document_metadata ?? {};

    return {
      id: memory.id,
      content: memory.content ?? "",
      score: memory.score,
      metadata: {
        workspace_id: String(metadata.workspace_id ?? ""),
        account_id: String(metadata.account_id ?? ""),
        contact_id: metadata.contact_id == null ? null : String(metadata.contact_id),
        source_type: String(metadata.source_type ?? "memory"),
        topic: metadata.topic == null ? null : String(metadata.topic),
        importance_level:
          metadata.importance_level == null ? null : String(metadata.importance_level),
        stage: metadata.stage == null ? null : String(metadata.stage),
        created_at: String(metadata.created_at ?? new Date().toISOString()),
        created_by: metadata.created_by == null ? null : String(metadata.created_by),
        entity_type: String(metadata.entity_type ?? "memory"),
        account_name: metadata.account_name == null ? null : String(metadata.account_name),
        contact_name: metadata.contact_name == null ? null : String(metadata.contact_name),
        contact_role_type:
          metadata.contact_role_type == null ? null : String(metadata.contact_role_type),
        integration_source: inferIntegrationSourceForMemory({
          topic: metadata.topic == null ? null : String(metadata.topic),
          source_type: String(metadata.source_type ?? "memory"),
          integration_source:
            metadata.integration_source == null
              ? null
              : (String(metadata.integration_source) as
                  | "gmail"
                  | "linkedin"
                  | "outlook"
                  | "slack"),
        }),
      },
    };
  });
}

export function buildNoteMemoryPayload(input: {
  note: Note;
  account: Account;
  contact: Contact | null;
  userId: string;
}) {
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
      integration_source: inferIntegrationSourceForNote(input.note),
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
      integration_source: inferIntegrationSourceForActivity(input.activity),
    },
  };
}
