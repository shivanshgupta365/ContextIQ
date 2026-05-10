import { runCommandSearch } from "@/lib/command/search";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resolvePersonIdentity } from "@/lib/context/resolver";
import type {
  ActiveContextSection,
  ActiveContextSourceRef,
  ActivePersonContextResponse,
  CommandSearchRequest,
  CommandSearchResponse,
  ComposeContextResponse,
  MeetingContextResponse,
  PersonResolverMatch,
  ThreadContextResponse,
} from "@/types";

function toTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 12);
}

function toSourceRefs(value: unknown): ActiveContextSourceRef[] {
  if (!Array.isArray(value)) return [];
  const refs: ActiveContextSourceRef[] = [];
  for (const entry of value) {
    const mapped = (() => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const source = typeof record.source === "string" ? record.source : null;
      const refId =
        typeof record.ref_id === "string"
          ? record.ref_id
          : typeof record.id === "string"
          ? record.id
            : null;
      if (!source || !refId) return null;
      return {
        source,
        ref_id: refId,
        label: typeof record.label === "string" ? record.label : null,
        occurred_at: typeof record.occurred_at === "string" ? record.occurred_at : null,
      } satisfies ActiveContextSourceRef;
    })();
    if (mapped) refs.push(mapped);
    if (refs.length >= 12) break;
  }
  return refs;
}

function normalizeSummary(value: string | null | undefined) {
  const summary = (value ?? "").trim();
  return summary.length > 0 ? summary : null;
}

function buildNoPersonResponse(resolver: ActivePersonContextResponse["resolver"]): ActivePersonContextResponse {
  const best = resolver.matches[0] ?? null;
  const disambiguation =
    resolver.matches.length > 1
      ? `Multiple matches found: ${resolver.matches.map((match) => match.display_name).join(", ")}. Refine using email or company.`
      : best
        ? `Context candidate found (${best.display_name}) but confidence is low. Refine with email or company.`
        : "No person match found yet. Search by full name, email, or company to build active context.";

  return {
    context_mode: "person_context",
    confidence: resolver.confidence,
    person: null,
    resolver,
    relationship_summary: null,
    last_interactions: [],
    topics: [],
    pending_actions: [],
    source_refs: [],
    timeline: [],
    useful_memories: [],
    recommended_next_action: disambiguation,
    debug: {
      person_match_count: resolver.matches.length,
    },
    degraded: false,
    degraded_reason: null,
  };
}

export async function runMemorySearch(
  input: CommandSearchRequest,
): Promise<CommandSearchResponse & { context_mode: "semantic_search" }> {
  const result = await runCommandSearch(input);
  return {
    ...result,
    context_mode: "semantic_search",
  };
}

