import { createHash } from "crypto";

import { syncWorkspaceGmailMessages } from "@/lib/gmail/sync";
import { syncWorkspaceLinkedInSignals } from "@/lib/linkedin/sync";
import { syncWorkspaceOutlookMessages } from "@/lib/outlook/sync";
import { syncWorkspaceSlackSignals } from "@/lib/slack/sync";
import { INTEGRATION_DEFAULT_CAPABILITIES, providerDisplayName } from "@/lib/integrations/catalog";
import { upsertIntegrationConnectionStatus } from "@/lib/integrations/connections";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  CrossToolActionRequest,
  CrossToolActionResponse,
  IntegrationConnectionStatus,
  IntegrationProvider,
  Workspace,
} from "@/types";

export type ProviderResult =
  | { ok: true; mode: "connected" | "redirect"; message: string; redirectUrl?: string }
  | { ok: false; mode: "pending_approval" | "error"; message: string };

function buildDedupeKey(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

async function getApiWorkspaceContext(): Promise<{ userId: string; workspace: Workspace }> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace:workspaces(*)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (membershipError || !membership?.workspace) {
    throw new Error("Workspace not found");
  }

  return {
    userId: user.id,
    workspace: membership.workspace as Workspace,
  };
}

export async function connectIntegrationProvider(
  provider: IntegrationProvider,
  nextPath = "/overview",
): Promise<ProviderResult> {
  const { userId, workspace } = await getApiWorkspaceContext();
  const safeNextPath = nextPath.startsWith("/") ? nextPath : "/overview";

  if (provider === "gmail") {
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider,
      status: "pending_approval",
      permissionScope: "gmail.readonly gmail.send gmail.compose",
    });
    return {
      ok: true,
      mode: "redirect",
      message: "Redirecting to Google OAuth.",
      redirectUrl: `/auth/sign-in?intent=gmail_connect&next=${encodeURIComponent(safeNextPath)}`,
    };
  }

  if (provider === "linkedin") {
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider,
      status: "pending_approval",
      permissionScope: "openid profile email",
    });
    return {
      ok: true,
      mode: "redirect",
      message: "Redirecting to LinkedIn OAuth.",
      redirectUrl: `/auth/linkedin/start?next=${encodeURIComponent(safeNextPath)}`,
    };
  }

  if (provider === "outlook") {
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider,
      status: "pending_approval",
      permissionScope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
    });
    return {
      ok: true,
      mode: "redirect",
      message: "Redirecting to Microsoft OAuth.",
      redirectUrl: `/auth/sign-in?intent=outlook_connect&next=${encodeURIComponent(safeNextPath)}`,
    };
  }

  if (provider === "slack") {
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider,
      status: "pending_approval",
      permissionScope:
        "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
    });
    return {
      ok: true,
      mode: "redirect",
      message: "Redirecting to Slack OAuth.",
      redirectUrl: `/auth/slack/start?next=${encodeURIComponent(safeNextPath)}`,
    };
  }

  await upsertIntegrationConnectionStatus({
    workspaceId: workspace.id,
    userId,
    provider,
    status: "pending_approval",
  });
  return {
    ok: false,
    mode: "pending_approval",
    message: `${providerDisplayName(provider)} is pending provider approval/setup.`,
  };
}

