import Link from "next/link";
import type { Route } from "next";

import { ContextRail } from "@/components/contextiq/context-rail";
import { Badge } from "@/components/contextiq/primitives";
import { WorkspaceShell } from "@/components/contextiq/workspace-shell";
import {
  getWorkspaceAccounts,
  getWorkspaceContext,
  getWorkspaceIntegrationStatuses,
  getWorkspaceRailMemories,
} from "@/lib/data/contextiq";
import { formatCurrency, formatRelativeDate } from "@/lib/utils";

export default async function AccountsRoute() {
  const [{ profile }, accounts, railMemories, integrationStatuses] = await Promise.all([
    getWorkspaceContext(),
    getWorkspaceAccounts(),
    getWorkspaceRailMemories(),
    getWorkspaceIntegrationStatuses(),
  ]);

  return (
    <WorkspaceShell
      activeView="accounts"
      headerLabel="Accounts"
      accounts={accounts}
      profileName={profile.full_name || profile.email || "ContextIQ"}
      gmailStatus={integrationStatuses.gmailStatus}
      linkedInStatus={integrationStatuses.linkedInStatus}
      outlookStatus={integrationStatuses.outlookStatus}
      slackStatus={integrationStatuses.slackStatus}
      rail={<ContextRail memories={railMemories} />}
    >
      <div className="mx-auto max-w-6xl px-10 py-12">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[#0F172A]">
              Accounts
            </h1>
            <p className="mt-2 text-[14px] font-medium text-slate-500">
              Tracked organizations and inferred domains from synced workspace records.
            </p>
          </div>
          <Badge>{accounts.length} tracked</Badge>
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-[16px] font-semibold text-slate-700">
              No live accounts yet.
            </p>
            <p className="mt-2 text-[14px] font-medium text-slate-500">
              Connect Gmail, Outlook, Slack, or LinkedIn and run sync to derive accounts and
              stakeholder context.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <Link
                key={account.id}
                href={`/accounts/${account.id}` as Route}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-slate-300 hover:shadow-[0_12px_32px_rgba(15,23,42,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[20px] font-bold text-[#0F172A]">{account.name}</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-500">
                      {account.domain || "No domain"}
                    </p>
                  </div>
                  <Badge
                    className={
                      account.stage === "at_risk"
                        ? "border-[#F5CACA] bg-[#FDECEC] text-[#991B1B]"
                        : ""
                    }
                  >
                    {account.stage.replaceAll("_", " ")}
                  </Badge>
                </div>

                <div className="mt-5 space-y-2 text-[14px] text-slate-600">
                  <p>
                    <span className="font-semibold text-[#0F172A]">ARR:</span>{" "}
                    {formatCurrency(account.arr_estimate)}
                  </p>
                  <p>
                    <span className="font-semibold text-[#0F172A]">Owner:</span>{" "}
                    {account.owner_name || "Unassigned"}
                  </p>
                  <p>
                    <span className="font-semibold text-[#0F172A]">Priority:</span>{" "}
                    {account.priority}
                  </p>
                  <p>
                    <span className="font-semibold text-[#0F172A]">Last contacted:</span>{" "}
                    {formatRelativeDate(account.last_contacted_at)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
