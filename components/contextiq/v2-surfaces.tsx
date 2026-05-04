"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Clock3, Search, Send, ShieldAlert } from "lucide-react";

import { Badge, SurfaceCard } from "@/components/contextiq/primitives";
import { formatDateTime } from "@/lib/utils";
import type {
  CommandSearchHit,
  IntegrationProvider,
  ProviderReadinessStatus,
} from "@/types";

export function ProviderReadinessGrid({
  readiness,
}: {
  readiness: ProviderReadinessStatus[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {readiness.map((provider) => (
        <div
          key={provider.provider}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[14px] font-bold text-[#0F172A]">{provider.provider}</p>
            <Badge
              className={
                provider.status === "connected"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : provider.status === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
              }
            >
              {provider.status.replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="text-[12px] font-medium text-slate-500">{provider.message}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {provider.capabilities.map((capability) => (
              <span
                key={`${provider.provider}-${capability.key}`}
                className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                  capability.supported
                    ? "border-slate-200 bg-slate-50 text-slate-600"
                    : "border-slate-200 bg-white text-slate-400"
                }`}
              >
                {capability.key}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CommandCenterSurface({
  workspaceId,
  readiness,
}: {
  workspaceId: string;
  readiness: ProviderReadinessStatus[];
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CommandSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  const runSearch = () => {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/command/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            query,
            timeframeDays: 30,
            limit: 12,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Search failed.");
        setHits(data.hits ?? []);
        setHasSearched(true);
      } catch (searchError) {
        setError(searchError instanceof Error ? searchError.message : "Search failed.");
        setHasSearched(true);
      }
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <SurfaceCard title="Command Center" icon={<Search size={14} />} memoryCount={hits.length}>
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="show recent messages and blockers for esyasoft in last 30 days"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-medium text-slate-800 outline-none focus:border-[#2563EB]/40"
              />
              <button
                disabled={isPending || !query.trim()}
                onClick={runSearch}
                className="rounded-lg bg-[#2563EB] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60"
              >
                Search
              </button>
            </div>
            {error ? <p className="mt-2 text-[12px] font-medium text-rose-600">{error}</p> : null}
          </div>

          <div className="space-y-3">
            {hits.length === 0 ? (
              <p className="text-[14px] font-medium text-slate-500">
                {hasSearched
                  ? "No live records yet; connect and sync Gmail, LinkedIn, Outlook, or Slack."
                  : "Run a cross-tool query to retrieve live account context and next actions."}
              </p>
            ) : (
              hits.map((hit) => (
                <div key={hit.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge>{hit.type}</Badge>
                    {hit.provider ? <Badge>{hit.provider}</Badge> : null}
                  </div>
                  <p className="text-[14px] font-bold text-[#0F172A]">{hit.title}</p>
                  <p className="mt-1 text-[13px] font-medium text-slate-600">{hit.snippet}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </SurfaceCard>

      <div className="mt-8">
        <h3 className="mb-3 text-[12px] font-bold uppercase tracking-widest text-slate-400">
          Provider Readiness
        </h3>
        <ProviderReadinessGrid readiness={readiness} />
      </div>
    </div>
  );
}

export function PeopleSurface({
  contacts,
  people,
  aliases,
}: {
  contacts: object[];
  people: object[];
  aliases: object[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SurfaceCard title="CRM Contacts" icon={<CheckCircle2 size={14} />} memoryCount={contacts.length}>
          <SimpleRecordList records={contacts} titleKey="name" subtitleKey="email" />
        </SurfaceCard>
        <SurfaceCard title="Unified People" icon={<CheckCircle2 size={14} />} memoryCount={people.length}>
          <SimpleRecordList records={people} titleKey="full_name" subtitleKey="email" />
        </SurfaceCard>
        <SurfaceCard title="Identity Aliases" icon={<ShieldAlert size={14} />} memoryCount={aliases.length}>
          <SimpleRecordList records={aliases} titleKey="alias_value" subtitleKey="provider" />
        </SurfaceCard>
      </div>
    </div>
  );
}

export function ConversationsSurface({
  conversations,
  messages,
  legacyActivities,
}: {
  conversations: object[];
  messages: object[];
  legacyActivities: object[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SurfaceCard title="Conversations" icon={<Send size={14} />} memoryCount={conversations.length}>
          <SimpleRecordList records={conversations} titleKey="subject" subtitleKey="channel" />
        </SurfaceCard>
        <SurfaceCard title="Messages" icon={<Send size={14} />} memoryCount={messages.length}>
          <SimpleRecordList records={messages} titleKey="body" subtitleKey="direction" />
        </SurfaceCard>
        <SurfaceCard title="Legacy Email Feed" icon={<Clock3 size={14} />} memoryCount={legacyActivities.length}>
          <SimpleRecordList records={legacyActivities} titleKey="title" subtitleKey="activity_type" />
        </SurfaceCard>
      </div>
    </div>
  );
}

export function MeetingsSurface({
  meetings,
  legacyMeetings,
}: {
  meetings: object[];
  legacyMeetings: object[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SurfaceCard title="Meetings" icon={<Clock3 size={14} />} memoryCount={meetings.length}>
          <SimpleRecordList records={meetings} titleKey="topic" subtitleKey="starts_at" />
        </SurfaceCard>
        <SurfaceCard title="Meeting Activity" icon={<Clock3 size={14} />} memoryCount={legacyMeetings.length}>
          <SimpleRecordList records={legacyMeetings} titleKey="title" subtitleKey="occurred_at" />
        </SurfaceCard>
      </div>
    </div>
  );
}

export function NotesBriefsSurface({
  notes,
  documents,
}: {
  notes: object[];
  documents: object[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SurfaceCard title="Notes" icon={<ShieldAlert size={14} />} memoryCount={notes.length}>
          <SimpleRecordList records={notes} titleKey="title" subtitleKey="source_type" />
        </SurfaceCard>
        <SurfaceCard title="Brief Documents" icon={<ShieldAlert size={14} />} memoryCount={documents.length}>
          <SimpleRecordList records={documents} titleKey="title" subtitleKey="kind" />
        </SurfaceCard>
      </div>
    </div>
  );
}

export function ActionsSurface({
  workspaceId,
  readiness,
}: {
  workspaceId: string;
  readiness: ProviderReadinessStatus[];
}) {
  const [provider, setProvider] = useState<IntegrationProvider>("gmail");
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const runAction = () => {
    startTransition(async () => {
      const response = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          actionType:
            provider === "slack"
              ? "post_slack"
              : provider === "google_calendar"
                ? "create_calendar_event"
                : provider === "intercom"
                  ? "reply_intercom"
                  : provider === "twilio"
                    ? "send_sms"
                    : provider === "notion"
                      ? "create_notion_brief"
                      : "send_email",
          payload: {
            summary: "Auto-generated action execution from Actions tab.",
          },
        }),
      });
      const data = await response.json();
      setResult(
        response.ok
          ? `Action recorded: ${data.providerStatus?.status ?? "unknown"}`
          : `Action failed: ${data.message ?? "unknown error"}`,
      );
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <SurfaceCard title="Action Engine" icon={<Send size={14} />} memoryCount={0}>
        <div className="space-y-4">
          <p className="text-[14px] font-medium text-slate-600">
            Auto-execution is enabled. Actions write to provider when available, otherwise they log
            deterministic pending status.
          </p>
          <div className="flex items-center gap-2">
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as IntegrationProvider)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700"
            >
              {readiness.map((item) => (
                <option key={item.provider} value={item.provider}>
                  {item.provider}
                </option>
              ))}
            </select>
            <button
              onClick={runAction}
              disabled={isPending}
              className="rounded-lg bg-[#2563EB] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60"
            >
              Execute Action
            </button>
          </div>
          {result ? <p className="text-[12px] font-medium text-slate-600">{result}</p> : null}
        </div>
      </SurfaceCard>

      <div className="mt-8">
        <h3 className="mb-3 text-[12px] font-bold uppercase tracking-widest text-slate-400">
          Provider Readiness
        </h3>
        <ProviderReadinessGrid readiness={readiness} />
      </div>
    </div>
  );
}

export function ActivityAuditSurface({
  timelineEvents,
  actionExecutions,
  syncRuns,
}: {
  timelineEvents: object[];
  actionExecutions: object[];
  syncRuns: object[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SurfaceCard title="Timeline Events" icon={<Clock3 size={14} />} memoryCount={timelineEvents.length}>
          <SimpleRecordList records={timelineEvents} titleKey="summary" subtitleKey="occurred_at" />
        </SurfaceCard>
        <SurfaceCard title="Action Executions" icon={<Send size={14} />} memoryCount={actionExecutions.length}>
          <SimpleRecordList records={actionExecutions} titleKey="action_type" subtitleKey="created_at" />
        </SurfaceCard>
        <SurfaceCard title="Sync Runs" icon={<CheckCircle2 size={14} />} memoryCount={syncRuns.length}>
          <SimpleRecordList records={syncRuns} titleKey="provider" subtitleKey="status" />
        </SurfaceCard>
      </div>
    </div>
  );
}

function SimpleRecordList({
  records,
  titleKey,
  subtitleKey,
}: {
  records: object[];
  titleKey: string;
  subtitleKey: string;
}) {
  if (records.length === 0) {
    return <p className="text-[14px] font-medium text-slate-500">No records available yet.</p>;
  }

  return (
    <div className="space-y-3">
      {records.slice(0, 14).map((record, index) => {
        const objectRecord = record as Record<string, unknown>;
        const rawTitle = objectRecord[titleKey];
        const rawSubtitle = objectRecord[subtitleKey];
        const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle : "Untitled";
        const subtitle =
          typeof rawSubtitle === "string"
            ? rawSubtitle.includes("T")
              ? formatDateTime(rawSubtitle)
              : rawSubtitle
            : rawSubtitle == null
              ? "-"
              : String(rawSubtitle);

        return (
          <div key={`${title}-${subtitle}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="line-clamp-2 text-[13px] font-bold text-slate-800">{title}</p>
            <p className="mt-1 text-[12px] font-medium text-slate-500">{subtitle}</p>
          </div>
        );
      })}
    </div>
  );
}
