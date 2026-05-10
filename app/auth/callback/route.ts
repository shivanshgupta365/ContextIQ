import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { bootstrapUserWorkspace } from "@/lib/auth/bootstrap";
import { getPublicEnv } from "@/lib/env";
import { upsertGmailIntegrationTokens } from "@/lib/gmail/integration-store";
import { upsertIntegrationConnectionStatus } from "@/lib/integrations/connections";
import { fetchMicrosoftProfile, refreshMicrosoftAccessToken } from "@/lib/outlook/client";
import {
  getValidOutlookAccessToken,
  upsertOutlookIntegrationTokens,
} from "@/lib/outlook/integration-store";

export async function GET(request: NextRequest) {
  const env = getPublicEnv();
  const code = request.nextUrl.searchParams.get("code");
  const intent = request.nextUrl.searchParams.get("intent");
  const provider = request.nextUrl.searchParams.get("provider");
  const nextPath = request.nextUrl.searchParams.get("next");
  const safeNextPath = nextPath?.startsWith("/") ? nextPath : "/overview";
  let response = NextResponse.redirect(new URL(safeNextPath, request.url));
  let providerSession: any = null;

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
  const upsertProviderError = async (
    integration: "gmail" | "outlook",
    message: string,
    permissionScope: string,
  ) => {
    await upsertIntegrationConnectionStatus({
      workspaceId: workspace.id,
      userId: user.id,
      provider: integration,
      status: "error",
      permissionScope,
      lastError: message,
    });
  };

  if (intent === "outlook_connect" && provider !== "microsoft") {
    await upsertProviderError(
      "outlook",
      "use_microsoft_for_outlook",
      "openid profile email offline_access Mail.Read Calendars.Read User.Read",
    );
    return NextResponse.redirect(
      new URL(
        `${safeNextPath}?integration=outlook&status=error&message=use_microsoft_for_outlook`,
        request.url,
      ),
    );
  }

  if (intent === "gmail_connect" && provider !== "google") {
    await upsertProviderError(
      "gmail",
      "use_google_for_gmail",
      "gmail.readonly gmail.send gmail.compose",
    );
    return NextResponse.redirect(
      new URL(
        `${safeNextPath}?integration=gmail&status=error&message=use_google_for_gmail`,
        request.url,
      ),
    );
  }

  if (
    !providerToken &&
    provider === "microsoft" &&
    providerRefreshToken &&
    (intent === "outlook_connect" || intent === "sign_in")
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
      await upsertProviderError(
        "outlook",
        error instanceof Error ? `provider_token_recovery_failed:${error.message}` : "provider_token_recovery_failed",
        "openid profile email offline_access Mail.Read Calendars.Read User.Read",
      );
    }
  }

  if (
    !providerToken &&
    provider === "microsoft" &&
    intent === "outlook_connect"
  ) {
    try {
      const existing = await getValidOutlookAccessToken({
        workspaceId: workspace.id,
        userId: user.id,
      });
      if (existing.accessToken) {
        await upsertIntegrationConnectionStatus({
          workspaceId: workspace.id,
          userId: user.id,
          provider: "outlook",
          status: "connected",
          permissionScope:
            "openid profile email offline_access Mail.Read Calendars.Read User.Read",
          lastError: null,
        });
        return NextResponse.redirect(
          new URL(
            `${safeNextPath}?integration=outlook&status=connected&message=existing_tokens_reused`,
            request.url,
          ),
        );
      }
    } catch (error) {
      await upsertProviderError(
        "outlook",
        error instanceof Error ? `existing_token_recovery_failed:${error.message}` : "existing_token_recovery_failed",
        "openid profile email offline_access Mail.Read Calendars.Read User.Read",
      );
    }
  }

  if (!providerToken && provider === "microsoft" && intent === "outlook_connect") {
    const detail = JSON.stringify({
      reason: "missing_provider_token_after_reconciliation",
      provider,
      intent,
      hasCode: Boolean(code),
      hadProviderSession: Boolean(providerSession),
      hadSessionToken: Boolean(activeSession?.provider_token),
      hadSessionRefresh: Boolean(activeSession?.provider_refresh_token),
      hadExchangeToken: Boolean((providerSession as { provider_token?: string } | null)?.provider_token),
      hadExchangeRefresh: Boolean(
        (providerSession as { provider_refresh_token?: string } | null)?.provider_refresh_token,
      ),
    });
    await upsertProviderError(
      "outlook",
      detail,
      "openid profile email offline_access Mail.Read Calendars.Read User.Read",
    );
  }

  if (
    providerToken &&
    provider === "google" &&
    (intent === "gmail_connect" || intent === "sign_in")
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
    (intent === "outlook_connect" || intent === "sign_in")
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

  if (
    !providerToken &&
    (intent === "gmail_connect" || intent === "outlook_connect")
  ) {
    const integration = intent === "gmail_connect" ? "gmail" : "outlook";
    await upsertProviderError(
      integration,
      "missing_provider_token",
      integration === "gmail"
        ? "gmail.readonly gmail.send gmail.compose"
        : "openid profile email offline_access Mail.Read Calendars.Read User.Read",
    );
    return NextResponse.redirect(
      new URL(
        `${safeNextPath}?integration=${integration}&status=error&message=${
          integration === "outlook" ? "provider_token_recovery_failed" : "missing_provider_token"
        }`,
        request.url,
      ),
    );
  }

  return response;
}
