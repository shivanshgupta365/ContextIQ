import Link from "next/link";
import type { Route } from "next";
import { ReactNode, Suspense } from "react";
import {
  Bell,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Command,
  MessageSquare,
  Link2,
  Mail,
  LayoutDashboard,
  Search,
  Settings,
  Users,
  Activity,
  CalendarDays,
  Zap,
  NotebookPen,
  ShieldCheck,
} from "lucide-react";

import { ContextIQLogo } from "@/components/contextiq/logo";
import { IntegrationStatusBanner } from "@/components/contextiq/integration-status-banner";
import { ProviderToolbar } from "@/components/contextiq/provider-toolbar";
import { signOutAction } from "@/lib/actions/contextiq";
import { cn, formatRelativeDate, getInitials } from "@/lib/utils";
import type {
  Account,
  GmailIntegrationStatus,
  LinkedInIntegrationStatus,
  OutlookIntegrationStatus,
  SlackIntegrationStatus,
} from "@/types";

const navItems = [
  {
    href: "/command-center" as Route,
    label: "Command Center",
    icon: Command,
    view: "command_center",
  },
  {
    href: "/overview" as Route,
    label: "Overview",
    icon: LayoutDashboard,
    view: "overview",
  },
  { href: "/accounts" as Route, label: "Accounts", icon: Briefcase, view: "accounts" },
  {
    href: "/contacts" as Route,
    label: "Contacts",
    icon: Users,
    view: "contacts",
  },
  {
    href: "/people" as Route,
    label: "People",
    icon: Users,
    view: "people",
  },
  {
    href: "/conversations" as Route,
    label: "Conversations",
    icon: MessageSquare,
    view: "conversations",
  },
  {
    href: "/meetings" as Route,
    label: "Meetings",
    icon: CalendarDays,
    view: "meetings",
  },
  {
    href: "/actions" as Route,
    label: "Actions",
    icon: Zap,
    view: "actions",
  },
  {
    href: "/notes-briefs" as Route,
    label: "Notes / Briefs",
    icon: NotebookPen,
    view: "notes_briefs",
  },
  {
    href: "/activity-audit" as Route,
    label: "Activity / Audit",
    icon: ShieldCheck,
    view: "activity_audit",
  },
  {
    href: "/activity" as Route,
    label: "Activity Stream (Legacy)",
    icon: Activity,
    view: "activity",
  },
];

const walkInNavItems = navItems.filter((item) =>
  ["overview", "accounts", "contacts", "activity"].includes(item.view),
);

