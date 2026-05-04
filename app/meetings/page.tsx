import { ContextRail } from "@/components/contextiq/context-rail";
import { MeetingsSurface } from "@/components/contextiq/v2-surfaces";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getMeetingsSurfaceData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function MeetingsRoute() {
  const [{ profile }, accounts, railMemories, meetingsData, integrationStatuses] =
    await Promise.all([
      getWorkspaceContext(),
      getWorkspaceAccounts(),
      getWorkspaceRailMemories(),
      getMeetingsSurfaceData(),
      getWorkspaceIntegrationStatuses(),
    ]);

  return (
    <WorkspaceShell
      activeView="meetings"
      headerLabel="Meetings"
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <MeetingsSurface
        meetings={meetingsData.meetings}
        legacyMeetings={meetingsData.legacyMeetingActivities}
      />
    </WorkspaceShell>
  );
}
