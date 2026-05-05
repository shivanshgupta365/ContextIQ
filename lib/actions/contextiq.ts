"use server";

import { revalidatePath } from "next/cache";

import { filterMemoriesForContact } from "@/lib/context-memory";
import { getAccountPageData, getWorkspaceContext } from "@/lib/data/contextiq";
import { seedDemoWorkspace } from "@/lib/data/demo-seed";
import { syncWorkspaceGmailMessages } from "@/lib/gmail/sync";
import { syncWorkspaceLinkedInSignals } from "@/lib/linkedin/sync";
import { syncWorkspaceOutlookMessages } from "@/lib/outlook/sync";
import { syncWorkspaceSlackSignals } from "@/lib/slack/sync";
import { getValidGmailAccessToken } from "@/lib/gmail/integration-store";
import { createGmailDraft, sendGmailMessage } from "@/lib/gmail/client";
import {
  assertIntegrationRateLimit,
  recordIntegrationActionEvent,
} from "@/lib/integrations/rate-limit";
import {
  inferIntegrationSourceForActivity,
  inferIntegrationSourceForNote,
} from "@/lib/integrations/provider-source";
import { logIntegrationEvent } from "@/lib/integrations/telemetry";
import { upsertIntegrationConnectionStatus } from "@/lib/integrations/connections";
import { generateGeminiText } from "@/lib/gemini/client";
import {
  addMemories,
  buildActivityMemoryPayload,
  buildNoteMemoryPayload,
  fullRecall,
} from "@/lib/hydradb/client";
import { buildActionPrompt } from "@/lib/prompts/contextiq";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  createAccountSchema,
  createActivitySchema,
  createContactSchema,
  createNoteSchema,
  notesBriefTransformSchema,
  pinWorkspaceContextSchema,
  prepareGmailFollowUpSchema,
  runActionSchema,
  sendGmailFollowUpSchema,
  saveWorkspaceDocumentSchema,
  workspaceEntitySearchSchema,
} from "@/lib/validators/contextiq";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ensureContactForEmail,
  ensureIdentityAlias,
  ensureOrganizationForAccount,
  ensurePersonProjection,
  upsertDocumentProjection,
  upsertSearchIndexEntry,
} from "@/lib/workspace/projections";
import type {
  Account,
  ActivityRecord,
  ComposerResult,
  Contact,
  GmailFollowUpDraftResult,
  GmailSendResult,
  GeneratedOutput,
  Note,
  RecalledMemory,
  IntegrationProvider,
  NotesBriefTransformResult,
  WorkspaceEntitySearchResponse,
} from "@/types";

function revalidateWorkspaceSurfaces(accountId?: string | null) {
  revalidatePath("/overview");
  revalidatePath("/command-center");
  revalidatePath("/contacts");
  revalidatePath("/people");
  revalidatePath("/conversations");
  revalidatePath("/meetings");
  revalidatePath("/actions");
  revalidatePath("/notes-briefs");
  revalidatePath("/activity-audit");
  revalidatePath("/activity");
  revalidatePath("/accounts", "layout");

  if (accountId) {
    revalidatePath(`/accounts/${accountId}`);
  }
}

async function projectAccountForWorkspace(input: {
  workspaceId: string;
  userId: string;
  account: Account;
  provider?: IntegrationProvider;
}) {
  const provider = input.provider ?? "manual";
  await ensureOrganizationForAccount({
    workspaceId: input.workspaceId,
    userId: input.userId,
    account: input.account,
    provider,
  });
  await upsertSearchIndexEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    entityType: "organization",
    entityId: input.account.id,
    title: input.account.name,
    body: [
      input.account.name,
      input.account.domain,
      input.account.industry,
      input.account.owner_name,
      input.account.notes_summary,
    ]
      .filter(Boolean)
      .join("\n"),
    provider,
    sourceObjectId: input.account.id,
    metadata: {
      account_id: input.account.id,
      account_name: input.account.name,
      account_domain: input.account.domain,
      industry: input.account.industry,
      owner_name: input.account.owner_name,
      stage: input.account.stage,
      priority: input.account.priority,
    },
  });
}

