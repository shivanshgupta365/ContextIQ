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
  prepareGmailFollowUpSchema,
  runActionSchema,
  sendGmailFollowUpSchema,
} from "@/lib/validators/contextiq";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
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
} from "@/types";

export async function createAccountAction(input: unknown) {
  const values = createAccountSchema.parse(input);
  const { workspace } = await getWorkspaceContext();

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

  revalidatePath("/overview");

  return data as Account;
}

export async function createContactAction(input: unknown) {
  const values = createContactSchema.parse(input);
  const { workspace } = await getWorkspaceContext();

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

  revalidatePath(`/accounts/${values.accountId}`);
  revalidatePath("/contacts");

  return data as Contact;
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

  revalidatePath(`/accounts/${values.accountId}`);
  revalidatePath("/overview");

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

  revalidatePath(`/accounts/${values.accountId}`);
  revalidatePath("/activity");
  revalidatePath("/overview");

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

  const memories = await fullRecall({
    tenantId: workspace.hydradb_tenant_id,
    query: recallQueryMap[values.actionType],
    filters: {
      workspace_id: workspace.id,
      account_id: values.accountId,
    },
    topK: 6,
  });

  const scopedMemories = filterMemoriesForContact(memories, values.contactId, 6);

  const prompt = buildActionPrompt({
    actionType: values.actionType,
    account: pageData.account,
    contacts: pageData.contacts,
    selectedContact,
    activities: pageData.activities,
    memories: scopedMemories,
    prompt: values.prompt || null,
  });

  const generation = await generateGeminiText(prompt);
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

  if (error) throw error;

  revalidatePath(`/accounts/${values.accountId}`);
  revalidatePath("/overview");

  return {
    output: {
      ...(data as GeneratedOutput),
      recalled_memories_json: scopedMemories,
    },
    memories: scopedMemories,
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
  const supabase = await getSupabaseServerClient();

  await supabase.from("generated_outputs").delete().eq("workspace_id", workspace.id);
  await supabase.from("activities").delete().eq("workspace_id", workspace.id);
  await supabase.from("notes").delete().eq("workspace_id", workspace.id);
  await supabase.from("contacts").delete().eq("workspace_id", workspace.id);
  await supabase.from("accounts").delete().eq("workspace_id", workspace.id);

  await supabase.from("integration_action_events").delete().eq("workspace_id", workspace.id);
  await supabase.from("integration_sync_runs").delete().eq("workspace_id", workspace.id);
  await supabase.from("integration_connections").delete().eq("workspace_id", workspace.id);
  await supabase.from("gmail_integrations").delete().eq("workspace_id", workspace.id);
  await supabase.from("linkedin_integrations").delete().eq("workspace_id", workspace.id);
  await supabase.from("outlook_integrations").delete().eq("workspace_id", workspace.id);
  await supabase.from("slack_integrations").delete().eq("workspace_id", workspace.id);
  await supabase
    .from("workspaces")
    .update({
      seed_source: null,
      seeded_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workspace.id);

  revalidatePath("/settings");
  revalidatePath("/overview");
  revalidatePath("/accounts", "layout");
  revalidatePath("/contacts");
  revalidatePath("/activity");
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
  await admin.from("integration_sync_runs").insert({
    workspace_id: input.workspaceId,
    owner_user_id: input.userId,
    provider: input.provider,
    status: input.status,
    imported_count: Number(details.imported ?? 0),
    skipped_count: Number(details.skipped ?? 0),
    failed_count: Number(details.failed ?? 0),
    details: input.details as Record<string, unknown>,
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

    revalidatePath("/overview");
    revalidatePath("/activity");
    revalidatePath("/contacts");
    revalidatePath("/accounts", "layout");

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

    revalidatePath("/overview");
    revalidatePath("/activity");
    revalidatePath("/contacts");
    revalidatePath("/accounts", "layout");

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
      permissionScope: "openid profile email offline_access Mail.Read User.Read",
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "outlook",
      status: "ok",
      details: result,
      permissionScope: "openid profile email offline_access Mail.Read User.Read",
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
      },
    });

    revalidatePath("/overview");
    revalidatePath("/activity");
    revalidatePath("/contacts");
    revalidatePath("/accounts", "layout");

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outlook sync failed";
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "outlook",
      status: "error",
      permissionScope: "openid profile email offline_access Mail.Read User.Read",
      lastError: message,
    });
    await recordIntegrationSyncRun({
      workspaceId: workspace.id,
      userId,
      provider: "outlook",
      status: "error",
      details: { imported: 0, skipped: 0, failed: 1 },
      permissionScope: "openid profile email offline_access Mail.Read User.Read",
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

    revalidatePath("/overview");
    revalidatePath("/activity");
    revalidatePath("/contacts");
    revalidatePath("/accounts", "layout");

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

  const { accessToken } = await getValidGmailAccessToken({
    workspaceId: workspace.id,
    userId,
  });

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

  if (persistedError) throw persistedError;

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

  if (activityError) throw activityError;

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

  revalidatePath(`/accounts/${values.accountId}`);
  revalidatePath("/activity");
  revalidatePath("/overview");

  return {
    message_id: gmailSent.id,
    thread_id: gmailSent.threadId ?? null,
    label_ids: gmailSent.labelIds ?? [],
    generated_output_id: persistedOutput.id,
  };
}
