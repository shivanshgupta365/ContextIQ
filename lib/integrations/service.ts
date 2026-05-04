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
  const [{ data }, { data: gmail }, { data: linkedin }, { data: outlook }, { data: slack }] =
    await Promise.all([
      supabase
        .from("integration_connections")
        .select("provider,status,capabilities,synced_at,normalized_payload")
        .eq("workspace_id", params.workspaceId)
        .eq("owner_user_id", params.userId),
      supabase
        .from("gmail_integrations")
        .select("email,last_synced_at,sync_status,last_error")
        .eq("workspace_id", params.workspaceId)
        .eq("user_id", params.userId)
        .eq("provider", "google")
        .maybeSingle(),
      supabase
        .from("linkedin_integrations")
        .select("email,linkedin_sub,last_synced_at,sync_status,last_error")
        .eq("workspace_id", params.workspaceId)
        .eq("user_id", params.userId)
        .eq("provider", "linkedin")
        .maybeSingle(),
      supabase
        .from("outlook_integrations")
        .select("email,last_synced_at,sync_status,last_error")
        .eq("workspace_id", params.workspaceId)
        .eq("user_id", params.userId)
        .eq("provider", "outlook")
        .maybeSingle(),
      supabase
        .from("slack_integrations")
        .select("email,team_name,team_id,slack_user_id,needs_reconnect,last_synced_at,sync_status,last_error")
        .eq("workspace_id", params.workspaceId)
        .eq("user_id", params.userId)
        .eq("provider", "slack")
        .maybeSingle(),
    ]);

  const byProvider = new Map<IntegrationProvider, ConnectionRow>();
  for (const row of (data ?? []) as ConnectionRow[]) {
    byProvider.set(row.provider, row);
  }

  const oauthReadiness = new Map<
    "gmail" | "linkedin" | "outlook" | "slack",
    Omit<ProviderReadinessStatus, "provider" | "capabilities">
  >();

  if (gmail) {
    const syncStatus = String(gmail.sync_status ?? "idle");
    const status = syncStatus === "error" ? "error" : "connected";
    oauthReadiness.set("gmail", {
      status,
      last_synced_at: (gmail.last_synced_at as string | null) ?? null,
      message:
        status === "error"
          ? `Gmail error: ${String(gmail.last_error ?? "sync failed")}`
          : `Connected${gmail.email ? ` as ${gmail.email}` : ""}`,
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

  if (outlook) {
    const syncStatus = String(outlook.sync_status ?? "idle");
    const status = syncStatus === "error" ? "error" : "connected";
    oauthReadiness.set("outlook", {
      status,
      last_synced_at: (outlook.last_synced_at as string | null) ?? null,
      message:
        status === "error"
          ? `Outlook error: ${String(outlook.last_error ?? "sync failed")}`
          : `Connected${outlook.email ? ` as ${outlook.email}` : ""}`,
    });
  }

  if (slack) {
    const syncStatus = String(slack.sync_status ?? "idle");
    const needsReconnect = Boolean(slack.needs_reconnect);
    const status = syncStatus === "error" ? "error" : "connected";
    const teamLabel =
      (slack.team_name as string | null) ??
      (slack.team_id as string | null) ??
      null;

    oauthReadiness.set("slack", {
      status,
      last_synced_at: (slack.last_synced_at as string | null) ?? null,
      message:
        status === "error"
          ? `Slack error: ${String(slack.last_error ?? "sync failed")}`
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