async function projectContactForWorkspace(input: {
  workspaceId: string;
  userId: string;
  account: Account;
  contact: Contact;
  provider?: IntegrationProvider;
}) {
  const provider = input.provider ?? "manual";
  const organization = await ensureOrganizationForAccount({
    workspaceId: input.workspaceId,
    userId: input.userId,
    account: input.account,
    provider,
  });
  const person = await ensurePersonProjection({
    workspaceId: input.workspaceId,
    userId: input.userId,
    provider,
    organizationId: organization.id,
    contact: input.contact,
    sourceObjectId: input.contact.id,
  });
  if (input.contact.email) {
    await ensureIdentityAlias({
      workspaceId: input.workspaceId,
      userId: input.userId,
      personId: person.id,
      provider: "email",
      aliasType: "email",
      aliasValue: input.contact.email,
      sourceProvider: provider,
      sourceObjectId: input.contact.id,
    });
  }
  if (input.contact.linkedin_url) {
    await ensureIdentityAlias({
      workspaceId: input.workspaceId,
      userId: input.userId,
      personId: person.id,
      provider: "linkedin",
      aliasType: "linkedin_url",
      aliasValue: input.contact.linkedin_url,
      sourceProvider: provider,
      sourceObjectId: input.contact.id,
    });
  }
  await upsertSearchIndexEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    entityType: "person",
    entityId: input.contact.id,
    title: input.contact.name,
    body: [
      input.contact.name,
      input.contact.email,
      input.contact.title,
      input.contact.preference_summary,
      input.account.name,
      input.account.domain,
    ]
      .filter(Boolean)
      .join("\n"),
    provider,
    sourceObjectId: input.contact.id,
    metadata: {
      account_id: input.account.id,
      account_name: input.account.name,
      contact_id: input.contact.id,
      email: input.contact.email,
      title: input.contact.title,
      role_type: input.contact.role_type,
      linkedin_url: input.contact.linkedin_url,
    },
  });
}

function buildDocumentTransformPrompt(input: {
  mode: NotesBriefTransformResult["mode"];
  title: string;
  content: string;
}) {
  const instruction =
    input.mode === "summarize"
      ? "Summarize the following workspace content into a concise, grounded summary with the most important facts and next actions."
      : input.mode === "paraphrase"
        ? "Paraphrase the following workspace content into clearer, tighter prose without dropping important facts."
        : input.mode === "brief"
          ? "Turn the following workspace content into a polished internal brief with sections for Objective, Key Points, Risks, and Next Steps."
          : "Turn the following workspace content into a concise email draft that stays faithful to the source evidence. Do not invent facts.";

  return `${instruction}\n\nTitle: ${input.title}\n\nContent:\n${input.content}`;
}

export async function createAccountAction(input: unknown) {
  const values = createAccountSchema.parse(input);
  const { workspace, userId } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      workspace_id: values.workspaceId,
      name: values.name,
      domain: values.domain || null,
      industry: values.industry || null,
      stage: values.stage,
      priority: values.priority,
      arr_estimate: values.arrEstimate ?? null,
      owner_name: values.ownerName || null,
    })
    .select("*")
    .single();

  if (error) throw error;

  const account = data as Account;

  await projectAccountForWorkspace({
    workspaceId: values.workspaceId,
    userId,
    account,
    provider: "manual",
  });

  revalidateWorkspaceSurfaces(account.id);

  return account;
}

export async function createContactAction(input: unknown) {
  const values = createContactSchema.parse(input);
  const { workspace, userId } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: values.workspaceId,
      account_id: values.accountId,
      name: values.name,
      email: values.email || null,
      title: values.title || null,
      role_type: values.roleType ?? null,
      communication_style: values.communicationStyle || null,
      preference_summary: values.preferenceSummary || null,
      importance_level: values.importanceLevel,
    })
    .select("*")
    .single();

  if (error) throw error;

  const contact = data as Contact;
  const { data: account } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", values.accountId)
    .eq("workspace_id", workspace.id)
    .single();

  if (account) {
    await projectContactForWorkspace({
      workspaceId: values.workspaceId,
      userId,
      account: account as Account,
      contact,
      provider: "manual",
    });
  }

  revalidateWorkspaceSurfaces(values.accountId);

  return contact;
}

export async function createNoteAction(input: unknown) {
  const values = createNoteSchema.parse(input);
  const { userId, workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("notes")
    .insert({
      workspace_id: values.workspaceId,
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      author_id: userId,
      title: values.title || null,
      content: values.content,
      source_type: values.sourceType,
      topic: values.topic || null,
      importance_level: values.importanceLevel,
    })
    .select("*")
    .single();

  if (error) throw error;

  const note = data as Note;
  const noteProvider = inferIntegrationSourceForNote(note) ?? "gmail";

  const [{ data: account }, { data: contact }] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("id", values.accountId)
      .single(),
    values.contactId
      ? supabase.from("contacts").select("*").eq("id", values.contactId).single()
      : Promise.resolve({ data: null }),
  ]);

  try {
    const hydraResponse = await addMemories({
      tenantId: workspace.hydradb_tenant_id,
      memories: [
        buildNoteMemoryPayload({
          note,
          account: account as Account,
          contact: (contact as Contact | null) ?? null,
          userId,
        }),
      ],
    });

    const memoryId = hydraResponse.memory_ids?.[0] ?? hydraResponse.ids?.[0] ?? null;

    if (memoryId) {
      await supabase
        .from("notes")
        .update({ hydradb_memory_id: memoryId })
        .eq("id", note.id);
    }
  } catch (error) {
    console.error("HydraDB note ingestion failed", error);
  }

  await upsertSearchIndexEntry({
    workspaceId: values.workspaceId,
    userId,
    entityType: "note",
    entityId: note.id,
    title: note.title || note.topic || "Workspace note",
    body: [note.title, note.content, note.topic].filter(Boolean).join("\n"),
    provider: noteProvider,
    sourceObjectId: note.id,
    metadata: {
      provider: noteProvider,
      account_id: note.account_id,
      contact_id: note.contact_id,
      source_type: note.source_type,
      topic: note.topic,
      importance_level: note.importance_level,
    },
  }).catch((indexError) => {
    console.error("Note search indexing failed", indexError);
  });

  revalidateWorkspaceSurfaces(values.accountId);

  return note;
}

