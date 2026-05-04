import { createHash, randomBytes } from "node:crypto";

import { getAppEnv, getLinkedInOAuthEnv } from "@/lib/env";
import { fetchWithRetry } from "@/lib/integrations/http";

function getRedirectUri() {
  const env = getAppEnv();
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/auth/linkedin/callback`;
}

export function buildLinkedInOAuthState() {
  return randomBytes(24).toString("hex");
}

export function buildLinkedInConnectUrl(input: { state: string }) {
  const env = getLinkedInOAuthEnv();

  if (!env.LINKEDIN_CLIENT_ID) {
    throw new Error("Missing LINKEDIN_CLIENT_ID.");
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    state: input.state,
    scope: "openid profile email",
  });

  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export async function exchangeLinkedInCodeForToken(input: { code: string }) {
  const env = getLinkedInOAuthEnv();

  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    throw new Error("Missing LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: getRedirectUri(),
    client_id: env.LINKEDIN_CLIENT_ID,
    client_secret: env.LINKEDIN_CLIENT_SECRET,
  });

  const response = await fetchWithRetry("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`LinkedIn token exchange failed: ${response.status} ${bodyText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
    tokenType: data.token_type ?? "Bearer",
    scopes: data.scope ? data.scope.split(" ") : ["openid", "profile", "email"],
  };
}

export async function fetchLinkedInUserInfo(input: { accessToken: string }) {
  const response = await fetchWithRetry("https://api.linkedin.com/v2/userinfo", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LinkedIn userinfo failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    sub?: string;
    name?: string;
    email?: string;
    email_verified?: boolean;
    picture?: string;
    locale?: Record<string, string>;
  };

  return {
    sub: data.sub ?? null,
    name: data.name ?? null,
    email: data.email ?? null,
    emailVerified: Boolean(data.email_verified),
    picture: data.picture ?? null,
    locale: data.locale ?? null,
  };
}

export async function fetchLinkedInOEmbed(input: { url: string }) {
  const params = new URLSearchParams({ url: input.url });
  const response = await fetchWithRetry(`https://www.linkedin.com/oembed?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LinkedIn oEmbed failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    title?: string;
    author_name?: string;
    author_url?: string;
    provider_name?: string;
    thumbnail_url?: string;
    html?: string;
  };

  return {
    title: data.title ?? null,
    authorName: data.author_name ?? null,
    authorUrl: data.author_url ?? null,
    providerName: data.provider_name ?? null,
    thumbnailUrl: data.thumbnail_url ?? null,
    html: data.html ?? null,
  };
}

export function buildLinkedInContentHash(input: { url: string; content: string }) {
  return createHash("sha256")
    .update(`${input.url}\n${input.content}`)
    .digest("hex");
}
