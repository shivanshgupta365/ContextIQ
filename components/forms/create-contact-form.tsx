"use client";

import { FormEvent, useState, useTransition } from "react";

import { EntityCandidateLookup } from "@/components/contextiq/entity-candidate-lookup";
import { createContactAction } from "@/lib/actions/contextiq";
import type { Account, Contact, WorkspaceEntityCandidate } from "@/types";

export function CreateContactForm({
  workspaceId,
  accounts,
  defaultAccountId,
  onCreated,
}: {
  workspaceId: string;
  accounts: Account[];
  defaultAccountId?: string;
  onCreated?: (contact: Contact) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [roleType, setRoleType] = useState("champion");
  const [communicationStyle, setCommunicationStyle] = useState("");
  const [preferenceSummary, setPreferenceSummary] = useState("");
  const [importanceLevel, setImportanceLevel] = useState("medium");
  const [error, setError] = useState<string | null>(null);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    useState<WorkspaceEntityCandidate | null>(null);

  const applyAccountCandidate = (candidate: WorkspaceEntityCandidate) => {
    const nextAccountId = candidate.account_id ?? candidate.id;
    setAccountId(nextAccountId);
    setLookupNotice(`Attached ${candidate.title} as the target account for this contact.`);
  };

  const applyPersonCandidate = (candidate: WorkspaceEntityCandidate) => {
    if (candidate.account_id) {
      setAccountId(candidate.account_id);
    }
    setName(candidate.title);
    setEmail(candidate.email ?? "");
    setTitle(candidate.role_title ?? "");
    setSelectedCandidate(candidate);
    setLookupNotice(
      candidate.contact_id
        ? "Prefilled from an existing synced person/contact. Review before creating another contact record."
        : "Prefilled from synced entity data.",
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    startTransition(async () => {
      try {
        setError(null);
        const created = await createContactAction({
          workspaceId,
          accountId,
          name,
          email,
          title,
          roleType,
          communicationStyle,
          preferenceSummary,
          importanceLevel,
        });
        setName("");
        setEmail("");
        setTitle("");
        setCommunicationStyle("");
        setPreferenceSummary("");
        setLookupNotice(null);
        setSelectedCandidate(null);
        onCreated?.(created);
      } catch (submitError) {
        setError(
          submitError instanceof Error ? submitError.message : "Failed to create contact.",
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
          Create contact
        </h3>
        <p className="mt-2 text-[14px] font-medium text-slate-500">
          Attach real stakeholders to the workspace account graph.
        </p>
      </div>
      <div className="mb-5">
        <EntityCandidateLookup
          workspaceId={workspaceId}
          title="Lookup synced entities first"
          subtitle="Search accounts and people already pulled in from connected data, then attach the matching account or prefill the contact form."
          placeholder="Search by account, person, email, title, or alias"
          accountActionLabel="Attach account"
          personActionLabel="Prefill contact"
          onUseAccountCandidate={applyAccountCandidate}
          onUsePersonCandidate={applyPersonCandidate}
        />
      </div>
      {lookupNotice ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-medium text-amber-800">
          <div>{lookupNotice}</div>
          {selectedCandidate ? (
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold uppercase tracking-widest text-amber-700">
                Prefill source: {selectedCandidate.title}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedCandidate(null);
                  setLookupNotice(null);
                }}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white md:col-span-2"
        >
          {accounts.length === 0 ? <option value="">No accounts available</option> : null}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Contact name"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        />
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        />
        <select
          value={roleType}
          onChange={(event) => setRoleType(event.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        >
          {[
            "champion",
            "economic_buyer",
            "technical_buyer",
            "procurement",
            "decision_maker",
            "end_user",
            "other",
          ].map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <input
          value={communicationStyle}
          onChange={(event) => setCommunicationStyle(event.target.value)}
          placeholder="Communication style"
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        />
        <select
          value={importanceLevel}
          onChange={(event) => setImportanceLevel(event.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white"
        >
          {["low", "medium", "high", "critical"].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <textarea
          value={preferenceSummary}
          onChange={(event) => setPreferenceSummary(event.target.value)}
          placeholder="Preference summary"
          className="min-h-[96px] rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] font-medium outline-none focus:border-[#2563EB] focus:bg-white md:col-span-2"
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
        {isPending ? "Creating..." : "Create contact"}
      </button>
    </form>
  );
}