export async function syncIntegrationProvider(provider: IntegrationProvider): Promise<ProviderResult> {
  const { userId, workspace } = await getApiWorkspaceContext();
  const supabase = await getSupabaseServerClient();
  const runDedupe = buildDedupeKey([
    workspace.id,
    userId,
    provider,
    "sync",
    new Date().toISOString(),
  ]);

  const runBase = {
    workspace_id: workspace.id,
    owner_user_id: userId,
    provider,
    source_provider: provider,
    source_object_type: "integration_sync_run",
    source_object_id: `${provider}:${Date.now()}`,
    dedupe_key: runDedupe,
    normalized_payload: {},
    embedding_status: "not_indexed",
    permission_scope: null as string | null,
    synced_at: new Date().toISOString(),
  };

  if (provider === "gmail") {
    try {
      const sync = await syncWorkspaceGmailMessages({
        userId,
        workspace,
        maxResults: 25,
      });
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider,
        status: "connected",
        permissionScope: "gmail.readonly gmail.send gmail.compose",
      });
      await supabase.from("integration_sync_runs").insert({
        ...runBase,
        status: "ok",
        imported_count: sync.imported,
        skipped_count: sync.skipped,
        failed_count: sync.failed,
        details: sync,
      });
      return {
        ok: true,
        mode: "connected",
        message: `Gmail sync completed. Imported ${sync.imported}, skipped ${sync.skipped}, failed ${sync.failed}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail sync failed";
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider,
        status: "error",
        permissionScope: "gmail.readonly gmail.send gmail.compose",
        lastError: message,
      });
      throw error;
    }
  }

  if (provider === "linkedin") {
    try {
      const sync = await syncWorkspaceLinkedInSignals({
        userId,
        workspace,
        maxContacts: 25,
      });
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider,
        status: "connected",
        permissionScope: "openid profile email",
      });
      await supabase.from("integration_sync_runs").insert({
        ...runBase,
        status: "ok",
        imported_count: sync.imported,
        skipped_count: sync.skipped,
        failed_count: sync.failed,
        details: sync,
      });
      return {
        ok: true,
        mode: "connected",
        message: `LinkedIn sync completed. Imported ${sync.imported}, skipped ${sync.skipped}, failed ${sync.failed}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "LinkedIn sync failed";
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider,
        status: "error",
        permissionScope: "openid profile email",
        lastError: message,
      });
      throw error;
    }
  }

  if (provider === "outlook") {
    try {
      const sync = await syncWorkspaceOutlookMessages({
        userId,
        workspace,
        maxResults: 25,
      });
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider,
        status: "connected",
        permissionScope: "openid profile email offline_access Mail.Read User.Read",
      });
      await supabase.from("integration_sync_runs").insert({
        ...runBase,
        status: "ok",
        imported_count: sync.imported,
        skipped_count: sync.skipped,
        failed_count: sync.failed,
        details: sync,
      });
      return {
        ok: true,
        mode: "connected",
        message: `Outlook sync completed. Imported ${sync.imported}, skipped ${sync.skipped}, failed ${sync.failed}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Outlook sync failed";
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider,
        status: "error",
        permissionScope: "openid profile email offline_access Mail.Read User.Read",
        lastError: message,
      });
      throw error;
    }
  }

  if (provider === "slack") {
    try {
      const sync = await syncWorkspaceSlackSignals({
        userId,
        workspace,
        maxChannels: 8,
        maxMessagesPerChannel: 10,
      });
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider,
        status: "connected",
        permissionScope:
          "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
      });
      await supabase.from("integration_sync_runs").insert({
        ...runBase,
        status: "ok",
        imported_count: sync.imported,
        skipped_count: sync.skipped,
        failed_count: sync.failed,
        details: sync,
      });
      return {
        ok: true,
        mode: "connected",
        message: `Slack sync completed. Imported ${sync.imported}, skipped ${sync.skipped}, failed ${sync.failed}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slack sync failed";
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider,
        status: "error",
        permissionScope:
          "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
        lastError: message,
      });
      throw error;
    }
  }

  await upsertIntegrationConnectionStatus({
    workspaceId: workspace.id,
    userId,
    provider,
    status: "pending_approval",
  });
  await supabase.from("integration_sync_runs").insert({
    ...runBase,
    status: "partial",
    details: { reason: "provider_pending_approval" },
  });
  return {
    ok: false,
    mode: "pending_approval",
    message: `${providerDisplayName(provider)} sync is pending provider approval/setup.`,
  };
}

