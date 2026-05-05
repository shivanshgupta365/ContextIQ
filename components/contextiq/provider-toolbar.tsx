"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Link2, Mail, MessageSquare, X } from "lucide-react";

import { formatRelativeDate } from "@/lib/utils";
import type {
  GmailIntegrationStatus,
  IntegrationProvider,
  LinkedInIntegrationStatus,
  OutlookIntegrationStatus,
  SlackIntegrationStatus,
} from "@/types";

type ToastState = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

function providerMeta(provider: IntegrationProvider) {
  switch (provider) {
    case "gmail":
      return {
        icon: Mail,
        connectLabel: "Connect Gmail",
        syncLabel: "Sync",
      };
    case "linkedin":
      return {
        icon: Link2,
        connectLabel: "Connect LinkedIn",
        syncLabel: "Sync LinkedIn",
      };
    case "outlook":
      return {
        icon: Mail,
        connectLabel: "Connect Outlook",
        syncLabel: "Sync Outlook",
      };
    case "slack":
      return {
        icon: MessageSquare,
        connectLabel: "Connect Slack",
        syncLabel: "Sync Slack",
      };
    default:
      return {
        icon: Link2,
        connectLabel: `Connect ${provider}`,
        syncLabel: `Sync ${provider}`,
      };
  }
}

function ProviderButton({
  provider,
  connected,
  nextPath,
  onToast,
  statusMessage,
}: {
  provider: IntegrationProvider;
  connected: boolean;
  nextPath: string;
  onToast: (toast: ToastState) => void;
  statusMessage?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const meta = providerMeta(provider);
  const Icon = meta.icon;

  const handleClick = () => {
    startTransition(async () => {
      try {
        const endpoint = connected
          ? `/api/integrations/${provider}/sync`
          : `/api/integrations/${provider}/connect`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nextPath }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          message: string;
          mode?: string;
          redirectUrl?: string;
        };

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || `${provider} request failed.`);
        }

        onToast({
          tone: payload.mode === "redirect" ? "info" : "success",
          message: payload.message,
        });

        if (payload.redirectUrl) {
          window.location.href = payload.redirectUrl;
          return;
        }

        router.refresh();
      } catch (error) {
        onToast({
          tone: "error",
          message: error instanceof Error ? error.message : `${provider} request failed.`,
        });
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {provider === "gmail" && connected ? (
        <span className="hidden rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 md:inline">
          Gmail connected
        </span>
      ) : null}
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        title={statusMessage ?? undefined}
      >
        <Icon size={13} />
        {isPending ? "Working..." : connected ? meta.syncLabel : meta.connectLabel}
      </button>
    </div>
  );
}

export function ProviderToolbar({
  basePath,
  gmailStatus,
  linkedInStatus,
  outlookStatus,
  slackStatus,
}: {
  basePath: string;
  gmailStatus?: GmailIntegrationStatus | null;
  linkedInStatus?: LinkedInIntegrationStatus | null;
  outlookStatus?: OutlookIntegrationStatus | null;
  slackStatus?: SlackIntegrationStatus | null;
}) {
  const [toast, setToast] = useState<ToastState>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextPath = `${pathname || `${basePath || ""}/overview`}${
    searchParams.toString() ? `?${searchParams.toString()}` : ""
  }`;

  const footerStatuses = useMemo(
    () =>
      [
        gmailStatus?.last_error
          ? { label: "Gmail sync error", tone: "error" as const }
          : gmailStatus?.last_synced_at
            ? { label: `Gmail: ${formatRelativeDate(gmailStatus.last_synced_at)}`, tone: "muted" as const }
            : null,
        linkedInStatus?.last_error
          ? { label: "LinkedIn sync error", tone: "error" as const }
          : linkedInStatus?.last_synced_at
            ? {
                label: `LinkedIn: ${formatRelativeDate(linkedInStatus.last_synced_at)}`,
                tone: "muted" as const,
              }
            : null,
        outlookStatus?.last_error
          ? { label: "Outlook sync error", tone: "error" as const }
          : outlookStatus?.last_synced_at
            ? { label: `Outlook: ${formatRelativeDate(outlookStatus.last_synced_at)}`, tone: "muted" as const }
            : null,
        slackStatus?.last_error
          ? { label: "Slack sync error", tone: "error" as const }
          : slackStatus?.last_synced_at
            ? { label: `Slack: ${formatRelativeDate(slackStatus.last_synced_at)}`, tone: "muted" as const }
            : null,
      ].filter(Boolean) as Array<{ label: string; tone: "error" | "muted" }>,
    [gmailStatus, linkedInStatus, outlookStatus, slackStatus],
  );

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <ProviderButton
            provider="gmail"
            connected={Boolean(gmailStatus?.connected)}
            nextPath={nextPath}
            onToast={setToast}
            statusMessage={gmailStatus?.last_error}
          />
          <ProviderButton
            provider="linkedin"
            connected={Boolean(linkedInStatus?.connected)}
            nextPath={nextPath}
            onToast={setToast}
            statusMessage={linkedInStatus?.last_error}
          />
          <ProviderButton
            provider="outlook"
            connected={Boolean(outlookStatus?.connected)}
            nextPath={nextPath}
            onToast={setToast}
            statusMessage={outlookStatus?.last_error}
          />
          <ProviderButton
            provider="slack"
            connected={Boolean(slackStatus?.connected && !slackStatus?.needs_reconnect)}
            nextPath={nextPath}
            onToast={setToast}
            statusMessage={
              slackStatus?.needs_reconnect
                ? "Reconnect required for per-user Slack retrieval."
                : slackStatus?.last_error
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] font-medium">
          {footerStatuses.map((item) => (
            <span
              key={item.label}
              className={item.tone === "error" ? "text-rose-500" : "text-slate-400"}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed right-6 top-20 z-[60] animate-in fade-in slide-in-from-top-2 duration-200">
          <div
            className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] ${
              toast.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : toast.tone === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-slate-200 bg-white text-slate-800"
            }`}
          >
            <div className="pt-0.5 text-[12px] font-semibold leading-relaxed">
              {toast.message}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="rounded-md p-1 text-current/70 transition-colors hover:bg-black/5 hover:text-current"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
