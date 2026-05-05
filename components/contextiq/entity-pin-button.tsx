"use client";

import { useState, useTransition } from "react";

import { pinWorkspaceContextAction } from "@/lib/actions/contextiq";

type PinEntityType = "account" | "contact";

export function EntityPinButton({
  workspaceId,
  entityType,
  entityId,
  title,
  subtitle,
  label = "Pin",
  pinnedLabel = "Pinned",
  className = "",
  onPinned,
}: {
  workspaceId: string;
  entityType: PinEntityType;
  entityId: string;
  title: string;
  subtitle?: string | null;
  label?: string;
  pinnedLabel?: string;
  className?: string;
  onPinned?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "pinned" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handlePin = () => {
    startTransition(async () => {
      try {
        setError(null);
        await pinWorkspaceContextAction({
          workspaceId,
          entityType,
          entityId,
          title,
          subtitle: subtitle ?? null,
        });
        setStatus("pinned");
        onPinned?.();
      } catch (pinError) {
        setStatus("error");
        setError(pinError instanceof Error ? pinError.message : "Pin failed.");
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handlePin}
        disabled={isPending}
        className={`rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60 ${className}`}
      >
        {isPending ? "Pinning..." : status === "pinned" ? pinnedLabel : label}
      </button>
      {status === "error" && error ? (
        <p className="text-[11px] font-medium text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