export async function createActivityAction(input: unknown) {
  const values = createActivitySchema.parse(input);
  const { userId, workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("activities")
    .insert({
      workspace_id: values.workspaceId,
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      actor_id: userId,
      activity_type: values.activityType,
      title: values.title,
      description: values.description || null,
      occurred_at: values.occurredAt ?? new Date().toISOString(),
      metadata: {
        topic: values.activityType,
      },
    })
    .select("*")
    .single();

  if (error) throw error;

  const activity = data as ActivityRecord;
  const activityProvider = inferIntegrationSourceForActivity(activity) ?? "gmail";

  const [{ data: account }, { data: contact }] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("id", values.accountId)
      .single(),
    values.contactId
      ? supabase.from("contacts").select("*").eq("id", values.contactId).single()
      : Promise.resolve({ data: null }),
  ]);

  const shouldIngest =
    values.activityType === "meeting_logged" ||
    values.activityType === "email_received" ||
    values.activityType === "status_changed" ||
    values.activityType === "document_uploaded";

  if (shouldIngest) {
    try {
      const hydraResponse = await addMemories({
        tenantId: workspace.hydradb_tenant_id,
        memories: [
          buildActivityMemoryPayload({
            activity,
            account: account as Account,
            contact: (contact as Contact | null) ?? null,
            userId,
          }),
        ],
      });

      const memoryId = hydraResponse.memory_ids?.[0] ?? hydraResponse.ids?.[0] ?? null;

      if (memoryId) {
        await supabase
          .from("activities")
          .update({ hydradb_memory_id: memoryId })
          .eq("id", activity.id);
      }
    } catch (ingestError) {
      console.error("HydraDB activity ingestion failed", ingestError);
    }
  }

  await upsertSearchIndexEntry({
    workspaceId: values.workspaceId,
    userId,
    entityType: "activity",
    entityId: activity.id,
    title: activity.title,
    body: [activity.title, activity.description].filter(Boolean).join("\n"),
    provider: activityProvider,
    sourceObjectId: activity.id,
    metadata: {
      provider: activityProvider,
      account_id: activity.account_id,
      contact_id: activity.contact_id,
      activity_type: activity.activity_type,
      topic:
        typeof activity.metadata?.topic === "string"
          ? activity.metadata.topic
          : activity.activity_type,
      importance_level:
        typeof activity.metadata?.importance_level === "string"
          ? activity.metadata.importance_level
          : "medium",
    },
  }).catch((indexError) => {
    console.error("Activity search indexing failed", indexError);
  });

  revalidateWorkspaceSurfaces(values.accountId);

  return activity;
}

