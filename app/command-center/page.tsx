import { ContextRail } from "@/components/contextiq/context-rail";
import { CommandCenterSurface } from "@/components/contextiq/v2-surfaces";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import { getActivePersonContext, runMemorySearch } from "@/lib/context/service";
import {
  getProviderReadinessData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";
import type { ActivePersonContextResponse } from "@/types";

export default async function CommandCenterRoute({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = typeof params.q === "string" ? params.q.trim() : "";

  const [{ workspace, profile }, accounts, readiness, integrationStatuses] = await Promise.all([
    getWorkspaceContext(),
    getWorkspaceAccounts(),
    getProviderReadinessData(),
    getWorkspaceIntegrationStatuses(),
  ]);

  const result = query
    ? await runMemorySearch({
        workspaceId: workspace.id,
        hydraTenantId: workspace.hydradb_tenant_id,
        query,
        timeframeDays: 30,
        limit: 12,
      })
    : null;

  let activeContext: ActivePersonContextResponse | null = null;
  if (query) {
    activeContext = await getActivePersonContext({
      workspaceId: workspace.id,
      personQuery: query,
      limit: 8,
    }).catch(() => null);
  }

  const fallbackRailMemories = await getWorkspaceRailMemories();

  const searchEvidenceContext: ActivePersonContextResponse | null =
    query && result
      ? {
          context_mode: "person_context",
          confidence: activeContext?.confidence ?? 0.55,
          person: activeContext?.person ?? null,
          resolver:
            activeContext?.resolver ?? {
              person_id: null,
              confidence: 0,
              matches: [],
              explain: ["search_evidence_mode"],
            },
          relationship_summary:
            activeContext?.relationship_summary ??
            `Search returned ${result.hits.length} grounded records for “${query}”.`,
          last_interactions:
            activeContext?.last_interactions?.length
              ? activeContext.last_interactions
              : result.hits.slice(0, 4).map((hit) => ({
                  title: hit.title,
                  body: hit.snippet,
                })),
          topics:
            activeContext?.topics?.length
              ? activeContext.topics
              : [query, ...result.hits.map((hit) => hit.type)].slice(0, 6),
          pending_actions: activeContext?.pending_actions ?? [],
          source_refs:
            activeContext?.source_refs?.length
              ? activeContext.source_refs
              : result.hits.slice(0, 8).map((hit) => ({
                  source: hit.provider ?? "workspace",
                  ref_id: hit.id,
                  label: hit.title,
                  occurred_at: hit.occurredAt ?? null,
                })),
          timeline:
            activeContext?.timeline?.length
              ? activeContext.timeline
              : result.hits.slice(0, 5).map((hit) => ({
                  title: `${hit.type} • ${hit.provider ?? "workspace"}`,
                  body: hit.occurredAt ? `${hit.occurredAt} • ${hit.snippet}` : hit.snippet,
                })),
          useful_memories:
            activeContext?.useful_memories?.length
              ? activeContext.useful_memories
              : result.hits.slice(0, 5).map((hit) => ({
                  title: hit.title,
                  body: hit.snippet,
                })),
          recommended_next_action:
            activeContext?.recommended_next_action ??
            "Open a top result and run a scoped action for a more specific follow-up.",
          debug: {
            source: "command_center_search_bundle",
            hit_count: result.hits.length,
            degraded: result.degraded,
          },
          degraded: result.degraded,
          degraded_reason: result.degraded_reason ?? null,
        }
      : null;

  return (
    <WorkspaceShell
      activeView="command_center"
      headerLabel="Command Center"
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={
        <ContextRail
          memories={result?.memories?.length ? result.memories : fallbackRailMemories}
          activeContext={searchEvidenceContext}
          contextLabel={query ? `search: ${query}` : null}
        />
      }
    >
      <CommandCenterSurface
        key={query || "command-center"}
        readiness={readiness}
        initialQuery={query}
        result={result}
      />
    </WorkspaceShell>
  );
}
