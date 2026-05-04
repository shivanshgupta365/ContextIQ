import { cache } from "react";

import { requireSessionUser } from "@/lib/auth/session";
import { getGmailIntegrationStatus } from "@/lib/gmail/integration-store";
import { getWorkspaceProviderReadiness } from "@/lib/integrations/service";
import { getLinkedInIntegrationStatus } from "@/lib/linkedin/integration-store";
import { getOutlookIntegrationStatus } from "@/lib/outlook/integration-store";
import { getSlackIntegrationStatus } from "@/lib/slack/integration-store";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime, formatRelativeDate } from "@/lib/utils";
import type {
  Account,
  AccountPageData,
  ActivityRecord,
  Contact,
  GmailIntegrationStatus,
  GeneratedOutput,
  LinkedInIntegrationStatus,
  Note,
  OutlookIntegrationStatus,
  OverviewCardSignal,
  ProviderReadinessStatus,
  Profile,
  RecalledMemory,
  TimelineEvent,
  TimelineItem,
  Workspace,
  WorkspaceOverviewData,
  SlackIntegrationStatus,
} from "@/types";

function mapTimelineItems(
  account: Account,
  activities: ActivityRecord[],
  notes: Note[],
): TimelineItem[] {
  const activityItems: TimelineItem[] = activities.map((activity) => ({
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
    accountId: account.id,
    accountName: account.name,
  }));

  const noteItems: TimelineItem[] = notes.map((note) => ({
    id: note.id,
    type: "note",
    title: note.title || "Added account note",
    description: note.content,
    dateLabel: formatDateTime(note.created_at),
    userLabel: "Context note",
    tag: note.topic,
    highlight: note.importance_level === "high" || note.importance_level === "critical",
    accountId: account.id,
    accountName: account.name,
  }));

  return [...activityItems, ...noteItems].sort((a, b) =>
    b.dateLabel.localeCompare(a.dateLabel),
  );
}

function buildFallbackMemories(input: {
  account: Account;
  contacts: Contact[];
  notes: Note[];
  activities: ActivityRecord[];
}) {
  const noteMemories: RecalledMemory[] = input.notes.slice(0, 4).map((note) => ({
    id: note.id,
    content: note.content,
    metadata: {
      workspace_id: note.workspace_id,
      account_id: note.account_id,
      contact_id: note.contact_id,
      source_type: note.source_type,
      topic: note.topic,
      importance_level: note.importance_level,
      stage: input.account.stage,
      created_at: note.created_at,
      entity_type: "note",
      account_name: input.account.name,
      contact_name:
        input.contacts.find((contact) => contact.id === note.contact_id)?.name ?? null,
      contact_role_type:
        input.contacts.find((contact) => contact.id === note.contact_id)?.role_type ?? null,
      integration_source:
        note.source_type === "email_summary" || (note.topic ?? "").toLowerCase().includes("gmail")
          ? "gmail"
          : (note.topic ?? "").toLowerCase().includes("outlook")
            ? "outlook"
          : (note.topic ?? "").toLowerCase().includes("linkedin")
            ? "linkedin"
            : (note.topic ?? "").toLowerCase().includes("slack")
              ? "slack"
            : null,
    },
  }));

  const activityMemories: RecalledMemory[] = input.activities
    .slice(0, 2)
    .map((activity) => ({
      id: activity.id,
      content: activity.description || activity.title,
      metadata: {
        workspace_id: activity.workspace_id,
        account_id: activity.account_id,
        contact_id: activity.contact_id,
        source_type: "activity_summary",
        topic:
          typeof activity.metadata.topic === "string"
            ? activity.metadata.topic
            : activity.activity_type,
        importance_level:
          typeof activity.metadata.importance_level === "string"
            ? activity.metadata.importance_level
            : "medium",
        stage: input.account.stage,
        created_at: activity.occurred_at,
        entity_type: "activity",
        account_name: input.account.name,
        contact_name:
          input.contacts.find((contact) => contact.id === activity.contact_id)?.name ?? null,
        contact_role_type:
          input.contacts.find((contact) => contact.id === activity.contact_id)?.role_type ??
          null,
        integration_source:
          (typeof activity.metadata.topic === "string" ? activity.metadata.topic : "")
            .toLowerCase()
            .includes("gmail")
            ? "gmail"
            : (typeof activity.metadata.topic === "string" ? activity.metadata.topic : "")
                  .toLowerCase()
                  .includes("outlook")
              ? "outlook"
            : (typeof activity.metadata.topic === "string" ? activity.metadata.topic : "")
                  .toLowerCase()
                  .includes("linkedin")
              ? "linkedin"
              : (typeof activity.metadata.topic === "string" ? activity.metadata.topic : "")
                    .toLowerCase()
                    .includes("slack")
                ? "slack"
              : null,
      },
    }));

  return [...noteMemories, ...activityMemories].slice(0, 6);
}

