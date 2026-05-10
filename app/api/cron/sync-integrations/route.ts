import { NextRequest, NextResponse } from "next/server";

import { assertAuthorizedCronRequest } from "@/lib/cron/auth";
import { syncWorkspaceGmailMessages } from "@/lib/gmail/sync";
import { logIntegrationEvent } from "@/lib/integrations/telemetry";
import { syncWorkspaceLinkedInSignals } from "@/lib/linkedin/sync";
import { syncWorkspaceOutlookMessages } from "@/lib/outlook/sync";
import { syncWorkspaceSlackSignals } from "@/lib/slack/sync";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type MailIntegrationSyncRow = {
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

  const gmailResult = {
    processed: 0,
    failed: 0,
    total: 0,
    details: [] as Array<Record<string, unknown>>,
  };

  const { data: gmailRows, error: gmailError } = await supabase
    .from("gmail_integrations")
    .select("workspace_id,user_id,is_primary,updated_at,workspaces:workspace_id(id,hydradb_tenant_id)")
    .eq("provider", "google");

  if (gmailError) {
    return NextResponse.json({ ok: false, error: gmailError.message }, { status: 500 });
  }

  const typedGmailRows = (gmailRows ?? []) as MailIntegrationSyncRow[];
  const gmailUniqueRows = new Map<string, MailIntegrationSyncRow>();
  for (const row of typedGmailRows) {
    const key = `${String(row.workspace_id)}:${String(row.user_id)}`;
    const existing = gmailUniqueRows.get(key);
    if (!existing) {
      gmailUniqueRows.set(key, row);
      continue;
    }

    const existingPrimary = Boolean(existing.is_primary);
    const rowPrimary = Boolean(row.is_primary);
    if (rowPrimary && !existingPrimary) {
      gmailUniqueRows.set(key, row);
      continue;
    }
    if (rowPrimary === existingPrimary) {
      const existingUpdated = new Date(String(existing.updated_at ?? 0)).getTime();
      const rowUpdated = new Date(String(row.updated_at ?? 0)).getTime();
      if (rowUpdated > existingUpdated) {
        gmailUniqueRows.set(key, row);
      }
    }
  }
  const gmailRowsToSync = Array.from(gmailUniqueRows.values());
  gmailResult.total = gmailRowsToSync.length;

  for (const row of gmailRowsToSync) {
    const workspace = row.workspaces;
    if (!workspace?.id || !workspace.hydradb_tenant_id) {
      gmailResult.failed += 1;
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
      gmailResult.processed += 1;
      gmailResult.details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        ...result,
      });
    } catch (syncError) {
      gmailResult.failed += 1;
      gmailResult.details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        error: syncError instanceof Error ? syncError.message : "sync failed",
      });
    }
  }

  const linkedInResult = {
    processed: 0,
    failed: 0,
    total: 0,
    details: [] as Array<Record<string, unknown>>,
  };

  const { data: linkedInRows, error: linkedInError } = await supabase
    .from("linkedin_integrations")
    .select("workspace_id,user_id,workspaces:workspace_id(id,hydradb_tenant_id)")
    .eq("provider", "linkedin");

  if (linkedInError) {
    return NextResponse.json({ ok: false, error: linkedInError.message }, { status: 500 });
  }

  const outlookResult = {
    processed: 0,
    failed: 0,
    total: 0,
    details: [] as Array<Record<string, unknown>>,
  };

  const { data: outlookRows, error: outlookError } = await supabase
    .from("outlook_integrations")
    .select("workspace_id,user_id,is_primary,updated_at,workspaces:workspace_id(id,hydradb_tenant_id)")
    .eq("provider", "outlook");

  if (outlookError) {
    return NextResponse.json({ ok: false, error: outlookError.message }, { status: 500 });
  }

  const typedOutlookRows = (outlookRows ?? []) as MailIntegrationSyncRow[];
  const outlookUniqueRows = new Map<string, MailIntegrationSyncRow>();
  for (const row of typedOutlookRows) {
    const key = `${String(row.workspace_id)}:${String(row.user_id)}`;
    const existing = outlookUniqueRows.get(key);
    if (!existing) {
      outlookUniqueRows.set(key, row);
      continue;
    }

    const existingPrimary = Boolean(existing.is_primary);
    const rowPrimary = Boolean(row.is_primary);
    if (rowPrimary && !existingPrimary) {
      outlookUniqueRows.set(key, row);
      continue;
    }
    if (rowPrimary === existingPrimary) {
      const existingUpdated = new Date(String(existing.updated_at ?? 0)).getTime();
      const rowUpdated = new Date(String(row.updated_at ?? 0)).getTime();
      if (rowUpdated > existingUpdated) {
        outlookUniqueRows.set(key, row);
      }
    }
  }
  const outlookRowsToSync = Array.from(outlookUniqueRows.values());
  outlookResult.total = outlookRowsToSync.length;

  for (const row of outlookRowsToSync) {
    const workspace = row.workspaces;
    if (!workspace?.id || !workspace.hydradb_tenant_id) {
      outlookResult.failed += 1;
      continue;
    }

    try {
      const result = await syncWorkspaceOutlookMessages({
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
      outlookResult.processed += 1;
      outlookResult.details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        ...result,
      });
    } catch (syncError) {
      outlookResult.failed += 1;
      outlookResult.details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        error: syncError instanceof Error ? syncError.message : "sync failed",
      });
    }
  }

  const slackResult = {
    processed: 0,
    failed: 0,
    total: 0,
    details: [] as Array<Record<string, unknown>>,
  };

  const { data: slackRows, error: slackError } = await supabase
    .from("slack_integrations")
    .select("workspace_id,user_id,workspaces:workspace_id(id,hydradb_tenant_id)")
    .eq("provider", "slack");

  if (slackError) {
    return NextResponse.json({ ok: false, error: slackError.message }, { status: 500 });
  }

  slackResult.total = (slackRows ?? []).length;

  for (const row of slackRows ?? []) {
    const workspace = row.workspaces as { id: string; hydradb_tenant_id: string } | null;
    if (!workspace?.id || !workspace.hydradb_tenant_id) {
      slackResult.failed += 1;
      continue;
    }

    try {
      const result = await syncWorkspaceSlackSignals({
        userId: row.user_id as string,
        workspace: {
          id: workspace.id,
          owner_id: "",
          name: "",
          slug: null,
          description: null,
          hydradb_tenant_id: workspace.hydradb_tenant_id,
        },
        maxChannels: 8,
        maxMessagesPerChannel: 10,
      });
      slackResult.processed += 1;
      slackResult.details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        ...result,
      });
    } catch (syncError) {
      slackResult.failed += 1;
      slackResult.details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        error: syncError instanceof Error ? syncError.message : "sync failed",
      });
    }
  }

  linkedInResult.total = (linkedInRows ?? []).length;

  for (const row of linkedInRows ?? []) {
    const workspace = row.workspaces as { id: string; hydradb_tenant_id: string } | null;
    if (!workspace?.id || !workspace.hydradb_tenant_id) {
      linkedInResult.failed += 1;
      continue;
    }

    try {
      const result = await syncWorkspaceLinkedInSignals({
        userId: row.user_id as string,
        workspace: {
          id: workspace.id,
          owner_id: "",
          name: "",
          slug: null,
          description: null,
          hydradb_tenant_id: workspace.hydradb_tenant_id,
        },
        maxContacts: 25,
      });
      linkedInResult.processed += 1;
      linkedInResult.details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        ...result,
      });
    } catch (syncError) {
      linkedInResult.failed += 1;
      linkedInResult.details.push({
        workspace_id: workspace.id,
        user_id: row.user_id,
        error: syncError instanceof Error ? syncError.message : "sync failed",
      });
    }
  }

  logIntegrationEvent({
    source: "cron",
    event: "integrations_cron_completed",
    detail: {
      gmail: {
        processed: gmailResult.processed,
        failed: gmailResult.failed,
        total: gmailResult.total,
      },
      linkedin: {
        processed: linkedInResult.processed,
        failed: linkedInResult.failed,
        total: linkedInResult.total,
      },
      outlook: {
        processed: outlookResult.processed,
        failed: outlookResult.failed,
        total: outlookResult.total,
      },
      slack: {
        processed: slackResult.processed,
        failed: slackResult.failed,
        total: slackResult.total,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    gmail: gmailResult,
    linkedin: linkedInResult,
    outlook: outlookResult,
    slack: slackResult,
  });
}
