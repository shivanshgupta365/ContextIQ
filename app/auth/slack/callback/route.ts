import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getWorkspaceContext } from "@/lib/data/contextiq";
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
    const [{ workspace, userId, profile }, token] = await Promise.all([
      getWorkspaceContext(),
      exchangeSlackCodeForToken({ code }),
    ]);

    if (!token.userAccessToken && !token.botAccessToken) {
      return NextResponse.redirect(
        new URL("/overview?integration=slack&status=error&message=slack_user_token_missing", request.url),
      );
    }

    const identity = await fetchSlackAuthIdentity({
      accessToken: token.userAccessToken ?? token.botAccessToken ?? "",
    });

    await upsertSlackIntegrationTokens({
      workspaceId: workspace.id,
      userId,
      email: profile.email,
      teamId: token.teamId ?? identity.teamId,
      teamName: token.teamName ?? identity.teamName,
      enterpriseId: token.enterpriseId,
      slackUserId: token.slackUserId ?? identity.userId,
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

    return NextResponse.redirect(new URL(`${safeNext}?integration=slack&status=connected`, request.url));
  } catch (callbackError) {
    try {
      const { workspace, userId } = await getWorkspaceContext();
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
