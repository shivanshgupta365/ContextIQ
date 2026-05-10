import { NextRequest, NextResponse } from "next/server";

import { assertAuthorizedCronRequest } from "@/lib/cron/auth";
import { syncWorkspaceGmailMessages } from "@/lib/gmail/sync";
import { logIntegrationEvent } from "@/lib/integrations/telemetry";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type GmailIntegrationSyncRow = {
  workspace_id: string;
  user_id: string;
  is_primary: boolean | null;
  updated_at: string | null;
  workspaces: { id: string; hydradb_tenant_id: string } | null;
};

export async function GET(request: NextRequest) {
  try {
    assertAuthorizedCronRequest(request);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("gmail_integrations")
    .select("workspace_id,user_id,is_primary,updated_at,workspaces:workspace_id(id,hydradb_tenant_id)")
    .eq("provider", "google");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let processed = 0;
  let failed = 0;
  const details: Array<Record<string, unknown>> = [];

  const typedRows = (data ?? []) as GmailIntegrationSyncRow[];
  const uniqueRows = new Map<string, GmailIntegrationSyncRow>();
  for (const row of typedRows) {
    const key = `${String(row.workspace_id)}:${String(row.user_id)}`;
    const existing = uniqueRows.get(key);
    if (!existing) {
      uniqueRows.set(key, row);
      continue;
    }

    const existingPrimary = Boolean(existing.is_primary);
    const rowPrimary = Boolean(row.is_primary);
    if (rowPrimary && !existingPrimary) {
      uniqueRows.set(key, row);
      continue;
    }
    if (rowPrimary === existingPrimary) {
      const existingUpdated = new Date(String(existing.updated_at ?? 0)).getTime();
      const rowUpdated = new Date(String(row.updated_at ?? 0)).getTime();
      if (rowUpdated > existingUpdated) {
        uniqueRows.set(key, row);
      }
    }
  }

  const rowsToSync = Array.from(uniqueRows.values());

  for (const row of rowsToSync) {
    const workspace = row.workspaces;
    if (!workspace?.id || !workspace.hydradb_tenant_id) {
      failed += 1;
      continue;
    }

    try {
      const result = await syncWorkspaceGmailMessages({
        userId: row.user_id as string,
        workspace: {
          id: workspace.id,
          owner_id: "",
          name: "",
          slug: null,
          description: null,
          hydradb_tenant_id: workspace.hydradb_tenant_id,
        },
        maxResults: 25,
      });
      processed += 1;
      details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        ...result,
      });
    } catch (syncError) {
      failed += 1;
      details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        error: syncError instanceof Error ? syncError.message : "sync failed",
      });
    }
  }

  logIntegrationEvent({
    source: "cron",
    event: "gmail_cron_completed",
    detail: {
      processed,
      failed,
      total: rowsToSync.length,
    },
  });

  return NextResponse.json({
    ok: true,
    processed,
    failed,
    total: rowsToSync.length,
    details,
  });
}
