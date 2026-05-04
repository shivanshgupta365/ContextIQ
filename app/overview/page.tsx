import { ContextRail } from "@/components/contextiq/context-rail";
import { OverviewPage } from "@/components/contextiq/overview-page";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getWorkspaceAccounts,
  getWorkspaceIntegrationStatuses,
  getWorkspaceOverviewData,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function OverviewRoute() {
  const [overviewData, accounts, railMemories, integrationStatuses] = await Promise.all([
    getWorkspaceOverviewData(),
    getWorkspaceAccounts(),
    getWorkspaceRailMemories(),
    getWorkspaceIntegrationStatuses(),
  ]);

  return (
    <WorkspaceShell
      activeView="overview"
      headerLabel="Overview"
      accounts={accounts}
      profileName={overviewData.profile.full_name || overviewData.profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <OverviewPage data={overviewData} />
    </WorkspaceShell>
  );
}
