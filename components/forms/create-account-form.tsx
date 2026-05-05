"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { EntityCandidateLookup } from "@/components/contextiq/entity-candidate-lookup";
import { createAccountAction } from "@/lib/actions/contextiq";
import type { WorkspaceEntityCandidate } from "@/types";

export function CreateAccountForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [stage, setStage] = useState("discovery");
  const [priority, setPriority] = useState("medium");
  const [arrEstimate, setArrEstimate] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);

  const applyAccountCandidate = (candidate: WorkspaceEntityCandidate) => {
    setName(candidate.title);
    setDomain(candidate.domain ?? "");
    setLookupNotice(
      "Prefilled from an existing synced account. Open its context from the lookup card if this is the same workspace record.",
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    startTransition(async () => {
      try {
        setError(null);
        const account = await createAccountAction({
          workspaceId,
          name,
          domain,
          industry,
          stage,
          priority,
          arrEstimate: arrEstimate ? Number(arrEstimate) : undefined,
          ownerName,
        });
        router.push(`/accounts/${account.id}`);
      } catch (submitError) {
        setError(
          submitError instanceof Error ? submitError.message : "Failed to create account.",
        );
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-5">
        <h3 className="text-[14px] font-bold uppercase tracking-widest text-slate-400">
          Create account
        </h3>
        <p className="mt-2 text-[14px] font-medium text-slate-500">
          Add a live customer account to your workspace pipeline.
        </p>
      </div>
      <div className="mb-5">
        <EntityCandidateLookup
          workspaceId={workspaceId}
          title="Check synced accounts first"
          subtitle="Search accounts already materialized from connected data before you add a new one."
          placeholder="Search by account name, domain, owner, stage, or priority"
          accountActionLabel="Prefill account"
          onUseAccountCandidate={applyAccountCandidate}
        />
      </div>
      {lookupNotice ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-medium text-amber-800">
          {lookupNotice}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Account name"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        />
        <input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="Domain"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        />
        <input
          value={industry}
          onChange={(event) => setIndustry(event.target.value)}
          placeholder="Industry"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        />
        <input
          value={ownerName}
          onChange={(event) => setOwnerName(event.target.value)}
          placeholder="Owner"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        />
        <select
          value={stage}
          onChange={(event) => setStage(event.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        >
          {[
            "prospect",
            "discovery",
            "evaluation",
            "negotiation",
            "customer",
            "at_risk",
          ].map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        >
          {["low", "medium", "high", "critical"].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          value={arrEstimate}
          onChange={(event) => setArrEstimate(event.target.value)}
          placeholder="ARR estimate"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white md:col-span-2"
        />
      </div>
      {error ? (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="mt-4 rounded-xl bg-[#0F172A] px-4 py-3 text-[13px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
      >
        {isPending ? "Creating..." : "Create account"}
      </button>
    </form>
  );
}
