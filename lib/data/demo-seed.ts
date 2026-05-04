import { addMemories, buildActivityMemoryPayload, buildNoteMemoryPayload } from "@/lib/hydradb/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Account, ActivityRecord, Contact, Note } from "@/types";

const demoAccounts = [
  {
    name: "Acme Corp",
    domain: "acme.co",
    industry: "Developer Infrastructure",
    stage: "negotiation",
    priority: "high",
    arr_estimate: 120000,
    owner_name: "Alex Chen",
    notes_summary: "Blocked on compliance and procurement alignment.",
    last_contacted_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    name: "Globex Inc",
    domain: "globex.io",
    industry: "Industrial Automation",
    stage: "discovery",
    priority: "medium",
    arr_estimate: 45000,
    owner_name: "Sarah Lee",
    notes_summary: "Competitive cycle with three active vendors.",
    last_contacted_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    name: "Soylent Corp",
    domain: "soylent.co",
    industry: "Manufacturing Ops",
    stage: "at_risk",
    priority: "critical",
    arr_estimate: 250000,
    owner_name: "Alex Chen",
    notes_summary: "Renewal is strained after a Q2 outage.",
    last_contacted_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
  },
] as const;

export async function seedDemoWorkspace(input: {
  workspaceId: string;
  userId: string;
  hydraTenantId: string;
}) {
  // Demo-only dataset used by walk-in and explicit import actions.
  const supabase = getSupabaseAdminClient();

  const { count } = await supabase
    .from("accounts")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId);

  if ((count ?? 0) > 0) return;

  const { data: insertedAccounts, error: accountError } = await supabase
    .from("accounts")
    .insert(
      demoAccounts.map((account) => ({
        workspace_id: input.workspaceId,
        ...account,
      })),
    )
    .select("*");

  if (accountError) throw accountError;

  const accountsByName = new Map(
    ((insertedAccounts ?? []) as Account[]).map((account) => [account.name, account]),
  );

  const contactsPayload = [
    {
      account: "Acme Corp",
      name: "Sarah Jenkins",
      email: "sarah@acme.co",
      title: "VP Engineering",
      role_type: "technical_buyer",
      communication_style: "Concise and direct",
      preference_summary: "Prefers bulleted follow-ups with implementation timelines.",
      importance_level: "high",
    },
    {
      account: "Acme Corp",
      name: "David Kim",
      email: "david@acme.co",
      title: "CISO",
      role_type: "technical_buyer",
      communication_style: "Risk-first",
      preference_summary: "Needs explicit compliance proof and timeline commitments.",
      importance_level: "critical",
    },
    {
      account: "Acme Corp",
      name: "Elena Rostova",
      email: "elena@acme.co",
      title: "Procurement Lead",
      role_type: "procurement",
      communication_style: "Process-oriented",
      preference_summary: "Wants pricing changes documented with approval dependencies.",
      importance_level: "high",
    },
    {
      account: "Globex Inc",
      name: "Hank Scorpio",
      email: "hank@globex.io",
      title: "CEO",
      role_type: "decision_maker",
      communication_style: "Casual and fast",
      preference_summary: "Avoid corporate jargon and anchor on speed to value.",
      importance_level: "high",
    },
    {
      account: "Globex Inc",
      name: "Priya Nair",
      email: "priya@globex.io",
      title: "Automation Director",
      role_type: "champion",
      communication_style: "Detailed",
      preference_summary: "Needs side-by-side comparison against competing tools.",
      importance_level: "medium",
    },
    {
      account: "Soylent Corp",
      name: "Bob Thorn",
      email: "bob@soylent.co",
      title: "Director of IT",
      role_type: "champion",
      communication_style: "Measured",
      preference_summary: "Needs confidence that SLA remediation is complete.",
      importance_level: "high",
    },
    {
      account: "Soylent Corp",
      name: "Alice Glass",
      email: "alice@soylent.co",
      title: "VP Operations",
      role_type: "economic_buyer",
      communication_style: "Executive summary",
      preference_summary: "Requires incident summaries before renewal review.",
      importance_level: "critical",
    },
  ];

  const { data: insertedContacts, error: contactError } = await supabase
    .from("contacts")
    .insert(
      contactsPayload.map((contact) => ({
        workspace_id: input.workspaceId,
        account_id: accountsByName.get(contact.account)?.id,
        name: contact.name,
        email: contact.email,
        title: contact.title,
        role_type: contact.role_type,
        communication_style: contact.communication_style,
        preference_summary: contact.preference_summary,
        importance_level: contact.importance_level,
      })),
    )
    .select("*");

  if (contactError) throw contactError;

  const contactsByName = new Map(
    ((insertedContacts ?? []) as Contact[]).map((contact) => [contact.name, contact]),
  );

  const notePayload = [
    {
      account: "Acme Corp",
      contact: "Sarah Jenkins",
      title: "Communication preference",
      content:
        "Sarah prefers concise bullet-point emails and wants implementation timelines included in every follow-up.",
      source_type: "meeting_note",
      topic: "communication_preference",
      importance_level: "high",
    },
    {
      account: "Acme Corp",
      contact: "David Kim",
      title: "Security blocker",
      content:
        "David explicitly stated they cannot proceed without SOC2 Type II compliance verified by Q3.",
      source_type: "call_summary",
      topic: "security_blocker",
      importance_level: "critical",
    },
    {
      account: "Acme Corp",
      contact: "Elena Rostova",
      title: "Pricing commitment",
      content:
        "Promised to provide a revised tiered pricing model excluding the premium support package.",
      source_type: "manual_note",
      topic: "pricing_commitment",
      importance_level: "high",
    },
    {
      account: "Globex Inc",
      contact: "Hank Scorpio",
      title: "Tone preference",
      content: "Hank prefers casual communication. Avoid corporate jargon.",
      source_type: "email_summary",
      topic: "communication_preference",
      importance_level: "medium",
    },
    {
      account: "Globex Inc",
      contact: "Priya Nair",
      title: "Competitive pressure",
      content:
        "Globex is actively evaluating three other vendors for the automation pipeline.",
      source_type: "meeting_note",
      topic: "competitive_risk",
      importance_level: "high",
    },
    {
      account: "Soylent Corp",
      contact: "Bob Thorn",
      title: "Renewal blocker",
      content:
        "Renewal is blocked pending resolution of the Q2 data outage SLA breach.",
      source_type: "call_summary",
      topic: "renewal_blocker",
      importance_level: "critical",
    },
    {
      account: "Soylent Corp",
      contact: "Alice Glass",
      title: "Review requirement",
      content:
        "Alice requires executive summaries for all incident post-mortems before internal review.",
      source_type: "meeting_note",
      topic: "exec_summary_requirement",
      importance_level: "high",
    },
  ];

  const { data: insertedNotes, error: noteError } = await supabase
    .from("notes")
    .insert(
      notePayload.map((note, index) => ({
        workspace_id: input.workspaceId,
        account_id: accountsByName.get(note.account)?.id,
        contact_id: contactsByName.get(note.contact)?.id ?? null,
        author_id: input.userId,
        title: note.title,
        content: note.content,
        source_type: note.source_type,
        topic: note.topic,
        importance_level: note.importance_level,
        created_at: new Date(Date.now() - 1000 * 60 * 60 * (index + 6)).toISOString(),
      })),
    )
    .select("*");

  if (noteError) throw noteError;

  const activityPayload = [
    {
      account: "Acme Corp",
      type: "email_sent",
      title: "Sent revised technical overview",
      description: "Shared an updated implementation and security overview after the review call.",
    },
    {
      account: "Acme Corp",
      type: "status_changed",
      title: "Added procurement requirements",
      description: "Procurement introduced a legal review requirement before pricing approval.",
    },
    {
      account: "Globex Inc",
      type: "meeting_logged",
      title: "Initial discovery call",
      description: "Discovery surfaced competitive pressure and a need for faster onboarding proof.",
    },
    {
      account: "Soylent Corp",
      type: "meeting_logged",
      title: "Renewal escalation review",
      description: "Customer wants confidence in SLA remediation before renewal approval.",
    },
  ];

  const { data: insertedActivities, error: activityError } = await supabase
    .from("activities")
    .insert(
      activityPayload.map((activity, index) => ({
        workspace_id: input.workspaceId,
        account_id: accountsByName.get(activity.account)?.id,
        actor_id: input.userId,
        activity_type: activity.type,
        title: activity.title,
        description: activity.description,
        metadata: { topic: activity.type },
        occurred_at: new Date(Date.now() - 1000 * 60 * 60 * (index + 1)).toISOString(),
      })),
    )
    .select("*");

  if (activityError) throw activityError;

  const typedNotes = (insertedNotes ?? []) as Note[];
  const typedActivities = (insertedActivities ?? []) as ActivityRecord[];

  for (const note of typedNotes) {
    const account = accountsByName.get(
      [...accountsByName.values()].find((item) => item.id === note.account_id)?.name || "",
    );
    const contact = note.contact_id
      ? [...contactsByName.values()].find((item) => item.id === note.contact_id) ?? null
      : null;

    if (!account) continue;

    try {
      const response = await addMemories({
        tenantId: input.hydraTenantId,
        memories: [buildNoteMemoryPayload({ note, account, contact, userId: input.userId })],
      });
      const memoryId = response.memory_ids?.[0] ?? response.ids?.[0] ?? null;
      if (memoryId) {
        await supabase.from("notes").update({ hydradb_memory_id: memoryId }).eq("id", note.id);
      }
    } catch (error) {
      console.error("Demo note ingestion failed", error);
    }
  }

  for (const activity of typedActivities) {
    const account = [...accountsByName.values()].find((item) => item.id === activity.account_id);

    if (!account) continue;

    try {
      const response = await addMemories({
        tenantId: input.hydraTenantId,
        memories: [
          buildActivityMemoryPayload({
            activity,
            account,
            contact: null,
            userId: input.userId,
          }),
        ],
      });
      const memoryId = response.memory_ids?.[0] ?? response.ids?.[0] ?? null;
      if (memoryId) {
        await supabase
          .from("activities")
          .update({ hydradb_memory_id: memoryId })
          .eq("id", activity.id);
      }
    } catch (error) {
      console.error("Demo activity ingestion failed", error);
    }
  }

  await supabase.from("generated_outputs").insert([
    {
      workspace_id: input.workspaceId,
      account_id: accountsByName.get("Acme Corp")?.id,
      contact_id: contactsByName.get("Sarah Jenkins")?.id,
      action_type: "prepare_meeting",
      prompt: "Focus on blockers and messaging tone.",
      output_text:
        "Objective\nUnblock the Acme deal by aligning on the compliance path, pricing revision, and immediate procurement next steps.\n\nKey talking points\n- Confirm the SOC2 Type II delivery date.\n- Bring the revised pricing model without premium support.\n- Keep the recap concise for Sarah.\n\nSuggested next step\nOffer a preliminary attestation letter today while the final report is still in flight.",
      recalled_memories_json: [
        {
          content:
            "David explicitly stated they cannot proceed without SOC2 Type II compliance verified by Q3.",
          metadata: {
            workspace_id: input.workspaceId,
            account_id: accountsByName.get("Acme Corp")?.id,
            contact_id: contactsByName.get("David Kim")?.id,
            source_type: "call_summary",
            topic: "security_blocker",
            importance_level: "critical",
            stage: "negotiation",
            created_at: new Date().toISOString(),
            entity_type: "note",
            account_name: "Acme Corp",
            contact_name: "David Kim",
            contact_role_type: "technical_buyer",
          },
        },
      ],
      model_name: "seeded-demo",
      created_by: input.userId,
    },
    {
      workspace_id: input.workspaceId,
      account_id: accountsByName.get("Soylent Corp")?.id,
      contact_id: contactsByName.get("Alice Glass")?.id,
      action_type: "summarize_blockers",
      prompt: null,
      output_text:
        "Current blockers\n- Renewal confidence is low after the Q2 outage.\n- Executive review depends on a clear incident summary.\n\nSeverity\nCritical because the account is already flagged at risk.\n\nSuggested resolution focus\nLead with remediation proof, SLA improvements, and a short executive summary for Alice.",
      recalled_memories_json: [],
      model_name: "seeded-demo",
      created_by: input.userId,
    },
  ]);
}
