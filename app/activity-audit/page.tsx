import { ContextRail } from "@/components/contextiq/context-rail";
import { ActivityAuditSurface } from "@/components/contextiq/v2-surfaces";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getActionsAuditSurfaceData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function ActivityAuditRoute() {
  const [{ profile }, accounts, railMemories, auditData, integrationStatuses] =
    await Promise.all([
      getWorkspaceContext(),
      getWorkspaceAccounts(),
      getWorkspaceRailMemories(),
      getActionsAuditSurfaceData(),
      getWorkspaceIntegrationStatuses(),
    ]);

  return (
    <WorkspaceShell
      activeView="activity_audit"
      headerLabel="Activity / Audit"
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <ActivityAuditSurface
        timelineEvents={auditData.timelineEvents}
        actionExecutions={auditData.actionExecutions}
        syncRuns={auditData.syncRuns}
      />
    </WorkspaceShell>
  );
}
