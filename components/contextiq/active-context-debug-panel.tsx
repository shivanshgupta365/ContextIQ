"use client";

import { useState, useTransition } from "react";

import type { ActivePersonContextResponse } from "@/types";

export function ActiveContextDebugPanel() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ActivePersonContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const runDebug = () => {
    const value = query.trim();
    if (!value) return;

    startTransition(async () => {
      setError(null);
      const response = await fetch("/api/context/active-person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_query: value, limit: 8 }),
      });

      const payload = (await response.json()) as ActivePersonContextResponse | { message?: string };
      if (!response.ok) {
        setResult(null);
        setError(payload && typeof payload === "object" && "message" in payload ? payload.message ?? "Debug request failed" : "Debug request failed");
        return;
      }

      setResult(payload as ActivePersonContextResponse);
    });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Active Context Debug
      </h2>
      <p className="mt-2 text-xs text-slate-500">
        Resolve a person query and inspect person-context diagnostics.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runDebug();
            }
          }}
          placeholder="name, email, or alias"
          className="h-10 min-w-[260px] flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none ring-slate-300 focus:ring"
        />
        <button
          type="button"
          onClick={runDebug}
          disabled={isPending || !query.trim()}
          className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {isPending ? "Resolving..." : "Resolve"}
        </button>
      </div>

      {error ? <p className="mt-3 text-xs font-medium text-rose-600">{error}</p> : null}

      {result ? (
        <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
          <div>resolved_person_id: {result.person?.person_id ?? result.resolver.person_id ?? "null"}</div>
          <div>confidence: {result.confidence}</div>
          <div>sources: {result.source_refs.map((entry) => entry.source).join(", ") || "none"}</div>
          <div>relationship_memories: {String(result.debug.relationship_memory_count ?? 0)}</div>
          <div>threads: {String(result.debug.linked_thread_count ?? 0)}</div>
          <div>messages: {String(result.debug.message_count ?? 0)}</div>
          <div>timeline_items: {result.timeline.length}</div>
          <div>recommended_next_action: {result.recommended_next_action ?? "none"}</div>
        </div>
      ) : null}
    </section>
  );
}
