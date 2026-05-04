import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getWorkspaceContext } from "@/lib/data/contextiq";
import { upsertIntegrationConnectionStatus } from "@/lib/integrations/connections";
import {
  exchangeLinkedInCodeForToken,
  fetchLinkedInUserInfo,
} from "@/lib/linkedin/client";
import { upsertLinkedInIntegrationTokens } from "@/lib/linkedin/integration-store";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("linkedin_oauth_state")?.value;
  const next = cookieStore.get("linkedin_oauth_next")?.value ?? "/overview";
  const safeNext = next.startsWith("/") ? next : "/overview";

  cookieStore.delete("linkedin_oauth_state");
  cookieStore.delete("linkedin_oauth_next");

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/overview?integration=linkedin&status=error&message=${encodeURIComponent(error)}`,
        request.url,
      ),
    );
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      new URL("/overview?integration=linkedin&status=error&message=invalid_state", request.url),
    );
  }

  try {
    const [{ workspace, userId, profile }, token] = await Promise.all([
      getWorkspaceContext(),
      exchangeLinkedInCodeForToken({ code }),
    ]);
    const userInfo = await fetchLinkedInUserInfo({
      accessToken: token.accessToken,
    });

    await upsertLinkedInIntegrationTokens({
      workspaceId: workspace.id,
      userId,
      linkedinSub: userInfo.sub,
      email: userInfo.email ?? profile.email ?? null,
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      tokenType: token.tokenType,
      scopes: token.scopes,
    });
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId,
      provider: "linkedin",
      status: "connected",
      permissionScope: "openid profile email",
    });

    return NextResponse.redirect(
      new URL(
        `${safeNext}?integration=linkedin&status=connected`,
        request.url,
      ),
    );
  } catch (callbackError) {
    try {
      const { workspace, userId } = await getWorkspaceContext();
      await upsertIntegrationConnectionStatus({
        workspaceId: workspace.id,
        userId,
        provider: "linkedin",
        status: "error",
        permissionScope: "openid profile email",
        lastError: callbackError instanceof Error ? callbackError.message : "LinkedIn connect failed",
      });
    } catch {
      // Ignore status update failures on callback error path.
    }
    const message =
      callbackError instanceof Error ? callbackError.message : "LinkedIn connect failed";
    return NextResponse.redirect(
      new URL(
        `/overview?integration=linkedin&status=error&message=${encodeURIComponent(message)}`,
        request.url,
      ),
    );
  }
}
