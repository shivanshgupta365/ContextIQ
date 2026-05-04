import { ContextRail } from "@/components/contextiq/context-rail";
import { NotesBriefsSurface } from "@/components/contextiq/v2-surfaces";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getNotesBriefsSurfaceData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function NotesBriefsRoute() {
  const [{ profile }, accounts, railMemories, notesData, integrationStatuses] =
    await Promise.all([
      getWorkspaceContext(),
      getWorkspaceAccounts(),
      getWorkspaceRailMemories(),
      getNotesBriefsSurfaceData(),
      getWorkspaceIntegrationStatuses(),
    ]);

  return (
    <WorkspaceShell
      activeView="notes_briefs"
      headerLabel="Notes / Briefs"
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <NotesBriefsSurface
        notes={notesData.notes}
        documents={notesData.documents}
      />
    </WorkspaceShell>
  );
}
