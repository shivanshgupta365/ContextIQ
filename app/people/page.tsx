import { ContextRail } from "@/components/contextiq/context-rail";
import { PeopleSurface } from "@/components/contextiq/v2-surfaces";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getPeopleSurfaceData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function PeopleRoute() {
  const [{ profile }, accounts, railMemories, peopleData, integrationStatuses] =
    await Promise.all([
      getWorkspaceContext(),
      getWorkspaceAccounts(),
      getWorkspaceRailMemories(),
      getPeopleSurfaceData(),
      getWorkspaceIntegrationStatuses(),
    ]);

  return (
    <WorkspaceShell
      activeView="people"
      headerLabel="People"
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <PeopleSurface
        contacts={peopleData.contacts}
        people={peopleData.people}
        aliases={peopleData.aliases}
      />
    </WorkspaceShell>
  );
}
