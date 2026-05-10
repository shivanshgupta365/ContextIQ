import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getOAuthCallbackContext } from "@/lib/auth/oauth-callback-context";
import {
  exchangeGoogleCodeForToken,
  fetchGoogleProfile,
} from "@/lib/gmail/client";
import { upsertGmailIntegrationTokens } from "@/lib/gmail/integration-store";
import { upsertIntegrationConnectionStatus } from "@/lib/integrations/connections";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("gmail_oauth_state")?.value;
  const next = cookieStore.get("gmail_oauth_next")?.value ?? "/overview";
  const safeNext = next.startsWith("/") ? next : "/overview";

  cookieStore.delete("gmail_oauth_state");
  cookieStore.delete("gmail_oauth_next");

  if (error) {
    return NextResponse.redirect(
      new URL(
        `${safeNext}?integration=gmail&status=error&message=${encodeURIComponent(error)}`,
        request.url,
      ),
    );
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      new URL(`${safeNext}?integration=gmail&status=error&message=invalid_state`, request.url),
    );
  }

  try {
    const [{ workspace, userId, profile, userEmail }, token] = await Promise.all([
      getOAuthCallbackContext(),
      exchangeGoogleCodeForToken({ code }),
    ]);

    const googleProfile = await fetchGoogleProfile({
      accessToken: token.accessToken,
    }).catch(() => null);

    await upsertGmailIntegrationTokens({
      workspaceId: workspace.id,
      userId,
      email: googleProfile?.email ?? profile.email ?? userEmail ?? null,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
    });

    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "gmail",
      status: "connected",
      permissionScope: "gmail.readonly gmail.send gmail.compose",
      lastError: null,
    });

    return NextResponse.redirect(
      new URL(
        `${safeNext}?integration=gmail&status=connected${
          googleProfile ? "" : "&message=connected_with_profile_lookup_warning"
        }`,
        request.url,
      ),
    );
  } catch (callbackError) {
    try {
      const { workspace, userId } = await getOAuthCallbackContext();
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider: "gmail",
        status: "error",
        permissionScope: "gmail.readonly gmail.send gmail.compose",
        lastError:
          callbackError instanceof Error ? callbackError.message : "Gmail connect failed",
      });
    } catch {
      // Ignore status write failure on callback error path.
    }

    const message =
      callbackError instanceof Error ? callbackError.message : "Gmail connect failed";

    return NextResponse.redirect(
      new URL(
        `${safeNext}?integration=gmail&status=error&message=${encodeURIComponent(message)}`,
        request.url,
      ),
    );
  }
}
