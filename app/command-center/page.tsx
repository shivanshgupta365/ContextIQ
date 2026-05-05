import { ContextRail } from "@/components/contextiq/context-rail";
import { CommandCenterSurface } from "@/components/contextiq/v2-surfaces";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import { runCommandSearch } from "@/lib/command/search";
import {
  getProviderReadinessData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

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
    ? await runCommandSearch({
        workspaceId: workspace.id,
        hydraTenantId: workspace.hydradb_tenant_id,
        query,
        timeframeDays: 30,
        limit: 12,
      })
    : null;

  const railMemories = result?.memories?.length
    ? result.memories
    : await getWorkspaceRailMemories();

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
          memories={railMemories}
          subtitle={
            query
              ? `${railMemories.length} evidence-backed memories for this query`
              : undefined
          }
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
