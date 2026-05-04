import { createHash } from "crypto";

import { INTEGRATION_DEFAULT_CAPABILITIES, providerDisplayName } from "@/lib/integrations/catalog";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  IntegrationConnectionStatus,
  IntegrationProvider,
} from "@/types";

function buildDedupeKey(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export async function upsertIntegrationConnectionStatus(input: {
  workspaceId: string;
  userId: string;
  provider: IntegrationProvider;
  status: IntegrationConnectionStatus;
  permissionScope?: string | null;
  lastError?: string | null;
  syncedAt?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  const dedupeKey = buildDedupeKey([
    input.workspaceId,
    input.userId,
    input.provider,
    "integration_connection",
  ]);

  const { error } = await supabase.from("integration_connections").upsert(
    {
      workspace_id: input.workspaceId,
      owner_user_id: input.userId,
      provider: input.provider,
      display_name: providerDisplayName(input.provider),
      status: input.status,
      capabilities: INTEGRATION_DEFAULT_CAPABILITIES[input.provider],
      permission_scope: input.permissionScope ?? null,
      source_provider: input.provider,
      source_object_type: "integration_connection",
      source_object_id: `${input.provider}:${input.userId}`,
      dedupe_key: dedupeKey,
      normalized_payload: {
        last_error: input.lastError ?? null,
      },
      embedding_status: "not_indexed",
      synced_at: input.syncedAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,provider,owner_user_id" },
  );

  if (error) throw error;
}
