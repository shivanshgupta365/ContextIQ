import { decryptSecret, encryptSecret } from "@/lib/integrations/token-crypto";
import { refreshGoogleAccessToken } from "@/lib/gmail/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { GmailIntegration, GmailIntegrationStatus } from "@/types";

const MAX_GMAIL_ACCOUNTS = 5;

type GmailAccountRow = GmailIntegration;

function getIntegrationSlot(row: Partial<GmailIntegration>) {
  return Number.isInteger(row.integration_slot) ? Number(row.integration_slot) : 1;
}

function isPrimaryAccount(row: Partial<GmailIntegration>) {
  return Boolean(row.is_primary);
}

async function listGmailIntegrations(input: { workspaceId: string; userId: string }) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("gmail_integrations")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "google");

  if (error) throw error;
  const rows = ((data ?? []) as GmailAccountRow[]).sort((a, b) => {
    if (isPrimaryAccount(a) !== isPrimaryAccount(b)) {
      return isPrimaryAccount(a) ? -1 : 1;
    }
    if (getIntegrationSlot(a) !== getIntegrationSlot(b)) {
      return getIntegrationSlot(a) - getIntegrationSlot(b);
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  return rows;
}

async function resolveGmailIntegrationSlot(input: {
  workspaceId: string;
  userId: string;
  email: string | null;
}) {
  const rows = await listGmailIntegrations(input);
  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;

  if (normalizedEmail) {
    const existing = rows.find((row) => (row.email ?? "").toLowerCase() === normalizedEmail);
    if (existing) {
      return getIntegrationSlot(existing);
    }
  }

  const usedSlots = new Set(rows.map((row) => getIntegrationSlot(row)));
  for (let slot = 1; slot <= MAX_GMAIL_ACCOUNTS; slot += 1) {
    if (!usedSlots.has(slot)) return slot;
  }

  throw new Error(`Gmail account limit reached. You can connect up to ${MAX_GMAIL_ACCOUNTS} accounts.`);
}

export async function upsertGmailIntegrationTokens(input: {
  workspaceId: string;
  userId: string;
  email: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  tokenType?: string | null;
  scopes?: string[];
  integrationSlot?: number;
  isPrimary?: boolean;
}) {
  const supabase = getSupabaseAdminClient();
  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
  const integrationSlot =
    input.integrationSlot && input.integrationSlot >= 1 && input.integrationSlot <= MAX_GMAIL_ACCOUNTS
      ? input.integrationSlot
      : await resolveGmailIntegrationSlot({
          workspaceId: input.workspaceId,
          userId: input.userId,
          email: normalizedEmail,
        });
  const isPrimary = input.isPrimary ?? true;

  const { error } = await supabase.from("gmail_integrations").upsert(
    {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      provider: "google",
      integration_slot: integrationSlot,
      is_primary: isPrimary,
      email: normalizedEmail,
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
    { onConflict: "workspace_id,user_id,provider,integration_slot" },
  );

  if (error) throw error;

  if (isPrimary) {
    const { error: demoteError } = await supabase
      .from("gmail_integrations")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .eq("provider", "google")
      .neq("integration_slot", integrationSlot);

    if (demoteError) throw demoteError;
  }
}

export async function getDecryptedGmailIntegration(input: {
  workspaceId: string;
  userId: string;
  integrationSlot?: number;
}) {
  const rows = await listGmailIntegrations({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });

  const integration =
    (typeof input.integrationSlot === "number"
      ? rows.find((row) => getIntegrationSlot(row) === input.integrationSlot)
      : rows.find((row) => isPrimaryAccount(row)) ?? rows[0]) ?? null;

  if (!integration) return null;

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
  const rows = await listGmailIntegrations(input);

  if (!rows.length) {
    return {
      connected: false,
      email: null,
      connected_count: 0,
      accounts: [],
      last_synced_at: null,
      sync_status: "idle",
      last_error: null,
    };
  }

  const primary = rows.find((row) => isPrimaryAccount(row)) ?? rows[0];
  const aggregatedLastSyncedAt = rows
    .map((row) => row.last_synced_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  const firstError = rows.find((row) => row.sync_status === "error" && row.last_error)?.last_error ?? null;

  return {
    connected: true,
    email: primary.email ?? null,
    connected_count: rows.length,
    accounts: rows.map((row) => ({
      id: row.id,
      slot: getIntegrationSlot(row),
      email: row.email ?? null,
      is_primary: isPrimaryAccount(row),
      last_synced_at: row.last_synced_at ?? null,
      sync_status: row.sync_status,
      last_error: row.last_error ?? null,
    })),
    last_synced_at: aggregatedLastSyncedAt,
    sync_status: firstError ? "error" : (primary.sync_status ?? "idle"),
    last_error: firstError,
  };
}

export async function updateGmailSyncState(input: {
  workspaceId: string;
  userId: string;
  syncStatus: "idle" | "syncing" | "ok" | "error";
  lastError?: string | null;
  lastSyncedAt?: string | null;
  integrationSlot?: number;
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

  let query = supabase
    .from("gmail_integrations")
    .update(payload)
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "google");

  if (typeof input.integrationSlot === "number") {
    query = query.eq("integration_slot", input.integrationSlot);
  }

  const { error } = await query;
  if (error) throw error;
}

export async function getValidGmailAccessToken(input: {
  workspaceId: string;
  userId: string;
  integrationSlot?: number;
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
    integrationSlot: getIntegrationSlot(integration),
    isPrimary: isPrimaryAccount(integration),
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
