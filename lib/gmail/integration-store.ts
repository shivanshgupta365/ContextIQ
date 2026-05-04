import { decryptSecret, encryptSecret } from "@/lib/integrations/token-crypto";
import { refreshGoogleAccessToken } from "@/lib/gmail/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { GmailIntegration, GmailIntegrationStatus } from "@/types";

export async function upsertGmailIntegrationTokens(input: {
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

  const { error } = await supabase.from("gmail_integrations").upsert(
    {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      provider: "google",
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

export async function getDecryptedGmailIntegration(input: {
  workspaceId: string;
  userId: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("gmail_integrations")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "google")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const integration = data as GmailIntegration;

  return {
    ...integration,
    access_token: decryptSecret(integration.access_token_encrypted),
    refresh_token: integration.refresh_token_encrypted
      ? decryptSecret(integration.refresh_token_encrypted)
      : null,
  };
}

export async function getGmailIntegrationStatus(input: {
  workspaceId: string;
  userId: string;
}): Promise<GmailIntegrationStatus> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("gmail_integrations")
    .select("email,last_synced_at,sync_status,last_error")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "google")
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

export async function updateGmailSyncState(input: {
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
    .from("gmail_integrations")
    .update(payload)
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "google");

  if (error) throw error;
}

export async function getValidGmailAccessToken(input: {
  workspaceId: string;
  userId: string;
}) {
  const integration = await getDecryptedGmailIntegration(input);
  if (!integration) {
    throw new Error("Gmail is not connected for this workspace user.");
  }

  const expiresAtMs = integration.expires_at ? new Date(integration.expires_at).getTime() : null;
  const needsRefresh =
    expiresAtMs == null
      ? Boolean(integration.refresh_token)
      : expiresAtMs <= Date.now() + 30_000;

  if (!needsRefresh) {
    return {
      accessToken: integration.access_token,
      integration,
    };
  }

  if (!integration.refresh_token) {
    return {
      accessToken: integration.access_token,
      integration,
    };
  }

  const refreshed = await refreshGoogleAccessToken({
    refreshToken: integration.refresh_token,
  });

  await upsertGmailIntegrationTokens({
    workspaceId: input.workspaceId,
    userId: input.userId,
    email: integration.email,
    accessToken: refreshed.accessToken,
    refreshToken: integration.refresh_token,
    tokenType: refreshed.tokenType,
    expiresAt: refreshed.expiresAt,
    scopes: refreshed.scopes.length ? refreshed.scopes : integration.scopes,
  });

  return {
    accessToken: refreshed.accessToken,
    integration: {
      ...integration,
      access_token: refreshed.accessToken,
      expires_at: refreshed.expiresAt,
    },
  };
}
