import { ContextRail } from "@/components/contextiq/context-rail";
import { ActivityPage } from "@/components/contextiq/activity-page";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getWorkspaceAccounts,
  getWorkspaceActivity,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function ActivityRoute() {
  const [
    { profile },
    accounts,
    activities,
    railMemories,
    integrationStatuses,
  ] = await Promise.all([
    getWorkspaceContext(),
    getWorkspaceAccounts(),
    getWorkspaceActivity(),
    getWorkspaceRailMemories(),
    getWorkspaceIntegrationStatuses(),
  ]);

  return (
    <WorkspaceShell
      activeView="activity"
      headerLabel="Activity"
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <ActivityPage activities={activities} accounts={accounts} />
    </WorkspaceShell>
  );
}