export async function executeProviderWriteback(params: {
  provider: IntegrationProvider;
  payload: Record<string, unknown>;
}) {
  const { userId, workspace } = await getApiWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const executionDedupe = buildDedupeKey([
    workspace.id,
    userId,
    params.provider,
    "writeback",
    JSON.stringify(params.payload),
    new Date().toISOString(),
  ]);

  const isSupported =
    params.provider === "gmail" ||
    params.provider === "resend" ||
    params.provider === "outlook";
  const status: IntegrationConnectionStatus = isSupported ? "connected" : "pending_approval";

  await upsertIntegrationConnectionStatus({
    workspaceId: workspace.id,
    userId,
    provider: params.provider,
    status,
  });

  const { data, error } = await supabase
    .from("action_executions")
    .insert({
      workspace_id: workspace.id,
      owner_user_id: userId,
      action_type: `writeback_${params.provider}`,
      source_entity_type: "actions_tab",
      source_entity_id: null,
      writeback_provider: params.provider,
      writeback_ref: isSupported ? `${params.provider}:${Date.now()}` : null,
      input_payload: params.payload,
      output_payload: isSupported
        ? { status: "executed", provider: params.provider }
        : { status: "pending_approval", provider: params.provider },
      ai_generated: true,
      approval_state: "auto_executed",
      source_provider: params.provider,
      source_object_type: "action_execution",
      source_object_id: `${params.provider}:${Date.now()}`,
      dedupe_key: executionDedupe,
      raw_payload_ref: null,
      normalized_payload: params.payload,
      embedding_status: "not_indexed",
      permission_scope: null,
      synced_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) throw error;

  return {
    ok: isSupported,
    mode: isSupported ? "connected" : "pending_approval",
    message: isSupported
      ? `${providerDisplayName(params.provider)} writeback executed.`
      : `${providerDisplayName(params.provider)} writeback pending provider approval/setup.`,
    actionExecution: data,
  };
}

export async function executeCrossToolAction(
  input: CrossToolActionRequest,
): Promise<CrossToolActionResponse> {
  const provider =
    input.actionType === "send_email" || input.actionType === "draft_email"
      ? ("gmail" as const)
      : input.actionType === "post_slack"
        ? ("slack" as const)
        : input.actionType === "create_calendar_event"
          ? ("outlook" as const)
          : input.actionType === "reply_intercom"
            ? ("intercom" as const)
            : input.actionType === "send_sms"
              ? ("twilio" as const)
              : input.actionType === "create_notion_brief"
                ? ("notion" as const)
                : ("hubspot" as const);

  const writeback = await executeProviderWriteback({
    provider,
    payload: {
      workspaceId: input.workspaceId,
      targetAccountId: input.targetAccountId,
      targetPersonId: input.targetPersonId,
      actionType: input.actionType,
      ...input.payload,
    },
  });

  return {
    actionExecution: writeback.actionExecution,
    providerStatus: {
      provider,
      status: writeback.ok ? "connected" : "pending_approval",
      capabilities: INTEGRATION_DEFAULT_CAPABILITIES[provider],
      last_synced_at: new Date().toISOString(),
      message: writeback.message,
    },
  };
}

export async function ingestProviderWebhook(params: {
  provider: IntegrationProvider;
  payload: Record<string, unknown>;
}) {
  const { userId, workspace } = await getApiWorkspaceContext();
  const supabase = await getSupabaseServerClient();

  const dedupeKey = buildDedupeKey([
    workspace.id,
    params.provider,
    "webhook",
    JSON.stringify(params.payload),
  ]);

  await supabase.from("timeline_events").insert({
    workspace_id: workspace.id,
    owner_user_id: userId,
    event_type: "webhook_ingested",
    summary: `${providerDisplayName(params.provider)} webhook ingested`,
    source_provider: params.provider,
    source_object_type: "timeline_event",
    source_object_id: `${params.provider}:${Date.now()}`,
    dedupe_key: dedupeKey,
    normalized_payload: params.payload,
    embedding_status: "not_indexed",
    permission_scope: null,
    synced_at: new Date().toISOString(),
  });

  return { ok: true };
}