function dedupeMemories(memories: RecalledMemory[], limit: number) {
  const seen = new Set<string>();
  const deduped: RecalledMemory[] = [];

  for (const memory of memories) {
    const key =
      memory.id ??
      `${memory.metadata.account_id}-${memory.metadata.source_type}-${memory.metadata.created_at}-${memory.content}`;

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(memory);

    if (deduped.length >= limit) break;
  }

  return deduped;
}

export const getWorkspaceContext = cache(async (): Promise<{
  userId: string;
  workspace: Workspace;
  profile: Profile;
}> => {
  const user = await requireSessionUser();
  const supabase = await getSupabaseServerClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError && profileError.code !== "42501") throw profileError;

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace:workspaces(*)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (membershipError) throw membershipError;

  return {
    userId: user.id,
    workspace: membership.workspace as Workspace,
    profile:
      (profile as Profile | null) ??
      ({
        id: user.id,
        email: user.email ?? null,
        full_name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : typeof user.user_metadata?.name === "string"
              ? user.user_metadata.name
              : null,
        avatar_url:
          typeof user.user_metadata?.avatar_url === "string"
            ? user.user_metadata.avatar_url
            : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Profile),
  };
});

export async function getWorkspaceOverviewData(): Promise<WorkspaceOverviewData> {
  const { workspace, profile } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const [
    { data: accounts, error: accountsError },
    { data: contacts, error: contactsError },
    { data: activities, error: activitiesError },
    { data: notes, error: notesError },
    { data: outputs, error: outputsError },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("contacts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("activities")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("occurred_at", { ascending: false })
      .limit(12),
    supabase
      .from("notes")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("generated_outputs")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  if (accountsError) throw accountsError;
  if (contactsError) throw contactsError;
  if (activitiesError) throw activitiesError;
  if (notesError) throw notesError;
  if (outputsError) throw outputsError;

  return {
    workspace,
    profile,
    accounts: (accounts ?? []) as Account[],
    contacts: (contacts ?? []) as Contact[],
    recent_activities: (activities ?? []) as ActivityRecord[],
    recent_notes: (notes ?? []) as Note[],
    recent_outputs: ((outputs ?? []) as GeneratedOutput[]).map((output) => ({
      ...output,
      recalled_memories_json: (output.recalled_memories_json ?? []) as RecalledMemory[],
    })),
  };
}

export async function getWorkspaceAccounts() {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as Account[];
}

export async function getWorkspaceContacts() {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as Contact[];
}

export async function getWorkspaceActivity() {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const { data, error } = await supabase
    .from("activities")
    .select("*, account:accounts(name)")
    .eq("workspace_id", workspace.id)
    .order("occurred_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  return (data ?? []) as Array<ActivityRecord & { account?: { name: string } }>;
}

export async function getWorkspaceRailMemories(limit = 6): Promise<RecalledMemory[]> {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const { data: outputs, error: outputsError } = await supabase
    .from("generated_outputs")
    .select("recalled_memories_json")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(16);

  if (outputsError) throw outputsError;

  const outputMemories = dedupeMemories(
    ((outputs ?? []) as Array<{ recalled_memories_json: RecalledMemory[] | null }>)
      .flatMap((output) => output.recalled_memories_json ?? [])
      .filter((memory) => Boolean(memory?.content)),
    limit,
  );

  if (outputMemories.length > 0) {
    return outputMemories;
  }

  const [
    { data: notes, error: notesError },
    { data: activities, error: activitiesError },
    { data: accounts, error: accountsError },
    { data: contacts, error: contactsError },
  ] = await Promise.all([
    supabase
      .from("notes")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(24),
    supabase
      .from("activities")
      .select("*")
      .eq("workspace_id", workspace.id)
      .not("description", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(16),
    supabase.from("accounts").select("id,name,stage").eq("workspace_id", workspace.id),
    supabase.from("contacts").select("id,name,role_type").eq("workspace_id", workspace.id),
  ]);

  if (notesError) throw notesError;
  if (activitiesError) throw activitiesError;
  if (accountsError) throw accountsError;
  if (contactsError) throw contactsError;

  const accountMap = new Map(
    ((accounts ?? []) as Array<Pick<Account, "id" | "name" | "stage">>).map((account) => [
      account.id,
      account,
    ]),
  );
  const contactMap = new Map(
    ((contacts ?? []) as Array<Pick<Contact, "id" | "name" | "role_type">>).map((contact) => [
      contact.id,
      contact,
    ]),
  );

  const importanceRank: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const noteMemories = ((notes ?? []) as Note[])
    .sort((a, b) => {
      const rank = (importanceRank[b.importance_level] ?? 0) - (importanceRank[a.importance_level] ?? 0);
      if (rank !== 0) return rank;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
    .slice(0, 6)
    .map((note) => {
      const account = accountMap.get(note.account_id);
      const contact = note.contact_id ? contactMap.get(note.contact_id) : null;

      return {
        id: note.id,
        content: note.content,
        metadata: {
          workspace_id: note.workspace_id,
          account_id: note.account_id,
          contact_id: note.contact_id,
          source_type: note.source_type,
          topic: note.topic,
          importance_level: note.importance_level,
          stage: account?.stage ?? null,
          created_at: note.created_at,
          entity_type: "note",
          account_name: account?.name ?? null,
          contact_name: contact?.name ?? null,
          contact_role_type: contact?.role_type ?? null,
          integration_source:
            note.source_type === "email_summary" ||
            (note.topic ?? "").toLowerCase().includes("gmail")
              ? "gmail"
              : (note.topic ?? "").toLowerCase().includes("outlook")
                ? "outlook"
              : (note.topic ?? "").toLowerCase().includes("linkedin")
                ? "linkedin"
                : (note.topic ?? "").toLowerCase().includes("slack")
                  ? "slack"
                : null,
        },
      } satisfies RecalledMemory;
    });

  const activityMemories = ((activities ?? []) as ActivityRecord[])
    .slice(0, 4)
    .map((activity) => {
      const account = accountMap.get(activity.account_id);
      const contact = activity.contact_id ? contactMap.get(activity.contact_id) : null;

      return {
        id: activity.id,
        content: activity.description || activity.title,
        metadata: {
          workspace_id: activity.workspace_id,
          account_id: activity.account_id,
          contact_id: activity.contact_id,
          source_type: "activity_summary",
          topic:
            typeof activity.metadata.topic === "string"
              ? activity.metadata.topic
              : activity.activity_type,
          importance_level:
            typeof activity.metadata.importance_level === "string"
              ? activity.metadata.importance_level
              : "medium",
          stage: account?.stage ?? null,
          created_at: activity.occurred_at,
          entity_type: "activity",
          account_name: account?.name ?? null,
          contact_name: contact?.name ?? null,
          contact_role_type: contact?.role_type ?? null,
          integration_source:
            (typeof activity.metadata.topic === "string" ? activity.metadata.topic : "")
              .toLowerCase()
              .includes("gmail")
              ? "gmail"
              : (typeof activity.metadata.topic === "string" ? activity.metadata.topic : "")
                    .toLowerCase()
                    .includes("outlook")
                ? "outlook"
              : (typeof activity.metadata.topic === "string" ? activity.metadata.topic : "")
                    .toLowerCase()
                    .includes("linkedin")
                ? "linkedin"
                : (typeof activity.metadata.topic === "string" ? activity.metadata.topic : "")
                      .toLowerCase()
                      .includes("slack")
                  ? "slack"
                : null,
        },
      } satisfies RecalledMemory;
    });

  return dedupeMemories(
    [...noteMemories, ...activityMemories].sort(
      (a, b) =>
        new Date(b.metadata.created_at).getTime() - new Date(a.metadata.created_at).getTime(),
    ),
    limit,
  );
}

export async function getWorkspaceGmailStatus(): Promise<GmailIntegrationStatus> {
  const { workspace, userId } = await getWorkspaceContext();

  return getGmailIntegrationStatus({
    workspaceId: workspace.id,
    userId,
  });
}

export async function getWorkspaceLinkedInStatus(): Promise<LinkedInIntegrationStatus> {
  const { workspace, userId } = await getWorkspaceContext();

  return getLinkedInIntegrationStatus({
    workspaceId: workspace.id,
    userId,
  });
}

export async function getWorkspaceOutlookStatus(): Promise<OutlookIntegrationStatus> {
  const { workspace, userId } = await getWorkspaceContext();

  return getOutlookIntegrationStatus({
    workspaceId: workspace.id,
    userId,
  });
}

export async function getWorkspaceSlackStatus(): Promise<SlackIntegrationStatus> {
  const { workspace, userId } = await getWorkspaceContext();

  return getSlackIntegrationStatus({
    workspaceId: workspace.id,
    userId,
  });
}

export async function getAccountPageData(accountId: string): Promise<AccountPageData> {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const [
    { data: account, error: accountError },
    { data: contacts, error: contactsError },
    { data: activities, error: activitiesError },
    { data: notes, error: notesError },
    { data: outputs, error: outputsError },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("id", accountId)
      .single(),
    supabase
      .from("contacts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("activities")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("account_id", accountId)
      .order("occurred_at", { ascending: false })
      .limit(30),
    supabase
      .from("notes")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("generated_outputs")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (accountError) throw accountError;
  if (contactsError) throw contactsError;
  if (activitiesError) throw activitiesError;
  if (notesError) throw notesError;
  if (outputsError) throw outputsError;

  const typedAccount = account as Account;
  const typedContacts = (contacts ?? []) as Contact[];
  const typedActivities = (activities ?? []) as ActivityRecord[];
  const typedNotes = (notes ?? []) as Note[];
  const typedOutputs = ((outputs ?? []) as GeneratedOutput[]).map((output) => ({
    ...output,
    recalled_memories_json: (output.recalled_memories_json ?? []) as RecalledMemory[],
  }));

  const latestOutput = typedOutputs[0] ?? null;
  const fallbackMemories = buildFallbackMemories({
    account: typedAccount,
    contacts: typedContacts,
    notes: typedNotes,
    activities: typedActivities,
  });
  const memoryPool = dedupeMemories(
    [...(latestOutput?.recalled_memories_json ?? []), ...fallbackMemories],
    12,
  );

  return {
    account: typedAccount,
    contacts: typedContacts,
    activities: typedActivities,
    notes: typedNotes,
    timeline: mapTimelineItems(typedAccount, typedActivities, typedNotes),
    latest_output: latestOutput,
    recent_outputs: typedOutputs,
    memory_rail: memoryPool,
  };
}

export function deriveAccountsNeedingAttention(data: WorkspaceOverviewData) {
  return data.accounts
    .filter((account) => {
      const isHighPriority =
        account.priority === "high" || account.priority === "critical";
      const isRiskStage =
        account.stage === "negotiation" || account.stage === "at_risk";
      const staleContact = (() => {
        if (!account.last_contacted_at) return true;

        const diffDays =
          (Date.now() - new Date(account.last_contacted_at).getTime()) /
          (1000 * 60 * 60 * 24);

        return diffDays >= 5;
      })();

      return isHighPriority || isRiskStage || staleContact;
    })
    .slice(0, 3);
}

export function deriveSuggestedNextActions(
  data: WorkspaceOverviewData,
): OverviewCardSignal[] {
  const staleOutputs = data.accounts
    .filter((account) => account.stage === "negotiation" || account.stage === "at_risk")
    .slice(0, 2)
    .map((account) => ({
      title: `Prepare next step for ${account.name}`,
      subtitle: `${account.stage.replaceAll("_", " ")} • ${formatRelativeDate(account.last_contacted_at)}`,
      account_id: account.id,
    }));

  const outputFollowups = data.recent_outputs.slice(0, 2).map((output) => {
    const account = data.accounts.find((item) => item.id === output.account_id);

    return {
      title: `Follow up on ${output.action_type.replaceAll("_", " ")}`,
      subtitle: `${account?.name ?? "Unknown account"} • ${formatDateTime(output.created_at)}`,
      account_id: output.account_id,
    };
  });

  return [...staleOutputs, ...outputFollowups].slice(0, 4);
}

export function deriveRecentMemorySignals(
  data: WorkspaceOverviewData,
): OverviewCardSignal[] {
  const noteSignals = data.recent_notes.slice(0, 2).map((note) => {
    const account = data.accounts.find((item) => item.id === note.account_id);

    return {
      title: note.title || note.topic || "Recent memory captured",
      subtitle: `${account?.name ?? "Unknown account"} • ${note.importance_level}`,
      account_id: note.account_id,
    };
  });

  const activitySignals = data.recent_activities.slice(0, 2).map((activity) => {
    const account = data.accounts.find((item) => item.id === activity.account_id);

    return {
      title: activity.title,
      subtitle: `${account?.name ?? "Unknown account"} • ${activity.activity_type.replaceAll("_", " ")}`,
      account_id: activity.account_id,
    };
  });

  return [...noteSignals, ...activitySignals].slice(0, 4);
}

export async function getProviderReadinessData(): Promise<ProviderReadinessStatus[]> {
  const { workspace, userId } = await getWorkspaceContext();
  return getWorkspaceProviderReadiness({ workspaceId: workspace.id, userId });
}

export async function getPeopleSurfaceData() {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const [contactsResult, peopleResult, aliasesResult] = await Promise.all([
    supabase
      .from("contacts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("people")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("identity_aliases")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  return {
    contacts: (contactsResult.data ?? []) as Contact[],
    people: (peopleResult.data ?? []) as Array<Record<string, unknown>>,
    aliases: (aliasesResult.data ?? []) as Array<Record<string, unknown>>,
  };
}

export async function getConversationsSurfaceData() {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const [conversationsResult, messagesResult, activitiesResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("last_message_at", { ascending: false })
      .limit(50),
    supabase
      .from("messages")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("sent_at", { ascending: false })
      .limit(100),
    supabase
      .from("activities")
      .select("*")
      .eq("workspace_id", workspace.id)
      .or("activity_type.eq.email_sent,activity_type.eq.email_received")
      .order("occurred_at", { ascending: false })
      .limit(30),
  ]);

  return {
    conversations: (conversationsResult.data ?? []) as Array<Record<string, unknown>>,
    messages: (messagesResult.data ?? []) as Array<Record<string, unknown>>,
    legacyEmailActivities: (activitiesResult.data ?? []) as ActivityRecord[],
  };
}

export async function getMeetingsSurfaceData() {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const [meetingsResult, activitiesResult] = await Promise.all([
    supabase
      .from("meetings")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("starts_at", { ascending: true })
      .limit(50),
    supabase
      .from("activities")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("activity_type", "meeting_logged")
      .order("occurred_at", { ascending: false })
      .limit(30),
  ]);

  return {
    meetings: (meetingsResult.data ?? []) as Array<Record<string, unknown>>,
    legacyMeetingActivities: (activitiesResult.data ?? []) as ActivityRecord[],
  };
}

export async function getNotesBriefsSurfaceData() {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const [notesResult, docsResult] = await Promise.all([
    supabase
      .from("notes")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("documents")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(60),
  ]);

  return {
    notes: (notesResult.data ?? []) as Note[],
    documents: (docsResult.data ?? []) as Array<Record<string, unknown>>,
  };
}

export async function getActionsAuditSurfaceData() {
  const { workspace } = await getWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const [timelineResult, executionsResult, syncRunsResult] = await Promise.all([
    supabase
      .from("timeline_events")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("occurred_at", { ascending: false })
      .limit(80),
    supabase
      .from("action_executions")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("integration_sync_runs")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return {
    timelineEvents: (timelineResult.data ?? []) as TimelineEvent[],
    actionExecutions: (executionsResult.data ?? []) as Array<Record<string, unknown>>,
    syncRuns: (syncRunsResult.data ?? []) as Array<Record<string, unknown>>,
  };
}
