"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Activity,
  ArrowRight,
  Briefcase,
  Calendar,
  Check,
  Clock,
  Mail,
  Phone,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { ContextRail } from "@/components/contextiq/context-rail";
import { EntityPinButton } from "@/components/contextiq/entity-pin-button";
import { CreateActivityForm } from "@/components/forms/create-activity-form";
import { CreateContactForm } from "@/components/forms/create-contact-form";
import { CreateNoteForm } from "@/components/forms/create-note-form";
import { Badge, SurfaceCard } from "@/components/contextiq/primitives";
import { filterMemoriesForContact, mergeMemoryPools } from "@/lib/context-memory";
import { runComposerAction } from "@/lib/actions/contextiq";
import { formatCurrency, formatDateTime, formatRelativeDate, getInitials } from "@/lib/utils";
import type {
  Account,
  AccountPageData,
  ActivityRecord,
  ComposerResult,
  Contact,
  GeneratedOutput,
  Note,
  RecalledMemory,
  TimelineItem,
} from "@/types";

function OutputCard({
  output,
}: {
  output: GeneratedOutput;
}) {
  const titleMap = {
    prepare_meeting: "Prepared Brief",
    draft_followup: "Drafted Follow-up",
    summarize_blockers: "Summarized Blockers",
    what_changed_recently: "Recent Changes",
  } as const;

  const iconMap = {
    prepare_meeting: <Sparkles size={14} strokeWidth={2.5} />,
    draft_followup: <Mail size={14} strokeWidth={2.5} />,
    summarize_blockers: <ShieldAlert size={14} strokeWidth={2.5} />,
    what_changed_recently: <Activity size={14} strokeWidth={2.5} />,
  } as const;

  return (
    <SurfaceCard
      title={titleMap[output.action_type]}
      icon={iconMap[output.action_type]}
      memoryCount={output.recalled_memories_json.length}
    >
      <div className="space-y-8">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Generated output
          </p>
          <div className="mt-4 whitespace-pre-wrap text-[15px] font-medium leading-relaxed text-[#0F172A]">
            {output.output_text}
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-[12px] font-bold uppercase tracking-widest text-slate-400">
            Memories Used
          </h4>
          <div className="space-y-3">
            {output.recalled_memories_json.map((memory, index) => (
              <div
                key={memory.id ?? `${memory.content}-${index}`}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <p className="text-[14px] font-medium leading-relaxed text-slate-700">
                  {memory.content}
                </p>
                <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  {memory.metadata.source_type} • {memory.metadata.account_name}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

function TimelineView({ timeline }: { timeline: TimelineItem[] }) {
  const iconMap = {
    email: Mail,
    note: Calendar,
    call: Phone,
    status: Activity,
    task: Check,
  } as const;

  return (
    <div className="animate-in fade-in duration-500 pt-6">
      <div className="mb-10 flex items-center justify-between">
        <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-400">
          Activity Timeline
        </h3>
      </div>
      <div className="ml-3">
        {timeline.length > 0 ? (
          timeline.map((item) => {
            const Icon = iconMap[item.type];

            return (
              <div key={item.id} className="group flex gap-6">
                <div className="flex flex-col items-center">
                  <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm">
                    <Icon size={18} />
                  </div>
                  <div className="group-last:hidden -mb-2 mt-2 h-full w-px bg-slate-200" />
                </div>
                <div className="flex-1 pb-12 pt-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[16px] font-bold tracking-tight text-slate-800">
                      {item.title}
                    </p>
                    {item.tag ? (
                      <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                        {item.tag}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[14px] font-medium text-slate-500">
                    {item.userLabel} • {item.dateLabel}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-[15px] font-medium text-slate-500">No recent activity.</p>
        )}
      </div>
    </div>
  );
}

export function AccountPageClient({
  workspaceId,
  allAccounts,
  initialData,
  initialSelectedContactId = null,
}: {
  workspaceId: string;
  allAccounts: Account[];
  initialData: AccountPageData;
  initialSelectedContactId?: string | null;
}) {
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    initialSelectedContactId,
  );
  const [prompt, setPrompt] = useState("");
  const [isGenerating, startTransition] = useTransition();
  const [result, setResult] = useState<ComposerResult | null>(
    initialData.latest_output
      ? {
          output: initialData.latest_output,
          memories: initialData.latest_output.recalled_memories_json,
        }
      : null,
  );
  const [contacts, setContacts] = useState(initialData.contacts);
  const [notes, setNotes] = useState(initialData.notes);
  const [activities, setActivities] = useState(initialData.activities);
  const [timeline, setTimeline] = useState(initialData.timeline);
  const [memoryPool, setMemoryPool] = useState<RecalledMemory[]>(initialData.memory_rail);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedContactId) ?? null,
    [contacts, selectedContactId],
  );

  const displayedMemories = useMemo(
    () => filterMemoriesForContact(memoryPool, selectedContactId, 6),
    [memoryPool, selectedContactId],
  );

  const runAction = (actionType: GeneratedOutput["action_type"]) => {
    startTransition(async () => {
      try {
        setActionError(null);
        const composerResult = await runComposerAction({
          workspaceId,
          accountId: initialData.account.id,
          contactId: selectedContactId,
          actionType,
          prompt,
        });
        setResult(composerResult);
        setMemoryPool((current) =>
          mergeMemoryPools(current, composerResult.memories, 24),
        );
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Action failed.");
      }
    });
  };

  const prependMemory = (memory: RecalledMemory) => {
    setMemoryPool((current) => mergeMemoryPools(current, [memory], 24));
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-10 py-12">
        <div className="mb-12">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Badge
              className={
                initialData.account.stage === "at_risk"
                  ? "border-[#F5CACA] bg-[#FDECEC] text-[#991B1B]"
                  : ""
              }
            >
              {initialData.account.stage.replaceAll("_", " ")}
            </Badge>
            <Badge>Priority: {initialData.account.priority}</Badge>
            <Badge>ARR: {formatCurrency(initialData.account.arr_estimate)}</Badge>
            <EntityPinButton
              workspaceId={workspaceId}
              entityType="account"
              entityId={initialData.account.id}
              title={initialData.account.name}
              subtitle={[
                initialData.account.domain,
                initialData.account.owner_name,
              ].filter(Boolean).join(" • ") || null}
            />
          </div>
          <h1 className="mb-3 text-[40px] font-extrabold leading-none tracking-tight text-[#0F172A]">
            {initialData.account.name}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-[15px] font-medium text-slate-500">
            <span className="flex items-center gap-2">
              <Briefcase size={16} />
              {initialData.account.domain || "No domain set"}
            </span>
            <span className="text-slate-300">•</span>
            <span>
              Owner:{" "}
              <span className="font-bold text-[#0F172A]">
                {initialData.account.owner_name || "Unassigned"}
              </span>
            </span>
            <span className="text-slate-300">•</span>
            <span className="flex items-center gap-2">
              <Clock size={16} />
              Last contacted {formatRelativeDate(initialData.account.last_contacted_at)}
            </span>
          </div>
        </div>

        <div className="mb-12 flex flex-col gap-5">
          <span className="text-[12px] font-bold uppercase tracking-widest text-slate-400">
            Key Stakeholders
          </span>
          <div className="flex flex-wrap gap-5">
            {contacts.map((contact) => {
              const isSelected = selectedContactId === contact.id;

              return (
                <div key={contact.id} className="-ml-4 flex items-start gap-3">
                  <button
                    onClick={() => setSelectedContactId(isSelected ? null : contact.id)}
                    className={`flex items-center gap-4 rounded-2xl p-4 text-left transition-all ${
                      isSelected
                        ? "bg-slate-50 ring-1 ring-slate-300 shadow-[0_4px_12px_rgba(15,23,42,0.04)]"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-full border text-[15px] font-bold shadow-sm transition-all ${
                        isSelected
                          ? "border-[#0F172A] bg-[#0F172A] text-white"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      {isSelected ? <Check size={20} strokeWidth={3} /> : getInitials(contact.name)}
                    </div>
                    <div>
                      <p className="text-[16px] font-bold leading-tight text-[#0F172A]">
                        {contact.name}
                      </p>
                      <p className="mt-1 text-[14px] font-medium text-slate-500">
                        {contact.title || "Stakeholder"}
                      </p>
                      <span className="mt-2.5 inline-block rounded border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        {(contact.role_type || "other").replaceAll("_", " ")}
                      </span>
                    </div>
                  </button>
                  <EntityPinButton
                    workspaceId={workspaceId}
                    entityType="contact"
                    entityId={contact.id}
                    title={contact.name}
                    subtitle={[contact.email, contact.title].filter(Boolean).join(" • ") || null}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative mb-10">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_24px_rgba(15,23,42,0.04)] transition-all focus-within:border-[#2563EB]">
            <div className="flex items-start gap-4 bg-white p-5">
              <Sparkles size={18} className="mt-1 text-[#2563EB]" />
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={`Ask ContextIQ to draft, summarize, or prepare${
                  selectedContact ? ` for ${selectedContact.name.split(" ")[0]}` : ""
                }...`}
                className="min-h-[70px] w-full resize-none bg-transparent text-[16px] font-medium leading-relaxed text-[#0F172A] outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                {[
                  ["prepare_meeting", "Prepare for meeting"],
                  ["draft_followup", "Draft follow-up"],
                  ["summarize_blockers", "Summarize blockers"],
                  ["what_changed_recently", "What changed recently?"],
                ].map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => runAction(type as GeneratedOutput["action_type"])}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-100"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => runAction("prepare_meeting")}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F172A] text-white shadow-md transition-colors hover:bg-slate-800"
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {actionError ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">
            {actionError}
          </div>
        ) : null}

        <div className="mt-8 mb-20">
          {isGenerating ? (
            <div className="space-y-5 animate-pulse">
              <div className="mb-6 h-8 w-1/4 rounded bg-slate-100" />
              <div className="h-72 rounded-2xl border border-slate-200 bg-slate-50" />
              <div className="mt-5 text-center text-[11px] font-bold uppercase tracking-widest text-[#2563EB]">
                Generating grounded output...
              </div>
            </div>
          ) : result ? (
            <OutputCard output={result.output} />
          ) : (
            <TimelineView timeline={timeline} />
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <CreateNoteForm
            workspaceId={workspaceId}
            accountId={initialData.account.id}
            contacts={contacts}
            onCreated={(note: Note) => {
              setNotes((current) => [note, ...current]);
              setTimeline((current) => [
                {
                  id: note.id,
                  type: "note",
                  title: note.title || "Added account note",
                  description: note.content,
                  dateLabel: formatDateTime(note.created_at),
                  userLabel: "Context note",
                  tag: note.topic,
                  highlight:
                    note.importance_level === "high" || note.importance_level === "critical",
                  accountId: initialData.account.id,
                  accountName: initialData.account.name,
                },
                ...current,
              ]);
              prependMemory({
                id: note.id,
                content: note.content,
                metadata: {
                  workspace_id: note.workspace_id,
                  account_id: note.account_id,
                  contact_id: note.contact_id,
                  source_type: note.source_type,
                  topic: note.topic,
                  importance_level: note.importance_level,
                  stage: initialData.account.stage,
                  created_at: note.created_at,
                  entity_type: "note",
                  account_name: initialData.account.name,
                  contact_name:
                    contacts.find((contact) => contact.id === note.contact_id)?.name ?? null,
                  contact_role_type:
                    contacts.find((contact) => contact.id === note.contact_id)?.role_type ?? null,
                },
              });
            }}
          />
          <CreateActivityForm
            workspaceId={workspaceId}
            accountId={initialData.account.id}
            contacts={contacts}
            onCreated={(activity: ActivityRecord) => {
              setActivities((current) => [activity, ...current]);
              setTimeline((current) => [
                {
                  id: activity.id,
                  type:
                    activity.activity_type.includes("email")
                      ? "email"
                      : activity.activity_type.includes("call") ||
                          activity.activity_type.includes("meeting")
                        ? "call"
                        : activity.activity_type.includes("task")
                          ? "task"
                          : activity.activity_type.includes("status")
                            ? "status"
                            : "note",
                  title: activity.title,
                  description: activity.description,
                  dateLabel: formatDateTime(activity.occurred_at),
                  userLabel: "Workspace activity",
                  tag: activity.activity_type.replaceAll("_", " "),
                  highlight: activity.activity_type === "status_changed",
                  accountId: initialData.account.id,
                  accountName: initialData.account.name,
                },
                ...current,
              ]);

              if (
                activity.description &&
                (activity.activity_type === "meeting_logged" ||
                  activity.activity_type === "email_received" ||
                  activity.activity_type === "status_changed" ||
                  activity.activity_type === "document_uploaded")
              ) {
                prependMemory({
                  id: activity.id,
                  content: activity.description,
                  metadata: {
                    workspace_id: activity.workspace_id,
                    account_id: activity.account_id,
                    contact_id: activity.contact_id,
                    source_type: "activity_summary",
                    topic:
                      typeof activity.metadata.topic === "string"
                        ? activity.metadata.topic
                        : activity.activity_type,
                    importance_level: "medium",
                    stage: initialData.account.stage,
                    created_at: activity.occurred_at,
                    entity_type: "activity",
                    account_name: initialData.account.name,
                    contact_name:
                      contacts.find((contact) => contact.id === activity.contact_id)?.name ??
                      null,
                    contact_role_type:
                      contacts.find((contact) => contact.id === activity.contact_id)?.role_type ??
                      null,
                  },
                });
              }
            }}
          />
          <CreateContactForm
            workspaceId={workspaceId}
            accounts={allAccounts}
            defaultAccountId={initialData.account.id}
            onCreated={(contact: Contact) => setContacts((current) => [contact, ...current])}
          />
        </div>
      </div>
      </div>

      <ContextRail
        memories={displayedMemories}
        isLoading={isGenerating}
        contextLabel={selectedContact?.name}
        selectedContactId={selectedContactId}
      />
    </div>
  );
}
