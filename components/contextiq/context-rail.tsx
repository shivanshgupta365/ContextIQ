import {
  CheckCircle2,
  DollarSign,
  MessageSquare,
  Network,
  ShieldAlert,
} from "lucide-react";

import { mapContextRailItems } from "@/lib/context-memory";
import type { ActivePersonContextResponse, ContextMemoryType, RecalledMemory } from "@/types";

const ICON_BY_TYPE: Record<
  ContextMemoryType,
  typeof ShieldAlert | typeof MessageSquare | typeof CheckCircle2 | typeof DollarSign
> = {
  BLOCKER: ShieldAlert,
  PREFERENCE: MessageSquare,
  COMMITMENT: CheckCircle2,
  CONTEXT: DollarSign,
};

export function ContextRail({
  memories,
  activeContext,
  isLoading = false,
  subtitle,
  contextLabel,
  selectedContactId,
}: {
  memories: RecalledMemory[];
  activeContext?: ActivePersonContextResponse | null;
  isLoading?: boolean;
  subtitle?: string;
  contextLabel?: string | null;
  selectedContactId?: string | null;
}) {
  const items = mapContextRailItems({
    memories,
    selectedContactId,
  });

  const resolvedSubtitle =
    subtitle ??
    (activeContext
      ? activeContext.person
        ? `${Math.max(activeContext.useful_memories.length, activeContext.source_refs.length)} relationship-aware evidence blocks`
        : "Context built from live workspace evidence"
      : `${memories.length} relevant memories fetched`);

  const relationshipSections =
    activeContext != null
      ? [
          {
            title: "Person",
            body: activeContext.person
              ? [
                  activeContext.person.display_name,
                  activeContext.person.email,
                  activeContext.person.role,
                  activeContext.person.company,
                ]
                  .filter(Boolean)
                  .join(" • ")
              : "No resolved person for current context.",
          },
          {
            title: "Relationship",
            body:
              activeContext.relationship_summary ??
              "No explicit relationship summary has been generated yet.",
          },
          {
            title: "Last interaction",
            body:
              activeContext.last_interactions[0]?.body ??
              activeContext.timeline[0]?.body ??
              "No recent interaction found.",
          },
          {
            title: "Topics discussed",
            body: activeContext.topics.length
              ? activeContext.topics.join(" • ")
              : "No clustered topics available.",
          },
          {
            title: "Pending actions",
            body: activeContext.pending_actions.length
              ? activeContext.pending_actions.join(" • ")
              : "No explicit pending actions found.",
          },
          {
            title: "Useful memories",
            body: activeContext.useful_memories.length
              ? activeContext.useful_memories
                  .slice(0, 3)
                  .map((item) => item.body)
                  .join(" • ")
              : "No useful memory snippets available yet.",
          },
          {
            title: "Source trail",
            body: activeContext.source_refs.length
              ? activeContext.source_refs
                  .slice(0, 4)
                  .map((sourceRef) => `${sourceRef.source}:${sourceRef.ref_id}`)
                  .join(" • ")
              : "No source references captured yet.",
          },
          {
            title: "Suggested next step",
            body:
              activeContext.recommended_next_action ??
              "Run a scoped sync and retry retrieval for stronger evidence.",
          },
        ]
      : [];

  return (
    <aside className="z-10 flex h-full w-[340px] flex-shrink-0 flex-col border-l border-slate-200 bg-[#FDFDFD]">
      <div className="sticky top-0 border-b border-slate-200 bg-[#FDFDFD]/90 px-6 py-5 backdrop-blur-md">
        <div className="flex items-center gap-2 text-[14px] font-bold tracking-tight text-[#0F172A]">
          <Network size={16} className="text-slate-400" />
          Active Context
          {contextLabel ? <span className="font-medium text-slate-500">({contextLabel})</span> : null}
        </div>
        <p className="mt-1 text-[12px] font-semibold text-slate-500">{resolvedSubtitle}</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5 pb-8">
        {isLoading ? (
          <div className="space-y-4">
            <div className="h-28 animate-pulse rounded-xl border border-slate-200/50 bg-slate-100/50" />
            <div className="h-32 animate-pulse rounded-xl border border-slate-200/50 bg-slate-100/50" />
            <div className="mt-4 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Fetching relevant context...
            </div>
          </div>
        ) : activeContext ? (
          <div className="space-y-3">
            {relationshipSections.map((section) => (
              <div
                key={section.title}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)]"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {section.title}
                </p>
                <p className="mt-2 text-[13px] font-medium leading-relaxed text-slate-700">
                  {section.body}
                </p>
              </div>
            ))}
            {activeContext.degraded ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] font-medium text-amber-700">
                Partial context mode: {activeContext.degraded_reason ?? "Hydra unavailable, using fallback evidence."}
              </div>
            ) : null}
          </div>
        ) : items.length > 0 ? (
          items.map((item) => {
            const Icon = ICON_BY_TYPE[item.type];

            return (
            <div
              key={item.id}
              className={`group rounded-xl border border-slate-200 border-l-[4px] bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition-all duration-300 hover:border-r-slate-300 hover:border-y-slate-300 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] ${item.accentClassName}`}
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className={`rounded-md p-1.5 ${item.badgeClassName}`}>
                    <Icon size={12} className={item.iconClassName} strokeWidth={2.5} />
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest flex items-center flex-wrap ${item.iconClassName}`}
                  >
                    {item.type}
                    {item.relationLabel ? (
                      <>
                        <span className="mx-1.5 text-slate-300">•</span>
                        <span className="text-[#0F172A]">{item.relationLabel}</span>
                      </>
                    ) : null}
                  </span>
                </div>
              </div>
              <p className="mb-4 mt-2 text-[14px] font-medium leading-relaxed text-[#0F172A]">
                {item.content}
              </p>
              <div className="mb-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <span className="text-slate-600">{item.sourceLabel}</span>
                <span>•</span>
                <span>{item.dateLabel}</span>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-[12px] font-medium text-slate-600">
                <span className="font-bold text-slate-800">Why recalled:</span> {item.whyRecalled}
              </div>
            </div>
            );
          })
        ) : (
          <div className="p-6 text-center text-[14px] font-medium text-slate-400">
            No relevant context found yet.
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-slate-200 bg-[#FDFDFD] px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {activeContext ? "Relationship-aware context mode" : "Grounded by HydraDB + workspace evidence"}
      </div>
    </aside>
  );
}