export async function runComposerAction(input: unknown): Promise<ComposerResult> {
  const values = runActionSchema.parse(input);
  const { userId, workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const pageData = await getAccountPageData(values.accountId);
  const selectedContact =
    pageData.contacts.find((contact) => contact.id === values.contactId) ?? null;

  const recallQueryMap = {
    prepare_meeting: `What should I know before my next meeting with ${pageData.account.name}${selectedContact ? ` and ${selectedContact.name}` : ""}?`,
    draft_followup: `Draft a grounded follow-up based on recent commitments for ${pageData.account.name}${selectedContact ? ` and ${selectedContact.name}` : ""}.`,
    summarize_blockers: `What are the active blockers for ${pageData.account.name}?`,
    what_changed_recently: `What changed recently for ${pageData.account.name}?`,
  } as const;

  const warnings: string[] = [];
  let degraded = false;
  let memories: RecalledMemory[] = [];

  try {
    memories = await fullRecall({
      tenantId: workspace.hydradb_tenant_id,
      query: recallQueryMap[values.actionType],
      filters: {
        workspace_id: workspace.id,
        account_id: values.accountId,
      },
      topK: 6,
    });
  } catch (error) {
    degraded = true;
    warnings.push(
      `Retrieval degraded to workspace evidence only: ${error instanceof Error ? error.message : "Hydra recall failed."}`,
    );
  }

  const scopedMemories = filterMemoriesForContact(
    memories.length > 0 ? memories : pageData.memory_rail,
    values.contactId,
    6,
  );

  const hasStructuredEvidence =
    pageData.notes.length > 0 || pageData.activities.length > 0 || pageData.contacts.length > 0;

  if (scopedMemories.length === 0 && !hasStructuredEvidence) {
    throw new Error(
      "No live evidence is available for this account yet. Sync providers or add notes before generating this output.",
    );
  }

  const prompt = buildActionPrompt({
    actionType: values.actionType,
    account: pageData.account,
    contacts: pageData.contacts,
    selectedContact,
    activities: pageData.activities,
    memories: scopedMemories,
    prompt: values.prompt || null,
  });

  let generation: Awaited<ReturnType<typeof generateGeminiText>>;
  try {
    generation = await generateGeminiText(prompt);
  } catch (error) {
    throw new Error(
      `Generation failed: ${error instanceof Error ? error.message : "Gemini request failed."}`,
    );
  }
  const supabase = await getSupabaseServerClient();

  const { data, error } = await supabase
    .from("generated_outputs")
    .insert({
      workspace_id: workspace.id,
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      action_type: values.actionType,
      prompt: values.prompt || null,
      output_text: generation.text,
      recalled_memories_json: scopedMemories,
      model_name: generation.model,
      created_by: userId,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Persistence failed: ${error.message}`);
  }

  const generationProvider =
    scopedMemories.find((memory) => memory.metadata.integration_source)?.metadata
      .integration_source ?? "gmail";

  const projectedDocument = await upsertDocumentProjection({
    workspaceId: workspace.id,
    userId,
    provider: generationProvider,
    title: `${values.actionType.replaceAll("_", " ")} for ${pageData.account.name}`,
    body: generation.text,
    kind: values.actionType,
    sourceObjectId: (data as GeneratedOutput).id,
    normalizedPayload: {
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      action_type: values.actionType,
    },
  }).catch((projectionError) => {
    console.error("Generated output document projection failed", projectionError);
    return null;
  });

  await upsertSearchIndexEntry({
    workspaceId: workspace.id,
    userId,
    entityType: "document",
    entityId: projectedDocument?.id ?? (data as GeneratedOutput).id,
    title: `${values.actionType.replaceAll("_", " ")} for ${pageData.account.name}`,
    body: generation.text,
    provider: generationProvider,
    sourceObjectId: (data as GeneratedOutput).id,
    metadata: {
      provider: generationProvider,
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      action_type: values.actionType,
    },
  }).catch((indexError) => {
    console.error("Generated output search indexing failed", indexError);
  });

  revalidateWorkspaceSurfaces(values.accountId);

  return {
    output: {
      ...(data as GeneratedOutput),
      recalled_memories_json: scopedMemories,
    },
    memories: scopedMemories,
    warnings,
    degraded,
  };
}

export async function signOutAction() {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
}

export async function updateProfileNameAction(formData: FormData) {
  const { userId } = await getWorkspaceContext();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName.length > 0 ? fullName : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) throw error;

  revalidatePath("/settings");
  revalidatePath("/overview");
}

export async function importDemoWorkspaceDataAction() {
  const { userId, workspace } = await getWorkspaceContext();
  await seedDemoWorkspace({
    workspaceId: workspace.id,
    userId,
    hydraTenantId: workspace.hydradb_tenant_id,
  });

  revalidatePath("/settings");
  revalidatePath("/overview");
  revalidatePath("/accounts", "layout");
  revalidatePath("/contacts");
  revalidatePath("/activity");
}

export async function clearWorkspaceDataAction(formData: FormData) {
  const confirmValue = String(formData.get("confirm_clear") ?? "").trim();
  if (confirmValue !== "CLEAR") {
    throw new Error("Confirmation text must be CLEAR.");
  }

  const { workspace } = await getWorkspaceContext();
  const supabase = getSupabaseAdminClient();

  for (const table of [
    "workspace_context_pins",
    "search_index_entries",
    "documents",
    "messages",
    "conversations",
    "identity_aliases",
    "people",
    "organizations",
    "meetings",
    "generated_outputs",
    "activities",
    "notes",
    "slack_message_syncs",
    "outlook_message_syncs",
    "linkedin_profile_syncs",
    "gmail_message_syncs",
    "contacts",
    "accounts",
    "integration_action_events",
    "integration_sync_runs",
    "integration_connections",
    "gmail_integrations",
    "linkedin_integrations",
    "outlook_integrations",
    "slack_integrations",
  ] as const) {
    const { error } = await supabase.from(table).delete().eq("workspace_id", workspace.id);
    if (error) {
      throw error;
    }
  }

  const { error: workspaceError } = await supabase
    .from("workspaces")
    .update({
      seed_source: null,
      seeded_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workspace.id);
  if (workspaceError) {
    throw workspaceError;
  }

  revalidateWorkspaceSurfaces();
  revalidatePath("/settings");
}

async function recordIntegrationSyncRun(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  status: "ok" | "error";
  details: unknown;
  permissionScope: string;
  errorMessage?: string;
}) {
  const admin = getSupabaseAdminClient();
  const details = (input.details ?? {}) as {
    imported?: number;
    skipped?: number;
    failed?: number;
  };
  const { error } = await admin.from("integration_sync_runs").insert({
    workspace_id: input.workspaceId,
    owner_user_id: input.userId,
    provider: input.provider,
    status: input.status,
    imported_count: Number(details.imported ?? 0),
    skipped_count: Number(details.skipped ?? 0),
    failed_count: Number(details.failed ?? 0),
    details: (input.details ?? {}) as unknown as Record<string, unknown>,
    source_provider: input.provider,
    source_object_type: "integration_sync_run",
    source_object_id: `${input.provider}:${Date.now()}`,
    dedupe_key: `${input.provider}:sync:${input.workspaceId}:${Date.now()}:${crypto.randomUUID()}`,
    normalized_payload: {
      ...(input.errorMessage ? { last_error: input.errorMessage } : {}),
    },
    embedding_status: "not_indexed",
    permission_scope: input.permissionScope,
    synced_at: new Date().toISOString(),
  });
  if (error) {
    throw error;
  }
}

export async function syncGmailWorkspaceAction() {
  const { userId, workspace } = await getWorkspaceContext();
  await assertIntegrationRateLimit({
    workspaceId: workspace.id,
    userId,
    actionKey: "gmail_sync",
    limit: 12,
    windowMinutes: 30,
  });
  try {
    const result = await syncWorkspaceGmailMessages({
      userId,
      workspace,
      maxResults: 25,
    });
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "gmail",
      status: "connected",
      permissionScope: "gmail.readonly gmail.send gmail.compose",
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "gmail",
      status: "ok",
      details: result,
      permissionScope: "gmail.readonly gmail.send gmail.compose",
    });
    await recordIntegrationActionEvent({
      workspaceId: workspace.id,
      userId,
      actionKey: "gmail_sync",
      metadata: {
        fetched: result.fetched,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    revalidateWorkspaceSurfaces();

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail sync failed";
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "gmail",
      status: "error",
      permissionScope: "gmail.readonly gmail.send gmail.compose",
      lastError: message,
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "gmail",
      status: "error",
      details: { imported: 0, skipped: 0, failed: 1 },
      permissionScope: "gmail.readonly gmail.send gmail.compose",
      errorMessage: message,
    });
    throw error;
  }
}

export async function triggerGmailWorkspaceSyncAction() {
  await syncGmailWorkspaceAction();
}

export async function syncLinkedInWorkspaceAction() {
  const { userId, workspace } = await getWorkspaceContext();
  await assertIntegrationRateLimit({
    workspaceId: workspace.id,
    userId,
    actionKey: "linkedin_sync",
    limit: 12,
    windowMinutes: 30,
  });
  try {
    const result = await syncWorkspaceLinkedInSignals({
      userId,
      workspace,
      maxContacts: 25,
    });
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "linkedin",
      status: "connected",
      permissionScope: "openid profile email",
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "linkedin",
      status: "ok",
      details: result,
      permissionScope: "openid profile email",
    });
    await recordIntegrationActionEvent({
      workspaceId: workspace.id,
      userId,
      actionKey: "linkedin_sync",
      metadata: {
        scanned: result.scanned,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    revalidateWorkspaceSurfaces();

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "LinkedIn sync failed";
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "linkedin",
      status: "error",
      permissionScope: "openid profile email",
      lastError: message,
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "linkedin",
      status: "error",
      details: { imported: 0, skipped: 0, failed: 1 },
      permissionScope: "openid profile email",
      errorMessage: message,
    });
    throw error;
  }
}

export async function triggerLinkedInWorkspaceSyncAction() {
  await syncLinkedInWorkspaceAction();
}

export async function syncOutlookWorkspaceAction() {
  const { userId, workspace } = await getWorkspaceContext();
  await assertIntegrationRateLimit({
    workspaceId: workspace.id,
    userId,
    actionKey: "outlook_sync",
    limit: 12,
    windowMinutes: 30,
  });
  try {
    const result = await syncWorkspaceOutlookMessages({
      userId,
      workspace,
      maxResults: 25,
    });
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "outlook",
      status: "connected",
      permissionScope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "outlook",
      status: "ok",
      details: result,
      permissionScope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
    });
    await recordIntegrationActionEvent({
      workspaceId: workspace.id,
      userId,
      actionKey: "outlook_sync",
      metadata: {
        fetched: result.fetched,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
        meetings_imported: result.meetings_imported,
      },
    });

    revalidateWorkspaceSurfaces();

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outlook sync failed";
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "outlook",
      status: "error",
      permissionScope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
      lastError: message,
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "outlook",
      status: "error",
      details: { imported: 0, skipped: 0, failed: 1 },
      permissionScope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
      errorMessage: message,
    });
    throw error;
  }
}

export async function triggerOutlookWorkspaceSyncAction() {
  await syncOutlookWorkspaceAction();
}

export async function syncSlackWorkspaceAction() {
  const { userId, workspace } = await getWorkspaceContext();
  await assertIntegrationRateLimit({
    workspaceId: workspace.id,
    userId,
    actionKey: "slack_sync",
    limit: 12,
    windowMinutes: 30,
  });
  try {
    const result = await syncWorkspaceSlackSignals({
      userId,
      workspace,
      maxChannels: 8,
      maxMessagesPerChannel: 10,
    });
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "slack",
      status: "connected",
      permissionScope:
        "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "slack",
      status: "ok",
      details: result,
      permissionScope:
        "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
    });
    await recordIntegrationActionEvent({
      workspaceId: workspace.id,
      userId,
      actionKey: "slack_sync",
      metadata: {
        scanned: result.scanned,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    revalidateWorkspaceSurfaces();

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack sync failed";
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "slack",
      status: "error",
      permissionScope:
        "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
      lastError: message,
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "slack",
      status: "error",
      details: { imported: 0, skipped: 0, failed: 1 },
      permissionScope:
        "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
      errorMessage: message,
    });
    throw error;
  }
}

export async function triggerSlackWorkspaceSyncAction() {
  await syncSlackWorkspaceAction();
}

export async function connectGmailAction() {
  return "/auth/sign-in?intent=gmail_connect&next=/overview";
}

export async function connectLinkedInAction() {
  return "/auth/linkedin/start?next=/overview";
}

export async function connectOutlookAction() {
  return "/auth/sign-in?intent=outlook_connect&next=/overview";
}

export async function connectSlackAction() {
  return "/auth/slack/start?next=/overview";
}

export async function searchWorkspaceEntityCandidatesAction(
  input: unknown,
): Promise<WorkspaceEntitySearchResponse> {
  const values = workspaceEntitySearchSchema.parse(input);
  const { workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const supabase = await getSupabaseServerClient();
  const normalizedQuery = values.query.trim().toLowerCase();

  const [accountsResult, contactsResult, peopleResult, aliasesResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,name,domain,owner_name,stage,priority")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(80),
    supabase
      .from("contacts")
      .select("id,account_id,name,email,title,role_type,linkedin_url")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(120),
    supabase
      .from("people")
      .select("id,contact_id,organization_id,full_name,email,title,source_provider,linkedin_url")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(120),
    supabase
      .from("identity_aliases")
      .select("person_id,provider,alias_value")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  if (accountsResult.error) throw accountsResult.error;
  if (contactsResult.error) throw contactsResult.error;
  if (peopleResult.error) throw peopleResult.error;
  if (aliasesResult.error) throw aliasesResult.error;

  const accountRows = (accountsResult.data ?? []) as Array<Record<string, unknown>>;
  const contactRows = (contactsResult.data ?? []) as Array<Record<string, unknown>>;
  const peopleRows = (peopleResult.data ?? []) as Array<Record<string, unknown>>;
  const accountMap = new Map(
    accountRows.map((account) => [String(account.id), account]),
  );
  const aliasValuesByPerson = new Map<string, string[]>();
  for (const alias of (aliasesResult.data ?? []) as Array<Record<string, unknown>>) {
    const personId = String(alias.person_id ?? "");
    if (!personId) continue;
    const current = aliasValuesByPerson.get(personId) ?? [];
    current.push(String(alias.alias_value ?? ""));
    aliasValuesByPerson.set(personId, current);
  }

  const accountCandidates = accountRows
    .filter((account) =>
      [
        account.name,
        account.domain,
        account.owner_name,
        account.stage,
        account.priority,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    )
    .slice(0, 8)
    .map((account) => ({
      kind: "account" as const,
      id: String(account.id),
      title: String(account.name ?? "Untitled account"),
      subtitle: [account.domain, account.owner_name].filter(Boolean).join(" • ") || null,
      provider: null,
      account_id: String(account.id),
      domain: (account.domain as string | null) ?? null,
    }));

  const personCandidates = [
    ...peopleRows.map((person) => ({
      id: String(person.id),
      contact_id: (person.contact_id as string | null) ?? null,
      account_id:
        ((person.contact_id as string | null)
          ? contactRows.find(
              (contact) => String(contact.id) === String(person.contact_id),
            )?.account_id
          : null) ?? null,
      title: String(person.full_name ?? "Unknown person"),
      subtitle:
        [
          person.email,
          person.title,
          aliasValuesByPerson.get(String(person.id))?.find(Boolean) ?? null,
        ]
          .filter(Boolean)
          .join(" • ") || null,
      provider: (person.source_provider as IntegrationProvider | null) ?? null,
      email: (person.email as string | null) ?? null,
      role_title: (person.title as string | null) ?? null,
      linkedin_url: (person.linkedin_url as string | null) ?? null,
      search_blob: [
        person.full_name,
        person.email,
        person.title,
        aliasValuesByPerson.get(String(person.id))?.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    })),
    ...contactRows.map((contact) => ({
      id: String(contact.id),
      contact_id: String(contact.id),
      account_id: (contact.account_id as string | null) ?? null,
      title: String(contact.name ?? "Unknown contact"),
      subtitle: [contact.email, contact.title, contact.role_type]
        .filter(Boolean)
        .join(" • ") || null,
      provider: (contact.linkedin_url ? "linkedin" : null) as IntegrationProvider | null,
      email: (contact.email as string | null) ?? null,
      role_title: (contact.title as string | null) ?? null,
      linkedin_url: (contact.linkedin_url as string | null) ?? null,
      search_blob: [
        contact.name,
        contact.email,
        contact.title,
        contact.role_type,
        contact.linkedin_url,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    })),
  ]
    .filter((person) => person.search_blob.includes(normalizedQuery))
    .filter(
      (person, index, array) =>
        array.findIndex(
          (candidate) =>
            candidate.contact_id === person.contact_id && candidate.title === person.title,
        ) === index,
    )
    .slice(0, 10)
    .map((person) => {
      const account =
        typeof person.account_id === "string" ? accountMap.get(person.account_id) : null;
      return {
        kind: "person" as const,
        id: person.id,
        title: person.title,
        subtitle:
          [person.subtitle, account ? String(account.name) : null].filter(Boolean).join(" • ") ||
          null,
        provider: person.provider,
        account_id: typeof person.account_id === "string" ? person.account_id : null,
        contact_id: person.contact_id,
        email: person.email,
        role_title: person.role_title,
        linkedin_url: person.linkedin_url,
      };
    });

  return {
    accounts: accountCandidates,
    people: personCandidates,
  };
}

export async function pinWorkspaceContextAction(input: unknown) {
  const values = pinWorkspaceContextSchema.parse(input);
  const { userId, workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("workspace_context_pins").upsert(
    {
      workspace_id: workspace.id,
      owner_user_id: userId,
      entity_type: values.entityType,
      entity_id: values.entityId,
      title: values.title,
      subtitle: values.subtitle ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,entity_type,entity_id" },
  );

  if (error) throw error;

  revalidateWorkspaceSurfaces();
}

export async function transformNotesBriefContentAction(
  input: unknown,
): Promise<NotesBriefTransformResult> {
  const values = notesBriefTransformSchema.parse(input);
  const { workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const generation = await generateGeminiText(
    buildDocumentTransformPrompt({
      mode: values.mode,
      title: values.title,
      content: values.content,
    }),
  );

  return {
    title: values.title,
    content: generation.text,
    mode: values.mode,
  };
}

export async function saveWorkspaceDocumentAction(input: unknown) {
  const values = saveWorkspaceDocumentSchema.parse(input);
  const { userId, workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  const supabase = await getSupabaseServerClient();
  const account =
    values.accountId != null
      ? (
          await supabase
            .from("accounts")
            .select("*")
            .eq("id", values.accountId)
            .eq("workspace_id", workspace.id)
            .maybeSingle()
        ).data
      : null;
  const contact =
    values.contactId != null
      ? (
          await supabase
            .from("contacts")
            .select("*")
            .eq("id", values.contactId)
            .eq("workspace_id", workspace.id)
            .maybeSingle()
        ).data
      : null;

  const provider: IntegrationProvider = "manual";
  const document = await upsertDocumentProjection({
    workspaceId: workspace.id,
    userId,
    provider,
    organizationId: null,
    personId: null,
    title: values.title,
    body: values.content,
    kind: values.kind,
    sourceObjectId: `${values.kind}:${crypto.randomUUID()}`,
    normalizedPayload: {
      account_id: values.accountId ?? null,
      contact_id: values.contactId ?? null,
      save_as_note: values.saveAsNote,
    },
  });

  await upsertSearchIndexEntry({
    workspaceId: workspace.id,
    userId,
    entityType: "document",
    entityId: document.id,
    title: values.title,
    body: values.content,
    provider,
    sourceObjectId: document.id,
    metadata: {
      account_id: values.accountId ?? null,
      contact_id: values.contactId ?? null,
      kind: values.kind,
    },
  });

  let note: Note | null = null;
  if (values.saveAsNote && values.accountId) {
    const { data, error } = await supabase
      .from("notes")
      .insert({
        workspace_id: workspace.id,
        account_id: values.accountId,
        contact_id: values.contactId ?? null,
        author_id: userId,
        title: values.title,
        content: values.content,
        source_type: "uploaded_document",
        topic: values.kind,
        importance_level: "medium",
      })
      .select("*")
      .single();

    if (error) throw error;
    note = data as Note;

    if (account) {
      try {
        const hydraResponse = await addMemories({
          tenantId: workspace.hydradb_tenant_id,
          memories: [
            buildNoteMemoryPayload({
              note,
              account: account as Account,
              contact: (contact as Contact | null) ?? null,
              userId,
            }),
          ],
        });
        const memoryId = hydraResponse.memory_ids?.[0] ?? hydraResponse.ids?.[0] ?? null;
        if (memoryId) {
          await supabase
            .from("notes")
            .update({ hydradb_memory_id: memoryId })
            .eq("id", note.id);
        }
      } catch (error) {
        console.error("HydraDB uploaded document ingestion failed", error);
      }
    }
  }

  if (values.accountId) {
    await supabase.from("activities").insert({
      workspace_id: workspace.id,
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      actor_id: userId,
      activity_type: "document_uploaded",
      title: values.title,
      description: `${values.kind.replaceAll("_", " ")} saved to Notes / Briefs`,
      metadata: {
        topic: values.kind,
        document_id: document.id,
      },
      occurred_at: new Date().toISOString(),
    });
  }

  revalidateWorkspaceSurfaces(values.accountId ?? null);

  return { documentId: document.id, noteId: note?.id ?? null };
}

export async function prepareGmailFollowUpAction(
  input: unknown,
): Promise<GmailFollowUpDraftResult> {
  const values = prepareGmailFollowUpSchema.parse(input);
  const { userId, workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  await assertIntegrationRateLimit({
    workspaceId: workspace.id,
    userId,
    actionKey: "gmail_prepare_followup",
    limit: 30,
    windowMinutes: 15,
  });

  const { accessToken } = await getValidGmailAccessToken({
    workspaceId: workspace.id,
    userId,
  });

  const composerResult = await runComposerAction({
    workspaceId: values.workspaceId,
    accountId: values.accountId,
    contactId: values.contactId ?? null,
    actionType: "draft_followup",
    prompt: values.prompt || "",
  });

  const accountPage = await getAccountPageData(values.accountId);
  const fallbackSubject = `Follow-up: ${accountPage.account.name}`;
  const suggestedSubject = values.subject?.trim() || fallbackSubject;

  await createGmailDraft({
    accessToken,
    to: values.toEmail,
    subject: suggestedSubject,
    body: composerResult.output.output_text,
  });

  await recordIntegrationActionEvent({
    workspaceId: workspace.id,
    userId,
    actionKey: "gmail_prepare_followup",
    metadata: {
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      to_email: values.toEmail,
    },
  });

  logIntegrationEvent({
    source: "gmail",
    event: "followup_draft_prepared",
    workspaceId: workspace.id,
    userId,
    detail: {
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      generated_output_id: composerResult.output.id,
    },
  });

  return {
    draft_preview: composerResult.output.output_text,
    send_confirmation_required: true,
    generated_output_id: composerResult.output.id,
    suggested_subject: suggestedSubject,
    to_email: values.toEmail,
  };
}

export async function sendGmailFollowUpAction(input: unknown): Promise<GmailSendResult> {
  const values = sendGmailFollowUpSchema.parse(input);
  const { userId, workspace } = await getWorkspaceContext();

  if (workspace.id !== values.workspaceId) {
    throw new Error("Workspace mismatch.");
  }

  await assertIntegrationRateLimit({
    workspaceId: workspace.id,
    userId,
    actionKey: "gmail_send_followup",
    limit: 12,
    windowMinutes: 15,
  });

  const supabase = await getSupabaseServerClient();
  const [{ data: account }, { data: sourceOutput }] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("id", values.accountId)
      .eq("workspace_id", workspace.id)
      .single(),
    supabase
      .from("generated_outputs")
      .select("*")
      .eq("id", values.generatedOutputId)
      .eq("workspace_id", workspace.id)
      .single(),
  ]);
  if (!account) {
    throw new Error("Account not found.");
  }
  if (!sourceOutput) {
    throw new Error("Generated output context not found.");
  }

  const memories = ((sourceOutput.recalled_memories_json ?? []) as RecalledMemory[]).slice(0, 8);
  const { accessToken } = await getValidGmailAccessToken({
    workspaceId: workspace.id,
    userId,
  });

  const gmailSent = await sendGmailMessage({
    accessToken,
    to: values.toEmail,
    subject: values.subject,
    body: values.body,
  });

  const { data: persistedOutput, error: persistedError } = await supabase
    .from("generated_outputs")
    .insert({
      workspace_id: workspace.id,
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      action_type: "draft_followup",
      prompt: `gmail_send_followup::to=${values.toEmail};subject=${values.subject}`,
      output_text: values.body,
      recalled_memories_json: memories,
      model_name: sourceOutput.model_name ?? "gmail_send",
      created_by: userId,
    })
    .select("*")
    .single();

  if (persistedError) {
    throw new Error(
      `Email sent, but ContextIQ failed to persist the sent draft record: ${persistedError.message}`,
    );
  }

  const { error: activityError } = await supabase.from("activities").insert({
    workspace_id: workspace.id,
    account_id: values.accountId,
    contact_id: values.contactId ?? null,
    actor_id: userId,
    activity_type: "email_sent",
    title: values.subject,
    description: `Follow-up sent to ${values.toEmail}`,
    metadata: {
      topic: "gmail_followup_send",
      gmail_message_id: gmailSent.id,
      gmail_thread_id: gmailSent.threadId ?? null,
      to_email: values.toEmail,
      source_generated_output_id: values.generatedOutputId,
      persisted_generated_output_id: persistedOutput.id,
    },
    occurred_at: new Date().toISOString(),
  });

  if (activityError) {
    throw new Error(
      `Email sent, but ContextIQ failed to persist the activity timeline event: ${activityError.message}`,
    );
  }

  await recordIntegrationActionEvent({
    workspaceId: workspace.id,
    userId,
    actionKey: "gmail_send_followup",
    metadata: {
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      to_email: values.toEmail,
    },
  });

  logIntegrationEvent({
    source: "gmail",
    event: "followup_sent",
    workspaceId: workspace.id,
    userId,
    detail: {
      account_id: values.accountId,
      contact_id: values.contactId ?? null,
      gmail_message_id: gmailSent.id,
    },
  });

  revalidateWorkspaceSurfaces(values.accountId);

  return {
    message_id: gmailSent.id,
    thread_id: gmailSent.threadId ?? null,
    label_ids: gmailSent.labelIds ?? [],
    generated_output_id: persistedOutput.id,
  };
}
