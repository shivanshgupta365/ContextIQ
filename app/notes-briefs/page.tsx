import { ContextRail } from "@/components/contextiq/context-rail";
import { NotesBriefsSurface } from "@/components/contextiq/v2-surfaces";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getNotesBriefsSurfaceData,
  getProviderReadinessData,
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function NotesBriefsRoute() {
  const [{ profile, workspace }, accounts, railMemories, notesData, integrationStatuses, readiness] =
    await Promise.all([
      getWorkspaceContext(),
      getWorkspaceAccounts(),
      getWorkspaceRailMemories(),
      getNotesBriefsSurfaceData(),
      getWorkspaceIntegrationStatuses(),
      getProviderReadinessData(),
    ]);
  const notionReadiness = readiness.find((provider) => provider.provider === "notion") ?? null;

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
        workspaceId={workspace.id}
        accounts={accounts}
        notionReadiness={notionReadiness}
        notes={notesData.notes}
        documents={notesData.documents}
      />
    </WorkspaceShell>
  );
}
