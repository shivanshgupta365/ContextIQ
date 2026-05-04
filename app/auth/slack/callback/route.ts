import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getOAuthCallbackContext } from "@/lib/auth/oauth-callback-context";
import { upsertIntegrationConnectionStatus } from "@/lib/integrations/connections";
import { exchangeSlackCodeForToken, fetchSlackAuthIdentity } from "@/lib/slack/client";
import { upsertSlackIntegrationTokens } from "@/lib/slack/integration-store";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();

  const expectedState = cookieStore.get("slack_oauth_state")?.value;
  const next = cookieStore.get("slack_oauth_next")?.value ?? "/overview";
  const safeNext = next.startsWith("/") ? next : "/overview";

  cookieStore.delete("slack_oauth_state");
  cookieStore.delete("slack_oauth_next");

  if (error) {
    return NextResponse.redirect(
      new URL(`/overview?integration=slack&status=error&message=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      new URL("/overview?integration=slack&status=error&message=slack_state_mismatch", request.url),
    );
  }

  try {
    const [{ workspace, userId, profile, userEmail }, token] = await Promise.all([
      getOAuthCallbackContext(),
      exchangeSlackCodeForToken({ code }),
    ]);

    if (!token.userAccessToken && !token.botAccessToken) {
      throw new Error("slack_user_token_missing");
    }

    const identity = await fetchSlackAuthIdentity({
      accessToken: token.userAccessToken ?? token.botAccessToken ?? "",
    }).catch(() => null);

    await upsertSlackIntegrationTokens({
      workspaceId: workspace.id,
      userId,
      email: profile.email ?? userEmail,
      teamId: token.teamId ?? identity?.teamId ?? null,
      teamName: token.teamName ?? identity?.teamName ?? null,
      enterpriseId: token.enterpriseId,
      slackUserId: token.slackUserId ?? identity?.userId ?? null,
      userAccessToken: token.userAccessToken,
      botAccessToken: token.botAccessToken,
      userTokenType: token.userTokenType,
      botTokenType: token.botTokenType,
      userScopes: token.userScopes,
      botScopes: token.botScopes,
      needsReconnect: !token.userAccessToken,
    });
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "slack",
      status: "connected",
      permissionScope:
        "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
    });

    const warning = identity ? null : "connected_with_identity_lookup_warning";
    const needsReconnect = !token.userAccessToken ? "reconnect_recommended" : null;
    const message = [warning, needsReconnect].filter(Boolean).join(",");
    return NextResponse.redirect(
      new URL(
        `${safeNext}?integration=slack&status=connected${message ? `&message=${encodeURIComponent(message)}` : ""}`,
        request.url,
      ),
    );
  } catch (callbackError) {
    try {
      const { workspace, userId } = await getOAuthCallbackContext();
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider: "slack",
        status: "error",
        permissionScope:
          "channels:history groups:history im:history mpim:history users:read channels:read groups:read im:read mpim:read",
        lastError: callbackError instanceof Error ? callbackError.message : "Slack connect failed",
      });
    } catch {
      // Ignore status update failures on callback error path.
    }
    const message = callbackError instanceof Error ? callbackError.message : "Slack connect failed";
    return NextResponse.redirect(
      new URL(`/overview?integration=slack&status=error&message=${encodeURIComponent(message)}`, request.url),
    );
  }
}
