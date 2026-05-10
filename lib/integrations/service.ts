import { INTEGRATION_DEFAULT_CAPABILITIES, INTEGRATION_PROVIDERS } from "@/lib/integrations/catalog";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  IntegrationCapability,
  IntegrationProvider,
  ProviderReadinessStatus,
} from "@/types";

type ConnectionRow = {
  provider: IntegrationProvider;
  status: ProviderReadinessStatus["status"];
  capabilities: IntegrationCapability[] | null;
  synced_at: string | null;
  normalized_payload?: Record<string, unknown> | null;
};

export async function getWorkspaceProviderReadiness(params: {
  workspaceId: string;
  userId: string;
}) {
  const supabase = await getSupabaseServerClient();
  const [
    connectionsResult,
    gmailResult,
    linkedinResult,
    outlookResult,
    slackResult,
  ] =
    await Promise.all([
      supabase
        .from("integration_connections")
        .select("provider,status,capabilities,synced_at,normalized_payload")
        .eq("workspace_id", params.workspaceId)
        .eq("owner_user_id", params.userId),
      supabase
        .from("gmail_integrations")
        .select("email,last_synced_at,sync_status,last_error,is_primary,integration_slot,updated_at")
        .eq("workspace_id", params.workspaceId)
        .eq("user_id", params.userId)
        .eq("provider", "google"),
      supabase
        .from("linkedin_integrations")
        .select("email,linkedin_sub,last_synced_at,sync_status,last_error")
        .eq("workspace_id", params.workspaceId)
        .eq("user_id", params.userId)
        .eq("provider", "linkedin")
        .maybeSingle(),
      supabase
        .from("outlook_integrations")
        .select("email,last_synced_at,sync_status,last_error,is_primary,integration_slot,updated_at")
        .eq("workspace_id", params.workspaceId)
        .eq("user_id", params.userId)
        .eq("provider", "outlook"),
      supabase
        .from("slack_integrations")
        .select("email,team_name,team_id,slack_user_id,needs_reconnect,last_synced_at,sync_status,last_error")
        .eq("workspace_id", params.workspaceId)
        .eq("user_id", params.userId)
        .eq("provider", "slack")
        .maybeSingle(),
    ]);

  const { data, error: connectionsError } = connectionsResult;
  const { data: gmail, error: gmailError } = gmailResult;
  const { data: linkedin, error: linkedinError } = linkedinResult;
  const { data: outlook, error: outlookError } = outlookResult;
  const { data: slack, error: slackError } = slackResult;

  const byProvider = new Map<IntegrationProvider, ConnectionRow>();
  for (const row of (data ?? []) as ConnectionRow[]) {
    byProvider.set(row.provider, row);
  }

  const oauthReadiness = new Map<
    "gmail" | "linkedin" | "outlook" | "slack",
    Omit<ProviderReadinessStatus, "provider" | "capabilities">
  >();

  if (gmailError) {
    oauthReadiness.set("gmail", {
      status: "error",
      last_synced_at: null,
      message: `Gmail status unavailable: ${gmailError.message}`,
    });
  }
  const gmailRows = ((gmail ?? []) as Array<Record<string, unknown>>).sort((a, b) => {
    const aPrimary = Boolean(a.is_primary);
    const bPrimary = Boolean(b.is_primary);
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    return new Date(String(b.updated_at ?? 0)).getTime() - new Date(String(a.updated_at ?? 0)).getTime();
  });
  if (gmailRows.length > 0) {
    const primary = gmailRows[0];
    const syncStatus = String(primary.sync_status ?? "idle");
    const accountCount = gmailRows.length;
    const status = syncStatus === "error" ? "error" : "connected";
    const statusLabel = accountCount > 1 ? ` (${accountCount} accounts)` : "";
    oauthReadiness.set("gmail", {
      status,
      last_synced_at:
        (gmailRows
          .map((row) => row.last_synced_at as string | null)
          .filter((value): value is string => Boolean(value))
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] as string | undefined) ??
        null,
      message:
        status === "error"
          ? `Gmail error: ${String(primary.last_error ?? "sync failed")}`
          : `Connected${primary.email ? ` as ${String(primary.email)}` : ""}${statusLabel}`,
    });
  }

  if (linkedinError) {
    oauthReadiness.set("linkedin", {
      status: "error",
      last_synced_at: null,
      message: `LinkedIn status unavailable: ${linkedinError.message}`,
    });
  }
  if (linkedin) {
    const syncStatus = String(linkedin.sync_status ?? "idle");
    const status = syncStatus === "error" ? "error" : "connected";
    oauthReadiness.set("linkedin", {
      status,
      last_synced_at: (linkedin.last_synced_at as string | null) ?? null,
      message:
        status === "error"
          ? `LinkedIn error: ${String(linkedin.last_error ?? "sync failed")}`
          : `Connected${linkedin.email ? ` as ${linkedin.email}` : ""}`,
    });
  }

  if (outlookError) {
    oauthReadiness.set("outlook", {
      status: "error",
      last_synced_at: null,
      message: `Outlook status unavailable: ${outlookError.message}`,
    });
  }
  const outlookRows = ((outlook ?? []) as Array<Record<string, unknown>>).sort((a, b) => {
    const aPrimary = Boolean(a.is_primary);
    const bPrimary = Boolean(b.is_primary);
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    return new Date(String(b.updated_at ?? 0)).getTime() - new Date(String(a.updated_at ?? 0)).getTime();
  });
  if (outlookRows.length > 0) {
    const primary = outlookRows[0];
    const syncStatus = String(primary.sync_status ?? "idle");
    const accountCount = outlookRows.length;
    const status = syncStatus === "error" ? "error" : "connected";
    const statusLabel = accountCount > 1 ? ` (${accountCount} accounts)` : "";
    oauthReadiness.set("outlook", {
      status,
      last_synced_at:
        (outlookRows
          .map((row) => row.last_synced_at as string | null)
          .filter((value): value is string => Boolean(value))
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] as string | undefined) ??
        null,
      message:
        status === "error"
          ? `Outlook error: ${String(primary.last_error ?? "sync failed")}`
          : `Connected${primary.email ? ` as ${String(primary.email)}` : ""}${statusLabel}`,
    });
  }

  if (slackError) {
    oauthReadiness.set("slack", {
      status: "error",
      last_synced_at: null,
      message: `Slack status unavailable: ${slackError.message}`,
    });
  }
  if (slack) {
    const syncStatus = String(slack.sync_status ?? "idle");
    const needsReconnect = Boolean(slack.needs_reconnect);
    const status =
      syncStatus === "error" || needsReconnect ? "error" : "connected";
    const teamLabel =
      (slack.team_name as string | null) ??
      (slack.team_id as string | null) ??
      null;

    oauthReadiness.set("slack", {
      status,
      last_synced_at: (slack.last_synced_at as string | null) ?? null,
      message:
        status === "error"
          ? needsReconnect
            ? "Slack needs reconnect with a user token for per-user retrieval."
            : `Slack error: ${String(slack.last_error ?? "sync failed")}`
          : `Connected${teamLabel ? ` to ${teamLabel}` : ""}${
              needsReconnect ? " (reconnect recommended for user token)" : ""
            }`,
    });
  }

  return INTEGRATION_PROVIDERS.map((provider): ProviderReadinessStatus => {
    if (
      provider === "gmail" ||
      provider === "linkedin" ||
      provider === "outlook" ||
      provider === "slack"
    ) {
      const oauthStatus = oauthReadiness.get(provider);
      if (oauthStatus) {
        const foundConnection = byProvider.get(provider);
        return {
          provider,
          status: oauthStatus.status,
          capabilities:
            foundConnection?.capabilities && foundConnection.capabilities.length > 0
              ? foundConnection.capabilities
              : INTEGRATION_DEFAULT_CAPABILITIES[provider],
          last_synced_at: oauthStatus.last_synced_at,
          message: oauthStatus.message,
        };
      }
    }

    const found = byProvider.get(provider);
    if (!found && connectionsError) {
      return {
        provider,
        status: "error",
        capabilities: INTEGRATION_DEFAULT_CAPABILITIES[provider],
        last_synced_at: null,
        message: `Status unavailable: ${connectionsError.message}`,
      };
    }
    if (!found) {
      return {
        provider,
        status: "pending_approval",
        capabilities: INTEGRATION_DEFAULT_CAPABILITIES[provider],
        last_synced_at: null,
        message: "Not connected. Pending provider approval or setup.",
      };
    }

    return {
      provider,
      status: found.status,
      capabilities:
        found.capabilities && found.capabilities.length > 0
          ? found.capabilities
          : INTEGRATION_DEFAULT_CAPABILITIES[provider],
      last_synced_at: found.synced_at,
      message:
        found.status === "connected"
          ? "Connected"
          : found.status === "error"
            ? "Connection error"
            : found.status === "disconnected"
              ? "Disconnected"
              : "Pending provider approval",
    };
  });
}
