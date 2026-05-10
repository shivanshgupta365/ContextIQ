import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getOAuthCallbackContext } from "@/lib/auth/oauth-callback-context";
import { upsertIntegrationConnectionStatus } from "@/lib/integrations/connections";
import {
  exchangeMicrosoftCodeForToken,
  fetchMicrosoftProfile,
} from "@/lib/outlook/client";
import { upsertOutlookIntegrationTokens } from "@/lib/outlook/integration-store";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();

  const expectedState = cookieStore.get("outlook_oauth_state")?.value;
  const next = cookieStore.get("outlook_oauth_next")?.value ?? "/overview";
  const safeNext = next.startsWith("/") ? next : "/overview";

  cookieStore.delete("outlook_oauth_state");
  cookieStore.delete("outlook_oauth_next");

  if (error) {
    return NextResponse.redirect(
      new URL(
        `${safeNext}?integration=outlook&status=error&message=${encodeURIComponent(error)}`,
        request.url,
      ),
    );
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      new URL(`${safeNext}?integration=outlook&status=error&message=invalid_state`, request.url),
    );
  }

  try {
    const [{ workspace, userId, profile, userEmail }, token] = await Promise.all([
      getOAuthCallbackContext(),
      exchangeMicrosoftCodeForToken({ code }),
    ]);

    const microsoftProfile = await fetchMicrosoftProfile({
      accessToken: token.accessToken,
    }).catch(() => null);

    await upsertOutlookIntegrationTokens({
      workspaceId: workspace.id,
      userId,
      email: microsoftProfile?.email ?? profile.email ?? userEmail ?? null,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
    });

    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "outlook",
      status: "connected",
      permissionScope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
      lastError: null,
    });

    return NextResponse.redirect(
      new URL(
        `${safeNext}?integration=outlook&status=connected${
          microsoftProfile ? "" : "&message=connected_with_profile_lookup_warning"
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
        provider: "outlook",
        status: "error",
        permissionScope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
        lastError:
          callbackError instanceof Error ? callbackError.message : "Outlook connect failed",
      });
    } catch {
      // Ignore status update failure on callback error path.
    }

    const message =
      callbackError instanceof Error ? callbackError.message : "Outlook connect failed";

    return NextResponse.redirect(
      new URL(
        `${safeNext}?integration=outlook&status=error&message=${encodeURIComponent(message)}`,
        request.url,
      ),
    );
  }
}