export async function getActivePersonContext(input: {
  workspaceId: string;
  personId?: string | null;
  personQuery?: string | null;
  accountId?: string | null;
  limit?: number;
}): Promise<ActivePersonContextResponse> {
  const supabase = await getSupabaseServerClient();
  const limit = Math.max(1, Math.min(input.limit ?? 8, 30));

  const resolver = await resolvePersonIdentity({
    workspaceId: input.workspaceId,
    personId: input.personId ?? null,
    query: input.personQuery ?? null,
    accountId: input.accountId ?? null,
    limit: 6,
  });

  if (!resolver.person_id) {
    return buildNoPersonResponse(resolver);
  }

  const personId = resolver.person_id;

  const personResult = await supabase
    .from("people")
    .select("id,full_name,email,title,organization_id,contact_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", personId)
    .maybeSingle();

  if (personResult.error) throw personResult.error;

  const person = personResult.data as {
    id: string;
    full_name: string;
    email: string | null;
    title: string | null;
    organization_id: string | null;
    contact_id: string | null;
  } | null;

  if (!person) {
    return buildNoPersonResponse({ ...resolver, person_id: null });
  }

  const [relResult, linkResult, convResult, msgResult, notesResult, activitiesResult] =
    await Promise.all([
      supabase
        .from("relationship_memories")
        .select(
          "id,summary,relationship_type,status,sentiment,last_interaction_at,topics,pending_actions,source_refs,updated_at",
        )
        .eq("workspace_id", input.workspaceId)
        .eq("person_id", personId)
        .order("updated_at", { ascending: false })
        .limit(6),
      supabase
        .from("person_thread_links")
        .select("conversation_id,role,last_seen_at,source_provider")
        .eq("workspace_id", input.workspaceId)
        .eq("person_id", personId)
        .order("last_seen_at", { ascending: false })
        .limit(12),
      supabase
        .from("conversations")
        .select("id,channel,subject,last_message_at,organization_id")
        .eq("workspace_id", input.workspaceId)
        .eq("person_id", personId)
        .order("last_message_at", { ascending: false })
        .limit(12),
      supabase
        .from("messages")
        .select("id,body,sent_at,direction,source_provider,conversation_id")
        .eq("workspace_id", input.workspaceId)
        .eq("person_id", personId)
        .order("sent_at", { ascending: false })
        .limit(30),
      person.contact_id
        ? supabase
            .from("notes")
            .select("id,title,content,topic,created_at,source_type")
            .eq("workspace_id", input.workspaceId)
            .eq("contact_id", person.contact_id)
            .order("created_at", { ascending: false })
            .limit(16)
        : Promise.resolve({
            data: [] as Array<Record<string, unknown>>,
            error: null,
          }),
      person.contact_id
        ? supabase
            .from("activities")
            .select("id,title,description,occurred_at,activity_type,metadata")
            .eq("workspace_id", input.workspaceId)
            .eq("contact_id", person.contact_id)
            .order("occurred_at", { ascending: false })
            .limit(16)
        : Promise.resolve({
            data: [] as Array<Record<string, unknown>>,
            error: null,
          }),
    ]);

  if (relResult.error && relResult.error.code !== "42P01") throw relResult.error;
  if (linkResult.error && linkResult.error.code !== "42P01") throw linkResult.error;
  if (convResult.error) throw convResult.error;
  if (msgResult.error) throw msgResult.error;
  if (notesResult.error) throw notesResult.error;
  if (activitiesResult.error) throw activitiesResult.error;

  const org = person.organization_id
    ? await supabase
        .from("organizations")
        .select("name")
        .eq("workspace_id", input.workspaceId)
        .eq("id", person.organization_id)
        .maybeSingle()
    : { data: null as { name?: string } | null, error: null };

  if (org.error) throw org.error;

  const relationshipRows = (relResult.data ?? []) as Array<Record<string, unknown>>;
  const latestRelationship = relationshipRows[0] ?? null;

  const messageRows = (msgResult.data ?? []) as Array<Record<string, unknown>>;
  const noteRows = (notesResult.data ?? []) as Array<Record<string, unknown>>;
  const activityRows = (activitiesResult.data ?? []) as Array<Record<string, unknown>>;
  const linkedConversations = (linkResult.data ?? []) as Array<Record<string, unknown>>;
  const scopedConversations = (convResult.data ?? []) as Array<Record<string, unknown>>;

  const usefulMemories: ActiveContextSection[] = [
    ...messageRows.slice(0, 4).map((message) => ({
      title: `Message (${String(message.direction ?? "unknown")})`,
      body: String(message.body ?? "").slice(0, 300),
    })),
    ...noteRows.slice(0, 3).map((note) => ({
      title: String(note.title ?? note.topic ?? "Note"),
      body: String(note.content ?? "").slice(0, 300),
    })),
    ...activityRows.slice(0, 3).map((activity) => ({
      title: String(activity.title ?? "Activity"),
      body: String(activity.description ?? activity.activity_type ?? "").slice(0, 260),
    })),
  ].slice(0, limit);

  const timeline: ActiveContextSection[] = [
    ...activityRows.slice(0, 6).map((activity) => ({
      title: String(activity.title ?? "Activity"),
      body: `${String(activity.occurred_at ?? "")}${activity.description ? ` • ${String(activity.description)}` : ""}`,
    })),
    ...messageRows.slice(0, 4).map((message) => ({
      title: `Message (${String(message.source_provider ?? "provider")})`,
      body: `${String(message.sent_at ?? "")}${message.body ? ` • ${String(message.body).slice(0, 180)}` : ""}`,
    })),
  ].slice(0, limit);

  const lastInteractions: ActiveContextSection[] = [
    ...scopedConversations.slice(0, 4).map((conversation) => ({
      title: String(conversation.subject ?? `Conversation (${String(conversation.channel ?? "channel")})`),
      body: `Last message: ${String(conversation.last_message_at ?? "unknown")}`,
    })),
    ...linkedConversations.slice(0, 3).map((link) => ({
      title: `Linked thread (${String(link.source_provider ?? "source")})`,
      body: `Role: ${String(link.role ?? "participant")} • Last seen: ${String(link.last_seen_at ?? "unknown")}`,
    })),
  ].slice(0, limit);

  const sourceRefsFromRelationship = toSourceRefs(latestRelationship?.source_refs);
  const sourceRefsFromMessages = messageRows.slice(0, 8).map((message) => ({
    source: String(message.source_provider ?? "unknown"),
    ref_id: String(message.id),
    occurred_at: (message.sent_at as string | null) ?? null,
    label: `message:${String(message.conversation_id ?? "")}`,
  }));

  const sourceRefs = [...sourceRefsFromRelationship, ...sourceRefsFromMessages]
    .filter((ref, index, array) => array.findIndex((item) => item.ref_id === ref.ref_id) === index)
    .slice(0, 12);

  const topics = [
    ...toTextList(latestRelationship?.topics),
    ...noteRows
      .map((note) => (typeof note.topic === "string" ? note.topic : ""))
      .filter(Boolean),
  ]
    .filter((topic, index, array) => array.findIndex((entry) => entry.toLowerCase() === topic.toLowerCase()) === index)
    .slice(0, 8);

  const pendingActions = toTextList(latestRelationship?.pending_actions);

  const relationshipSummary =
    normalizeSummary(latestRelationship?.summary as string | null | undefined) ??
    (usefulMemories[0]
      ? `Recent context available from ${usefulMemories.length} evidence records across synced providers.`
      : null);

  const recommendedNextAction =
    pendingActions[0] ??
    (relationshipSummary
      ? "Use recent interaction evidence to draft a targeted follow-up with clear next step."
      : "No strong relationship memory yet. Sync providers or add a note for this person.");

  const debug = {
    relationship_memory_count: relationshipRows.length,
    linked_thread_count: linkedConversations.length,
    conversation_count: scopedConversations.length,
    message_count: messageRows.length,
    note_count: noteRows.length,
    activity_count: activityRows.length,
  };

  return {
    context_mode: "person_context",
    confidence: resolver.confidence,
    person: {
      person_id: person.id,
      display_name: person.full_name,
      email: person.email,
      role: person.title,
      company: (org.data?.name as string | undefined) ?? null,
    },
    resolver,
    relationship_summary: relationshipSummary,
    last_interactions: lastInteractions,
    topics,
    pending_actions: pendingActions,
    source_refs: sourceRefs,
    timeline,
    useful_memories: usefulMemories,
    recommended_next_action: recommendedNextAction,
    debug,
    degraded: false,
    degraded_reason: null,
  };
}

