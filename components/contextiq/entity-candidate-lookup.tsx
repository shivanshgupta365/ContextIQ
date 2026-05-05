"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState, useTransition } from "react";

import { searchWorkspaceEntityCandidatesAction } from "@/lib/actions/contextiq";
import type {
  WorkspaceEntityCandidate,
  WorkspaceEntitySearchResponse,
} from "@/types";

import { EntityPinButton } from "@/components/contextiq/entity-pin-button";

function CandidateCard({
  workspaceId,
  candidate,
  onUse,
  useLabel,
}: {
  workspaceId: string;
  candidate: WorkspaceEntityCandidate;
  onUse?: (candidate: WorkspaceEntityCandidate) => void;
  useLabel?: string;
}) {
  const accountHref = candidate.account_id
    ? candidate.contact_id
      ? `/accounts/${candidate.account_id}?contact=${encodeURIComponent(candidate.contact_id)}`
      : `/accounts/${candidate.account_id}`
    : candidate.kind === "account" && candidate.id
      ? `/accounts/${candidate.id}`
      : null;
  const canPin =
    candidate.kind === "account"
      ? Boolean(candidate.account_id ?? candidate.id)
      : Boolean(candidate.contact_id);
  const pinEntityId =
    candidate.kind === "account"
      ? candidate.account_id ?? candidate.id
      : candidate.contact_id ?? null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {candidate.kind}
        </span>
        {candidate.provider ? (
          <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-700">
            {candidate.provider}
          </span>
        ) : null}
        {candidate.kind === "person" && candidate.contact_id ? (
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
            Existing contact
          </span>
        ) : null}
      </div>
      <p className="text-[15px] font-bold text-[#0F172A]">{candidate.title}</p>
      <p className="mt-1 text-[13px] font-medium leading-relaxed text-slate-500">
        {candidate.subtitle || "No additional context available yet."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {onUse ? (
          <button
            type="button"
            onClick={() => onUse(candidate)}
            className="rounded-lg bg-[#0F172A] px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-slate-800"
          >
            {useLabel ?? "Use"}
          </button>
        ) : null}
        {accountHref ? (
          <Link
            href={accountHref as Route}
            className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600 transition-colors hover:bg-slate-50"
          >
            Open context
          </Link>
        ) : null}
        {canPin && pinEntityId ? (
          <EntityPinButton
            workspaceId={workspaceId}
            entityType={candidate.kind === "account" ? "account" : "contact"}
            entityId={pinEntityId}
            title={candidate.title}
            subtitle={candidate.subtitle}
          />
        ) : null}
      </div>
    </div>
  );
}

export function EntityCandidateLookup({
  workspaceId,
  title,
  subtitle,
  placeholder,
  accountActionLabel = "Use account",
  personActionLabel = "Use person",
  onUseAccountCandidate,
  onUsePersonCandidate,
}: {
  workspaceId: string;
  title: string;
  subtitle: string;
  placeholder: string;
  accountActionLabel?: string;
  personActionLabel?: string;
  onUseAccountCandidate?: (candidate: WorkspaceEntityCandidate) => void;
  onUsePersonCandidate?: (candidate: WorkspaceEntityCandidate) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceEntitySearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    startTransition(async () => {
      try {
        setError(null);
        const response = await searchWorkspaceEntityCandidatesAction({
          workspaceId,
          query,
        });
        setResults(response);
        setSearched(true);
      } catch (searchError) {
        setResults(null);
        setSearched(true);
        setError(
          searchError instanceof Error ? searchError.message : "Entity lookup failed.",
        );
      }
    });
  };

  const accountCandidates = results?.accounts ?? [];
  const personCandidates = results?.people ?? [];
  const hasResults = accountCandidates.length > 0 || personCandidates.length > 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-4">
        <h4 className="text-[12px] font-bold uppercase tracking-widest text-slate-400">
          {title}
        </h4>
        <p className="mt-2 text-[13px] font-medium leading-relaxed text-slate-500">
          {subtitle}
        </p>
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB]"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={isPending || query.trim().length < 2}
          className="rounded-xl bg-[#2563EB] px-4 py-3 text-[12px] font-bold uppercase tracking-widest text-white disabled:opacity-60"
        >
          {isPending ? "Searching..." : "Lookup"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      {searched ? (
        <div className="mt-4 space-y-4">
          {hasResults ? (
            <>
              {accountCandidates.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    Accounts
                  </p>
                  {accountCandidates.map((candidate) => (
                    <CandidateCard
                      key={`${candidate.kind}-${candidate.id}`}
                      workspaceId={workspaceId}
                      candidate={candidate}
                      onUse={onUseAccountCandidate}
                      useLabel={accountActionLabel}
                    />
                  ))}
                </div>
              ) : null}
              {personCandidates.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    People
                  </p>
                  {personCandidates.map((candidate) => (
                    <CandidateCard
                      key={`${candidate.kind}-${candidate.id}-${candidate.contact_id ?? "none"}`}
                      workspaceId={workspaceId}
                      candidate={candidate}
                      onUse={onUsePersonCandidate}
                      useLabel={personActionLabel}
                    />
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-medium text-slate-500">
              No synced entities matched that lookup yet.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
