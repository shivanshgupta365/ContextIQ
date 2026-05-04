import { ContextRail } from "@/components/contextiq/context-rail";
import { ActionsSurface } from "@/components/contextiq/v2-surfaces";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getProviderReadinessData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function ActionsRoute() {
  const [
    { workspace, profile },
    accounts,
    railMemories,
    readiness,
    integrationStatuses,
  ] = await Promise.all([
    getWorkspaceContext(),
    getWorkspaceAccounts(),
    getWorkspaceRailMemories(),
    getProviderReadinessData(),
    getWorkspaceIntegrationStatuses(),
  ]);

  return (
    <WorkspaceShell
      activeView="actions"
      headerLabel="Actions"
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <ActionsSurface workspaceId={workspace.id} readiness={readiness} />
    </WorkspaceShell>
  );
}
