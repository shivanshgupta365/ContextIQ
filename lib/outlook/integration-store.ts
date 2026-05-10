import { decryptSecret, encryptSecret } from "@/lib/integrations/token-crypto";
import { refreshMicrosoftAccessToken } from "@/lib/outlook/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OutlookIntegration, OutlookIntegrationStatus } from "@/types";

const MAX_OUTLOOK_ACCOUNTS = 5;

type OutlookAccountRow = OutlookIntegration;

function getIntegrationSlot(row: Partial<OutlookIntegration>) {
  return Number.isInteger(row.integration_slot) ? Number(row.integration_slot) : 1;
}

function isPrimaryAccount(row: Partial<OutlookIntegration>) {
  return Boolean(row.is_primary);
}

async function listOutlookIntegrations(input: { workspaceId: string; userId: string }) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("outlook_integrations")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "outlook");

  if (error) throw error;
  const rows = ((data ?? []) as OutlookAccountRow[]).sort((a, b) => {
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

async function resolveOutlookIntegrationSlot(input: {
  workspaceId: string;
  userId: string;
  email: string | null;
}) {
  const rows = await listOutlookIntegrations(input);
  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;

  if (normalizedEmail) {
    const existing = rows.find((row) => (row.email ?? "").toLowerCase() === normalizedEmail);
    if (existing) {
      return getIntegrationSlot(existing);
    }
  }

  const usedSlots = new Set(rows.map((row) => getIntegrationSlot(row)));
  for (let slot = 1; slot <= MAX_OUTLOOK_ACCOUNTS; slot += 1) {
    if (!usedSlots.has(slot)) return slot;
  }

  throw new Error(`Outlook account limit reached. You can connect up to ${MAX_OUTLOOK_ACCOUNTS} accounts.`);
}

export async function upsertOutlookIntegrationTokens(input: {
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
    input.integrationSlot && input.integrationSlot >= 1 && input.integrationSlot <= MAX_OUTLOOK_ACCOUNTS
      ? input.integrationSlot
      : await resolveOutlookIntegrationSlot({
          workspaceId: input.workspaceId,
          userId: input.userId,
          email: normalizedEmail,
        });
  const isPrimary = input.isPrimary ?? true;

  const { error } = await supabase.from("outlook_integrations").upsert(
    {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      provider: "outlook",
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
      .from("outlook_integrations")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .eq("provider", "outlook")
      .neq("integration_slot", integrationSlot);

    if (demoteError) throw demoteError;
  }
}

export async function getDecryptedOutlookIntegration(input: {
  workspaceId: string;
  userId: string;
  integrationSlot?: number;
}) {
  const rows = await listOutlookIntegrations({
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

export async function getOutlookIntegrationStatus(input: {
  workspaceId: string;
  userId: string;
}): Promise<OutlookIntegrationStatus> {
  const rows = await listOutlookIntegrations(input);

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

export async function updateOutlookSyncState(input: {
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
    .from("outlook_integrations")
    .update(payload)
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "outlook");

  if (typeof input.integrationSlot === "number") {
    query = query.eq("integration_slot", input.integrationSlot);
  }

  const { error } = await query;
  if (error) throw error;
}

export async function getValidOutlookAccessToken(input: {
  workspaceId: string;
  userId: string;
  integrationSlot?: number;
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
    integrationSlot: getIntegrationSlot(integration),
    isPrimary: isPrimaryAccount(integration),
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
