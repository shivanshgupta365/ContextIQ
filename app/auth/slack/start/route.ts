import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { buildSlackConnectUrl, buildSlackOAuthState } from "@/lib/slack/client";

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  const safeNext = next?.startsWith("/") ? next : "/overview";
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(`/auth/sign-in?next=${encodeURIComponent(safeNext)}`, request.url),
    );
  }

  const state = buildSlackOAuthState();
  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === "production";

  cookieStore.set("slack_oauth_state", state, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  cookieStore.set("slack_oauth_next", safeNext, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  return NextResponse.redirect(buildSlackConnectUrl({ state }));
}
