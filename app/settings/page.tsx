import Link from "next/link";
import type { Route } from "next";

import { ActiveContextDebugPanel } from "@/components/contextiq/active-context-debug-panel";
import { ContextRail } from "@/components/contextiq/context-rail";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  clearWorkspaceDataAction,
  signOutAction,
  triggerGmailWorkspaceSyncAction,
  triggerLinkedInWorkspaceSyncAction,
  triggerOutlookWorkspaceSyncAction,
  triggerSlackWorkspaceSyncAction,
  updateProfileNameAction,
} from "@/lib/actions/contextiq";
import {
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";

export default async function SettingsRoute() {
  const [context, accounts, railMemories, integrationStatuses] =
    await Promise.all([
      getWorkspaceContext(),
      getWorkspaceAccounts(),
      getWorkspaceRailMemories(),
      getWorkspaceIntegrationStatuses(),
    ]);

  const { gmailStatus, linkedInStatus, outlookStatus, slackStatus } = integrationStatuses;
  const isAdmin = context.membershipRole === "owner";

  const gmailConnected = Boolean(gmailStatus.connected);
  const linkedInConnected = Boolean(linkedInStatus.connected);
  const outlookConnected = Boolean(outlookStatus.connected);
  const slackConnected = Boolean(slackStatus.connected);

  return (
    <WorkspaceShell
      activeView="overview"
      headerLabel="Settings"
      accounts={accounts}
      profileName={context.profile.full_name || context.profile.email || "ContextIQ"}
      gmailStatus={gmailStatus}
      linkedInStatus={linkedInStatus}
      outlookStatus={outlookStatus}
      slackStatus={slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <div className="mx-auto w-full max-w-[1100px] space-y-6 px-8 py-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Profile</h2>
          <form action={updateProfileNameAction} className="mt-4 grid gap-3 sm:max-w-[520px]">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500" htmlFor="full_name">
              Full name
            </label>
            <input
              id="full_name"
              name="full_name"
              defaultValue={context.profile.full_name ?? ""}
              placeholder="Your full name"
              className="h-11 rounded-lg border border-slate-200 px-3 text-sm outline-none ring-slate-300 focus:ring"
            />
            <div className="text-sm text-slate-500">Email: {context.profile.email ?? "No email on profile"}</div>
            <button className="mt-2 h-10 w-fit rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
              Save profile
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Workspace</h2>
          <div className="mt-4 grid gap-2 text-sm text-slate-700">
            <div>Name: {context.workspace.name}</div>
            <div>Slug: {context.workspace.slug ?? "-"}</div>
            <div>Hydra tenant: {context.workspace.hydradb_tenant_id}</div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Integrations</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">Gmail</div>
              <div className="mt-1 text-xs text-slate-500">
                {gmailConnected
                  ? `Connected${gmailStatus.connected_count ? ` (${gmailStatus.connected_count}/5 accounts)` : ""}`
                  : "Not connected"}
              </div>
              {gmailStatus.email ? (
                <div className="mt-1 text-xs text-slate-500">Primary: {gmailStatus.email}</div>
              ) : null}
              {gmailStatus.last_synced_at ? (
                <div className="mt-1 text-xs text-slate-500">Last sync: {gmailStatus.last_synced_at}</div>
              ) : null}
              {gmailStatus.last_error ? (
                <div className="mt-1 text-xs text-rose-600">Error: {gmailStatus.last_error}</div>
              ) : null}
              {gmailStatus.accounts?.length ? (
                <div className="mt-2 space-y-1">
                  {gmailStatus.accounts.slice(0, 5).map((account) => (
                    <div key={account.id} className="text-xs text-slate-500">
                      Slot {account.slot}: {account.email ?? "Unknown"}{account.is_primary ? " (primary)" : ""}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {gmailConnected ? (
                  <form action={triggerGmailWorkspaceSyncAction}>
                    <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sync Gmail</button>
                  </form>
                ) : null}
                <Link href={"/auth/gmail/start?next=/settings" as Route} className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  {gmailConnected ? "Add Gmail account" : "Connect Gmail"}
                </Link>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">LinkedIn</div>
              <div className="mt-1 text-xs text-slate-500">{linkedInConnected ? "Connected" : "Not connected"}</div>
              {linkedInStatus.email ? (
                <div className="mt-1 text-xs text-slate-500">Identity: {linkedInStatus.email}</div>
              ) : null}
              {linkedInStatus.last_synced_at ? (
                <div className="mt-1 text-xs text-slate-500">Last sync: {linkedInStatus.last_synced_at}</div>
              ) : null}
              {linkedInStatus.last_error ? (
                <div className="mt-1 text-xs text-rose-600">Error: {linkedInStatus.last_error}</div>
              ) : null}
              {linkedInConnected ? (
                <form action={triggerLinkedInWorkspaceSyncAction} className="mt-3">
                  <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sync LinkedIn</button>
                </form>
              ) : (
                <Link href={"/auth/linkedin/start?next=/settings" as Route} className="mt-3 inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Connect LinkedIn
                </Link>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">Outlook</div>
              <div className="mt-1 text-xs text-slate-500">
                {outlookConnected
                  ? `Connected${outlookStatus.connected_count ? ` (${outlookStatus.connected_count}/5 accounts)` : ""}`
                  : "Not connected"}
              </div>
              {outlookStatus.email ? (
                <div className="mt-1 text-xs text-slate-500">Primary: {outlookStatus.email}</div>
              ) : null}
              {outlookStatus.last_synced_at ? (
                <div className="mt-1 text-xs text-slate-500">Last sync: {outlookStatus.last_synced_at}</div>
              ) : null}
              {outlookStatus.last_error ? (
                <div className="mt-1 text-xs text-rose-600">Error: {outlookStatus.last_error}</div>
              ) : null}
              {outlookStatus.accounts?.length ? (
                <div className="mt-2 space-y-1">
                  {outlookStatus.accounts.slice(0, 5).map((account) => (
                    <div key={account.id} className="text-xs text-slate-500">
                      Slot {account.slot}: {account.email ?? "Unknown"}{account.is_primary ? " (primary)" : ""}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {outlookConnected ? (
                  <form action={triggerOutlookWorkspaceSyncAction}>
                    <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sync Outlook</button>
                  </form>
                ) : null}
                <Link href={"/auth/outlook/start?next=/settings" as Route} className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  {outlookConnected ? "Add Outlook account" : "Connect Outlook"}
                </Link>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">Slack</div>
              <div className="mt-1 text-xs text-slate-500">{slackConnected ? "Connected" : "Not connected"}</div>
              {slackStatus.team_name || slackStatus.team_id ? (
                <div className="mt-1 text-xs text-slate-500">
                  Team: {slackStatus.team_name ?? slackStatus.team_id}
                </div>
              ) : null}
              {slackStatus.needs_reconnect ? (
                <div className="mt-1 text-xs text-amber-700">
                  Reconnect recommended to enable user-scoped inbox retrieval.
                </div>
              ) : null}
              {slackStatus.last_synced_at ? (
                <div className="mt-1 text-xs text-slate-500">Last sync: {slackStatus.last_synced_at}</div>
              ) : null}
              {slackStatus.last_error ? (
                <div className="mt-1 text-xs text-rose-600">Error: {slackStatus.last_error}</div>
              ) : null}
              {slackConnected ? (
                <form action={triggerSlackWorkspaceSyncAction} className="mt-3">
                  <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sync Slack</button>
                </form>
              ) : (
                <Link href={"/auth/slack/start?next=/settings" as Route} className="mt-3 inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Connect Slack
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Data Controls</h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <form action={clearWorkspaceDataAction} className="flex items-center gap-2">
              <input
                name="confirm_clear"
                placeholder="Type CLEAR"
                className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none ring-slate-300 focus:ring"
                required
              />
              <button className="h-10 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700">
                Clear workspace data
              </button>
            </form>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Clear action removes live CRM, projections, sync artifacts, and integration records for this workspace.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Session</h2>
          <form action={signOutAction} className="mt-4">
            <button className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Sign out
            </button>
          </form>
        </section>

        {isAdmin ? <ActiveContextDebugPanel /> : null}
      </div>
    </WorkspaceShell>
  );
}