export function WorkspaceShell({
  activeView,
  headerLabel,
  accounts,
  profileName,
  basePath = "",
  showSignOut = true,
  activeAccountId,
  rail,
  gmailStatus = null,
  linkedInStatus = null,
  outlookStatus = null,
  slackStatus = null,
  children,
}: {
  activeView:
    | "command_center"
    | "overview"
    | "accounts"
    | "contacts"
    | "people"
    | "conversations"
    | "meetings"
    | "actions"
    | "notes_briefs"
    | "activity_audit"
    | "activity";
  headerLabel: string;
  accounts: Account[];
  profileName: string;
  basePath?: string;
  showSignOut?: boolean;
  activeAccountId?: string;
  rail?: ReactNode;
  gmailStatus?: GmailIntegrationStatus | null;
  linkedInStatus?: LinkedInIntegrationStatus | null;
  outlookStatus?: OutlookIntegrationStatus | null;
  slackStatus?: SlackIntegrationStatus | null;
  children: ReactNode;
}) {
  const effectiveNavItems = basePath === "/walk-in" ? walkInNavItems : navItems;
  const gmailConnected = Boolean(gmailStatus?.connected);
  const linkedInConnected = Boolean(linkedInStatus?.connected);
  const outlookConnected = Boolean(outlookStatus?.connected);
  const slackConnected = Boolean(slackStatus?.connected);

  return (
    <div className="flex h-screen overflow-hidden bg-[#FDFDFD] font-sans text-[#0F172A] antialiased">
      <aside className="relative z-20 flex h-full w-[240px] flex-shrink-0 flex-col border-r border-slate-200/75 bg-[#F3F3F1]">
        <div className="mb-2 mt-2 flex h-14 items-center border-b border-slate-200/50 px-5 pb-2">
          <div className="flex items-center gap-3 text-[15px] font-bold tracking-tight text-slate-900">
            <ContextIQLogo className="h-7 w-7 rounded-lg shadow-sm" />
            ContextIQ
          </div>
          <ChevronDown size={14} className="ml-auto text-slate-400" />
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-1">
            {effectiveNavItems.map((item) =>
              (
                <Link
                  key={item.view}
                  href={`${basePath}${item.href}` as Route}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-[14px] font-medium transition-all duration-200",
                    activeView === item.view
                      ? "border-slate-200 bg-white text-slate-900 shadow-sm"
                      : "border-transparent text-slate-500 hover:bg-slate-200/50 hover:text-slate-900",
                  )}
                >
                  <item.icon
                    size={16}
                    className={activeView === item.view ? "text-slate-900" : "text-slate-400"}
                  />
                  {item.label}
                </Link>
              ),
            )}
          </div>

          <div className="mb-3 mt-8 px-3 text-[12px] font-semibold uppercase tracking-widest text-slate-400">
            Recent Contexts
          </div>
          <div className="space-y-1">
            {accounts.slice(0, 6).map((account) => (
              <Link
                key={account.id}
                href={`${basePath}/accounts/${account.id}` as Route}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2 text-[14px] transition-all duration-200",
                  activeAccountId === account.id
                    ? "border-slate-200 bg-white shadow-sm"
                    : "border-transparent hover:bg-slate-200/50",
                )}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div
                    className={cn(
                      "h-2 w-2 flex-shrink-0 rounded-full",
                      account.priority === "critical" || account.stage === "at_risk"
                        ? "bg-[#B91C1C]"
                        : account.priority === "high"
                          ? "bg-[#F97316]"
                          : "bg-[#15803D]",
                    )}
                  />
                  <span
                    className={cn(
                      "truncate",
                      activeAccountId === account.id
                        ? "font-semibold text-slate-900"
                        : "font-medium text-slate-600",
                    )}
                  >
                    {account.name}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200/75 bg-[#F3F3F1] p-4">
          {showSignOut ? (
            <div className="space-y-1">
              <Link
                href={"/settings" as Route}
                className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-200/50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                  {getInitials(profileName || "CI")}
                </div>
                <div className="text-[14px] font-bold text-slate-700 group-hover:text-slate-900">
                  {profileName}
                </div>
                <Settings size={14} className="ml-auto text-slate-400 group-hover:text-slate-600" />
              </Link>
              <form action={signOutAction} className="w-full">
                <button className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex w-full items-center gap-3 rounded-lg px-2 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                {getInitials(profileName || "CI")}
              </div>
              <div className="text-[14px] font-bold text-slate-700">{profileName}</div>
            </div>
          )}
        </div>
      </aside>

      <div className="relative z-20 flex min-w-0 flex-1 flex-col border-l border-slate-200/50 bg-white shadow-[-10px_0_30px_rgba(15,23,42,0.03)]">
        <header className="relative z-10 flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-8">
          <div className="flex items-center gap-2 text-[14px] font-medium text-slate-500">
            <Link
              href={`${basePath}/overview` as Route}
              className="transition-colors hover:text-slate-900"
            >
              Workspace
            </Link>
            <ChevronRight size={14} className="text-slate-300" />
            <span className="font-semibold text-slate-900">{headerLabel}</span>
          </div>

          <div className="flex items-center gap-4">
            {showSignOut ? (
              <ProviderToolbar
                basePath={basePath}
                gmailStatus={gmailStatus}
                linkedInStatus={linkedInStatus}
                outlookStatus={outlookStatus}
                slackStatus={slackStatus}
              />
            ) : null}

            <div className="group relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#2563EB]"
              />
              <input
                type="text"
                placeholder="Search context..."
                className="w-56 rounded-lg border border-transparent bg-slate-50 py-2 pl-9 pr-8 text-[14px] font-medium outline-none transition-all duration-300 placeholder:text-slate-400 hover:bg-slate-100 focus:w-72 focus:border-[#2563EB]/30 focus:bg-white focus:ring-2 focus:ring-[#2563EB]/5"
              />
            </div>
            <div className="h-5 w-px bg-slate-200" />
            <button className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900">
              <Bell size={15} />
            </button>
          </div>
        </header>
        <Suspense fallback={null}>
          <IntegrationStatusBanner />
        </Suspense>

        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto">{children}</main>
          {rail}
        </div>
      </div>
    </div>
  );
}