function toParticipantMatch(row: Record<string, unknown>): PersonResolverMatch {
  return {
    person_id: String(row.id),
    display_name: String(row.full_name ?? "Unknown"),
    email: (row.email as string | null) ?? null,
    confidence: 0.7,
    sources: [String(row.source_provider ?? "unknown")],
  };
}

export async function getThreadContext(input: {
  workspaceId: string;
  conversationId?: string | null;
  sourceThreadId?: string | null;
  personId?: string | null;
}): Promise<ThreadContextResponse> {
  const supabase = await getSupabaseServerClient();

  let conversationId = input.conversationId ?? null;

  if (!conversationId && input.sourceThreadId) {
    const primaryLookup = await supabase
      .from("conversations")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("source_object_id", input.sourceThreadId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (primaryLookup.error) throw primaryLookup.error;
    conversationId = (primaryLookup.data?.id as string | undefined) ?? null;

    if (!conversationId) {
      const secondaryLookup = await supabase
        .from("conversations")
        .select("id")
        .eq("workspace_id", input.workspaceId)
        .filter("normalized_payload->>thread_id", "eq", input.sourceThreadId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (secondaryLookup.error) throw secondaryLookup.error;
      conversationId = (secondaryLookup.data?.id as string | undefined) ?? null;
    }
  }

  if (!conversationId) {
    return {
      context_mode: "thread_context",
      confidence: 0,
      thread: null,
      participants: [],
      timeline: [],
      source_refs: [],
      degraded: false,
      degraded_reason: "thread_not_found",
    };
  }

  const [conversationResult, messageResult, linkResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("id,channel,subject,last_message_at")
      .eq("workspace_id", input.workspaceId)
      .eq("id", conversationId)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id,body,sent_at,direction,source_provider,person_id")
      .eq("workspace_id", input.workspaceId)
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(24),
    supabase
      .from("person_thread_links")
      .select("person_id,last_seen_at,source_provider")
      .eq("workspace_id", input.workspaceId)
      .eq("conversation_id", conversationId)
      .limit(24),
  ]);

  if (conversationResult.error) throw conversationResult.error;
  if (messageResult.error) throw messageResult.error;
  if (linkResult.error && linkResult.error.code !== "42P01") throw linkResult.error;

  const conversation = conversationResult.data as {
    id: string;
    channel: string;
    subject: string | null;
    last_message_at: string | null;
  } | null;

  if (!conversation) {
    return {
      context_mode: "thread_context",
      confidence: 0,
      thread: null,
      participants: [],
      timeline: [],
      source_refs: [],
      degraded: false,
      degraded_reason: "thread_not_found",
    };
  }

  const personIds = new Set<string>();
  for (const row of (messageResult.data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.person_id === "string") personIds.add(row.person_id);
  }
  for (const link of (linkResult.data ?? []) as Array<Record<string, unknown>>) {
    if (typeof link.person_id === "string") personIds.add(link.person_id);
  }
  if (input.personId) personIds.add(input.personId);

  const peopleResult = personIds.size
    ? await supabase
        .from("people")
        .select("id,full_name,email,source_provider")
        .eq("workspace_id", input.workspaceId)
        .in("id", [...personIds])
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (peopleResult.error) throw peopleResult.error;

  const participants = ((peopleResult.data ?? []) as Array<Record<string, unknown>>).map(
    toParticipantMatch,
  );

  const timeline = ((messageResult.data ?? []) as Array<Record<string, unknown>>)
    .slice(0, 10)
    .map((message) => ({
      title: `Message (${String(message.direction ?? "unknown")})`,
      body: `${String(message.sent_at ?? "")}${message.body ? ` • ${String(message.body).slice(0, 220)}` : ""}`,
    }));

  const sourceRefs = ((messageResult.data ?? []) as Array<Record<string, unknown>>)
    .slice(0, 10)
    .map((message) => ({
      source: String(message.source_provider ?? "unknown"),
      ref_id: String(message.id),
      occurred_at: (message.sent_at as string | null) ?? null,
      label: conversation.subject,
    }));

  return {
    context_mode: "thread_context",
    confidence: participants.length > 0 ? 0.75 : 0.55,
    thread: {
      conversation_id: conversation.id,
      channel: conversation.channel,
      subject: conversation.subject,
      last_message_at: conversation.last_message_at,
    },
    participants,
    timeline,
    source_refs: sourceRefs,
  };
}

export async function getComposeContext(input: {
  workspaceId: string;
  personId: string;
  accountId?: string | null;
  draftIntent?: string | null;
}): Promise<ComposeContextResponse> {
  const active = await getActivePersonContext({
    workspaceId: input.workspaceId,
    personId: input.personId,
    accountId: input.accountId ?? null,
    limit: 10,
  });

  const toneHints = [
    input.draftIntent ? `Intent: ${input.draftIntent}` : null,
    active.person?.role ? `Role-aware tone for ${active.person.role}` : null,
    active.relationship_summary ? "Stay grounded to relationship summary evidence." : null,
  ].filter((value): value is string => Boolean(value));

  return {
    context_mode: "person_context",
    confidence: active.confidence,
    person: active.person,
    relationship_summary: active.relationship_summary,
    tone_hints: toneHints,
    pending_actions: active.pending_actions,
    recent_quotes: active.useful_memories.map((memory) => memory.body).slice(0, 4),
    source_refs: active.source_refs,
    degraded: active.degraded,
    degraded_reason: active.degraded_reason,
  };
}

export async function getMeetingContext(input: {
  workspaceId: string;
  meetingId: string;
  personId?: string | null;
}): Promise<MeetingContextResponse> {
  const supabase = await getSupabaseServerClient();

  const meetingResult = await supabase
    .from("meetings")
    .select("id,topic,starts_at,ends_at,attendee_person_ids")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.meetingId)
    .maybeSingle();

  if (meetingResult.error) throw meetingResult.error;
  const meeting = meetingResult.data as {
    id: string;
    topic: string;
    starts_at: string | null;
    ends_at: string | null;
    attendee_person_ids: string[];
  } | null;

  if (!meeting) {
    return {
      context_mode: "thread_context",
      confidence: 0,
      meeting: null,
      attendees: [],
      relationship_summary: null,
      agenda_hints: [],
      source_refs: [],
      degraded: false,
      degraded_reason: "meeting_not_found",
    };
  }

  const attendeeIds = new Set<string>(meeting.attendee_person_ids ?? []);
  if (input.personId) attendeeIds.add(input.personId);

  const attendeesResult = attendeeIds.size
    ? await supabase
        .from("people")
        .select("id,full_name,email,source_provider")
        .eq("workspace_id", input.workspaceId)
        .in("id", [...attendeeIds])
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (attendeesResult.error) throw attendeesResult.error;

  const attendees = ((attendeesResult.data ?? []) as Array<Record<string, unknown>>).map(
    toParticipantMatch,
  );

  let relationshipSummary: string | null = null;
  if (input.personId) {
    const rel = await supabase
      .from("relationship_memories")
      .select("summary")
      .eq("workspace_id", input.workspaceId)
      .eq("person_id", input.personId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rel.error && rel.error.code !== "42P01") throw rel.error;
    relationshipSummary = (rel.data?.summary as string | undefined) ?? null;
  }

  return {
    context_mode: "thread_context",
    confidence: attendees.length > 0 ? 0.78 : 0.6,
    meeting: {
      meeting_id: meeting.id,
      topic: meeting.topic,
      starts_at: meeting.starts_at,
      ends_at: meeting.ends_at,
    },
    attendees,
    relationship_summary: relationshipSummary,
    agenda_hints: [
      relationshipSummary ? "Cover active relationship blockers first." : "No relationship blockers found.",
      "Use latest synced conversations to confirm next actions.",
    ],
    source_refs: attendees.map((attendee) => ({
      source: attendee.sources[0] ?? "workspace",
      ref_id: attendee.person_id,
      label: attendee.display_name,
      occurred_at: null,
    })),
  };
}
