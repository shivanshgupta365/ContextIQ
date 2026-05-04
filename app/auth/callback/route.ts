import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { bootstrapUserWorkspace } from "@/lib/auth/bootstrap";
import { getPublicEnv } from "@/lib/env";
import { upsertGmailIntegrationTokens } from "@/lib/gmail/integration-store";
import { fetchMicrosoftProfile } from "@/lib/outlook/client";
import { upsertOutlookIntegrationTokens } from "@/lib/outlook/integration-store";

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
          response = NextResponse.redirect(new URL("/overview", request.url));
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

  const providerToken = providerSession?.provider_token as string | undefined;
  const providerRefreshToken = providerSession?.provider_refresh_token as string | undefined;

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
      refreshToken: providerRefreshToken ?? null,
      tokenType: "Bearer",
      scopes: ["openid", "profile", "email", "offline_access", "Mail.Read", "User.Read"],
    });
  }

  return response;
}
