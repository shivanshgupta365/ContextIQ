import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { bootstrapUserWorkspace } from "@/lib/auth/bootstrap";
import { getPublicEnv } from "@/lib/env";
import { upsertGmailIntegrationTokens } from "@/lib/gmail/integration-store";
import { upsertIntegrationConnectionStatus } from "@/lib/integrations/connections";
import { fetchMicrosoftProfile, refreshMicrosoftAccessToken } from "@/lib/outlook/client";
import { upsertOutlookIntegrationTokens } from "@/lib/outlook/integration-store";

export async function GET(request: NextRequest) {
  const env = getPublicEnv();
  const code = request.nextUrl.searchParams.get("code");
  const intent = request.nextUrl.searchParams.get("intent");
  const provider = request.nextUrl.searchParams.get("provider");
  const nextPath = request.nextUrl.searchParams.get("next");
  const safeNextPath = nextPath?.startsWith("/") ? nextPath : "/overview";
  const isLegacyGmailConnect = intent === "gmail_connect";
  const isLegacyOutlookConnect = intent === "outlook_connect";
  let response = NextResponse.redirect(new URL(safeNextPath, request.url));
  let providerSession: any = null;

  if (isLegacyGmailConnect || isLegacyOutlookConnect) {
    const integration = isLegacyGmailConnect ? "gmail" : "outlook";
    return NextResponse.redirect(
      new URL(
        `${safeNextPath}?integration=${integration}&status=error&message=legacy_connect_flow`,
        request.url,
      ),
    );
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.redirect(new URL(safeNextPath, request.url));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/auth/sign-in?error=${encodeURIComponent(error.message)}`, request.url),
      );
    }
    providerSession = data.session;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session: activeSession },
  } = await supabase.auth.getSession();

  if (!user) {
    return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  }

  const workspace = await bootstrapUserWorkspace({
    userId: user.id,
    email: user.email ?? null,
    fullName:
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name
          : null,
    avatarUrl:
      typeof user.user_metadata?.avatar_url === "string"
        ? user.user_metadata.avatar_url
        : null,
    userSupabaseClient: supabase,
  });

  providerSession = providerSession ?? activeSession ?? null;

  let providerToken =
    (providerSession?.provider_token as string | undefined) ??
    (activeSession?.provider_token as string | undefined);
  let providerRefreshToken =
    (providerSession?.provider_refresh_token as string | undefined) ??
    (activeSession?.provider_refresh_token as string | undefined);
  let providerTokenRecovered = false;
  let recoveredExpiresAt: string | null = null;
  let recoveredScopes: string[] | undefined;
  let recoveredTokenType: string | null = null;
  let effectiveRefreshToken = providerRefreshToken ?? null;
  if (
    !providerToken &&
    provider === "microsoft" &&
    providerRefreshToken &&
    intent === "sign_in"
  ) {
    try {
      const refreshed = await refreshMicrosoftAccessToken({
        refreshToken: providerRefreshToken,
      });
      providerToken = refreshed.accessToken;
      providerTokenRecovered = true;
      recoveredExpiresAt = refreshed.expiresAt;
      recoveredScopes = refreshed.scopes;
      recoveredTokenType = refreshed.tokenType;
      effectiveRefreshToken = refreshed.refreshToken;
      providerRefreshToken = refreshed.refreshToken;
    } catch (error) {
      console.error(
        "Microsoft sign-in token recovery failed",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (
    providerToken &&
    provider === "google" &&
    intent === "sign_in"
  ) {
    await upsertGmailIntegrationTokens({
      workspaceId: workspace.id,
      userId: user.id,
      email: user.email ?? null,
      accessToken: providerToken,
      refreshToken: providerRefreshToken ?? null,
      tokenType: "Bearer",
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.compose",
      ],
    });
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId: user.id,
      provider: "gmail",
      status: "connected",
      permissionScope: "gmail.readonly gmail.send gmail.compose",
    });
  }

  if (
    providerToken &&
    provider === "microsoft" &&
    intent === "sign_in"
  ) {
    const microsoftProfile = await fetchMicrosoftProfile({
      accessToken: providerToken,
    }).catch(() => null);

    await upsertOutlookIntegrationTokens({
      workspaceId: workspace.id,
      userId: user.id,
      email: microsoftProfile?.email ?? user.email ?? null,
      accessToken: providerToken,
      refreshToken: effectiveRefreshToken,
      tokenType: recoveredTokenType ?? "Bearer",
      expiresAt: recoveredExpiresAt,
      scopes:
        recoveredScopes && recoveredScopes.length > 0
          ? recoveredScopes
          : [
              "openid",
              "profile",
              "email",
              "offline_access",
              "Mail.Read",
              "Calendars.Read",
              "User.Read",
            ],
    });
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId: user.id,
      provider: "outlook",
      status: "connected",
      permissionScope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
      lastError: providerTokenRecovered ? null : undefined,
    });
  }

  return response;
}
