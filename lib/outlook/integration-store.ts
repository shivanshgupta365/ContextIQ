import { decryptSecret, encryptSecret } from "@/lib/integrations/token-crypto";
import { refreshMicrosoftAccessToken } from "@/lib/outlook/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OutlookIntegration, OutlookIntegrationStatus } from "@/types";

export async function upsertOutlookIntegrationTokens(input: {
  workspaceId: string;
  userId: string;
  email: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  tokenType?: string | null;
  scopes?: string[];
}) {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase.from("outlook_integrations").upsert(
    {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      provider: "outlook",
      email: input.email,
      access_token_encrypted: encryptSecret(input.accessToken),
      refresh_token_encrypted: input.refreshToken ? encryptSecret(input.refreshToken) : null,
      token_type: input.tokenType ?? "Bearer",
      scopes: input.scopes ?? [],
      expires_at: input.expiresAt ?? null,
      connected_at: new Date().toISOString(),
      sync_status: "idle",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,user_id,provider" },
  );

  if (error) throw error;
}

export async function getDecryptedOutlookIntegration(input: {
  workspaceId: string;
  userId: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("outlook_integrations")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "outlook")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const integration = data as OutlookIntegration;
  return {
    ...integration,
    access_token: decryptSecret(integration.access_token_encrypted),
    refresh_token: integration.refresh_token_encrypted
      ? decryptSecret(integration.refresh_token_encrypted)
      : null,
  };
}

export async function getOutlookIntegrationStatus(input: {
  workspaceId: string;
  userId: string;
}): Promise<OutlookIntegrationStatus> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("outlook_integrations")
    .select("email,last_synced_at,sync_status,last_error")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "outlook")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return {
      connected: false,
      email: null,
      last_synced_at: null,
      sync_status: "idle",
      last_error: null,
    };
  }

  return {
    connected: true,
    email: (data.email as string | null) ?? null,
    last_synced_at: (data.last_synced_at as string | null) ?? null,
    sync_status: (data.sync_status as "idle" | "syncing" | "ok" | "error") ?? "idle",
    last_error: (data.last_error as string | null) ?? null,
  };
}

export async function updateOutlookSyncState(input: {
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
    .from("outlook_integrations")
    .update(payload)
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "outlook");

  if (error) throw error;
}

export async function getValidOutlookAccessToken(input: {
  workspaceId: string;
  userId: string;
}) {
  const integration = await getDecryptedOutlookIntegration(input);
  if (!integration) {
    throw new Error("Outlook is not connected for this workspace user.");
  }

  const expiresAtMs = integration.expires_at ? new Date(integration.expires_at).getTime() : null;
  const needsRefresh =
    expiresAtMs == null
      ? Boolean(integration.refresh_token)
      : expiresAtMs <= Date.now() + 30_000;

  if (!needsRefresh) {
    return { accessToken: integration.access_token, integration };
  }

  if (!integration.refresh_token) {
    return { accessToken: integration.access_token, integration };
  }

  const refreshed = await refreshMicrosoftAccessToken({
    refreshToken: integration.refresh_token,
  });

  await upsertOutlookIntegrationTokens({
    workspaceId: input.workspaceId,
    userId: input.userId,
    email: integration.email,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenType: refreshed.tokenType,
    expiresAt: refreshed.expiresAt,
    scopes: refreshed.scopes.length ? refreshed.scopes : integration.scopes,
  });

  return {
    accessToken: refreshed.accessToken,
    integration: {
      ...integration,
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      expires_at: refreshed.expiresAt,
    },
  };
}
