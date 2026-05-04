import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { CommandSearchHit, CommandSearchRequest, CommandSearchResponse } from "@/types";

function inferProviderFromSource(value: string | null | undefined) {
  const normalized = (value ?? "").toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("gmail")) return "gmail";
  if (normalized.includes("outlook")) return "outlook";
  if (normalized.includes("slack")) return "slack";
  if (normalized.includes("linkedin")) return "linkedin";
  return null;
}

export async function runCommandSearch(input: CommandSearchRequest): Promise<CommandSearchResponse> {
  const supabase = await getSupabaseServerClient();
  const limit = Math.max(1, Math.min(input.limit ?? 12, 50));
  const timeframeDays = Math.max(1, Math.min(input.timeframeDays ?? 30, 365));
  const sinceIso = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000).toISOString();

  const hitsFromIndex = await (async () => {
    try {
      let query = supabase
        .from("search_index_entries")
        .select("id,entity_type,entity_id,title,body,normalized_payload,synced_at")
        .eq("workspace_id", input.workspaceId)
        .gte("synced_at", sinceIso)
        .ilike("body", `%${input.query}%`)
        .order("synced_at", { ascending: false });
      const { data } = await query.limit(limit);

      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        type: row.entity_type as CommandSearchHit["type"],
        title: (row.title as string | null) ?? "Context entry",
        snippet: String(row.body ?? "").slice(0, 240),
        provider: ((row.normalized_payload as Record<string, unknown> | null)?.provider ??
          null) as CommandSearchHit["provider"],
        occurredAt: (row.synced_at as string | null) ?? null,
        relevance: 0.8,
        ref: {
          entity_type: row.entity_type as CommandSearchHit["type"],
          entity_id: String(row.entity_id),
          provider: ((row.normalized_payload as Record<string, unknown> | null)?.provider ??
            null) as CommandSearchHit["provider"],
        },
      }));
    } catch (error) {
      console.error("search_index_entries lookup failed", error);
      return [] as CommandSearchHit[];
    }
  })();

  if (hitsFromIndex.length > 0) {
    return {
      query: input.query,
      hits: hitsFromIndex,
    };
  }

  let notesQuery = supabase
    .from("notes")
    .select("id,title,content,account_id,contact_id,created_at,source_type,topic")
    .eq("workspace_id", input.workspaceId)
    .gte("created_at", sinceIso)
    .ilike("content", `%${input.query}%`)
    .order("created_at", { ascending: false });
  if (input.accountId) notesQuery = notesQuery.eq("account_id", input.accountId);
  if (input.personId) notesQuery = notesQuery.eq("contact_id", input.personId);

  let activitiesQuery = supabase
    .from("activities")
    .select("id,title,description,account_id,contact_id,occurred_at,activity_type,metadata")
    .eq("workspace_id", input.workspaceId)
    .gte("occurred_at", sinceIso)
    .or(`title.ilike.%${input.query}%,description.ilike.%${input.query}%`)
    .order("occurred_at", { ascending: false });
  if (input.accountId) activitiesQuery = activitiesQuery.eq("account_id", input.accountId);
  if (input.personId) activitiesQuery = activitiesQuery.eq("contact_id", input.personId);

  const [notesResult, activityResult] = await Promise.all([
    notesQuery.limit(limit),
    activitiesQuery.limit(limit),
  ]);

  const noteHits: CommandSearchHit[] = (
    (notesResult.data ?? []) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: `note-${row.id}`,
    type: "note",
    title: (row.title as string | null) || "Account note",
    snippet: String(row.content ?? "").slice(0, 240),
    provider: inferProviderFromSource(
      `${String(row.source_type ?? "")} ${String(row.topic ?? "")}`,
    ) as CommandSearchHit["provider"],
    occurredAt: row.created_at as string,
    relevance: 0.65,
    ref: {
      entity_type: "note",
      entity_id: String(row.id),
      provider: inferProviderFromSource(
        `${String(row.source_type ?? "")} ${String(row.topic ?? "")}`,
      ) as CommandSearchHit["provider"],
    },
  }));

  const activityHits: CommandSearchHit[] = (
    (activityResult.data ?? []) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: `activity-${row.id}`,
    type: "activity",
    title: String(row.title ?? "Activity"),
    snippet: String(row.description ?? row.title ?? "").slice(0, 240),
    provider: inferProviderFromSource(
      `${String(row.activity_type ?? "")} ${String((row.metadata as Record<string, unknown> | null)?.topic ?? "")}`,
    ) as CommandSearchHit["provider"],
    occurredAt: row.occurred_at as string,
    relevance: 0.6,
    ref: {
      entity_type: "activity",
      entity_id: String(row.id),
      provider: inferProviderFromSource(
        `${String(row.activity_type ?? "")} ${String((row.metadata as Record<string, unknown> | null)?.topic ?? "")}`,
      ) as CommandSearchHit["provider"],
    },
  }));

  return {
    query: input.query,
    hits: [...noteHits, ...activityHits].slice(0, limit),
  };
}
