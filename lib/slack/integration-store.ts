import { decryptSecret, encryptSecret } from "@/lib/integrations/token-crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SlackIntegration, SlackIntegrationStatus } from "@/types";

export async function upsertSlackIntegrationTokens(input: {
  workspaceId: string;
  userId: string;
  email?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  enterpriseId?: string | null;
  slackUserId?: string | null;
  userAccessToken?: string | null;
  botAccessToken?: string | null;
  userTokenType?: string | null;
  botTokenType?: string | null;
  userScopes?: string[];
  botScopes?: string[];
  needsReconnect?: boolean;
}) {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase.from("slack_integrations").upsert(
    {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      provider: "slack",
      email: input.email ?? null,
      team_id: input.teamId ?? null,
      team_name: input.teamName ?? null,
      enterprise_id: input.enterpriseId ?? null,
      slack_user_id: input.slackUserId ?? null,
      user_access_token_encrypted: input.userAccessToken
        ? encryptSecret(input.userAccessToken)
        : null,
      bot_access_token_encrypted: input.botAccessToken
        ? encryptSecret(input.botAccessToken)
        : null,
      access_token_encrypted: input.userAccessToken
        ? encryptSecret(input.userAccessToken)
        : input.botAccessToken
          ? encryptSecret(input.botAccessToken)
          : null,
      user_token_type: input.userTokenType ?? "user",
      bot_token_type: input.botTokenType ?? "bot",
      token_type:
        input.userTokenType ?? input.botTokenType ?? "Bearer",
      user_scopes: input.userScopes ?? [],
      bot_scopes: input.botScopes ?? [],
      scopes: input.userScopes?.length
        ? input.userScopes
        : input.botScopes ?? [],
      needs_reconnect: input.needsReconnect ?? false,
      connected_at: new Date().toISOString(),
      sync_status: "idle",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,user_id,provider" },
  );

  if (error) throw error;
}

export async function getDecryptedSlackIntegration(input: {
  workspaceId: string;
  userId: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("slack_integrations")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "slack")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const integration = data as SlackIntegration;
  return {
    ...integration,
    user_access_token: integration.user_access_token_encrypted
      ? decryptSecret(integration.user_access_token_encrypted)
      : null,
    bot_access_token: integration.bot_access_token_encrypted
      ? decryptSecret(integration.bot_access_token_encrypted)
      : null,
  };
}

export async function getSlackIntegrationStatus(input: {
  workspaceId: string;
  userId: string;
}): Promise<SlackIntegrationStatus> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("slack_integrations")
    .select("email,team_id,team_name,slack_user_id,needs_reconnect,user_access_token_encrypted,bot_access_token_encrypted,last_synced_at,sync_status,last_error")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "slack")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return {
      connected: false,
      email: null,
      team_id: null,
      team_name: null,
      slack_user_id: null,
      needs_reconnect: false,
      last_synced_at: null,
      sync_status: "idle",
      last_error: null,
    };
  }

  const inferredNeedsReconnect =
    Boolean(data.bot_access_token_encrypted) && !Boolean(data.user_access_token_encrypted);

  return {
    connected: true,
    email: (data.email as string | null) ?? null,
    team_id: (data.team_id as string | null) ?? null,
    team_name: (data.team_name as string | null) ?? null,
    slack_user_id: (data.slack_user_id as string | null) ?? null,
    needs_reconnect: Boolean(data.needs_reconnect) || inferredNeedsReconnect,
    last_synced_at: (data.last_synced_at as string | null) ?? null,
    sync_status: (data.sync_status as "idle" | "syncing" | "ok" | "error") ?? "idle",
    last_error: (data.last_error as string | null) ?? null,
  };
}

export async function updateSlackSyncState(input: {
  workspaceId: string;
  userId: string;
  syncStatus: "idle" | "syncing" | "ok" | "error";
  lastError?: string | null;
  lastSyncedAt?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  const payload: Record<string, unknown> = {
    sync_status: input.syncStatus,
    updated_at: new Date().toISOString(),
  };

  if (typeof input.lastError !== "undefined") {
    payload.last_error = input.lastError;
  }

  if (typeof input.lastSyncedAt !== "undefined") {
    payload.last_synced_at = input.lastSyncedAt;
  }

  const { error } = await supabase
    .from("slack_integrations")
    .update(payload)
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "slack");

  if (error) throw error;
}
