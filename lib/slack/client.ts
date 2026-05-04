import { randomBytes } from "node:crypto";

import { getAppEnv, getSlackOAuthEnv } from "@/lib/env";
import { fetchWithRetry } from "@/lib/integrations/http";

export function buildSlackOAuthState() {
  return randomBytes(24).toString("hex");
}

function getSlackRedirectUri() {
  const env = getAppEnv();
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/auth/slack/callback`;
}

export function buildSlackConnectUrl(input: { state: string }) {
  const env = getSlackOAuthEnv();
  if (!env.SLACK_CLIENT_ID) {
    throw new Error("Missing SLACK_CLIENT_ID.");
  }

  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: "channels:read,groups:read,im:read,mpim:read",
    user_scope:
      "channels:read,groups:read,im:read,mpim:read,channels:history,groups:history,im:history,mpim:history",
    redirect_uri: getSlackRedirectUri(),
    state: input.state,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackCodeForToken(input: { code: string }) {
  const env = getSlackOAuthEnv();
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    throw new Error("Missing SLACK_CLIENT_ID / SLACK_CLIENT_SECRET.");
  }

  const body = new URLSearchParams({
    code: input.code,
    client_id: env.SLACK_CLIENT_ID,
    client_secret: env.SLACK_CLIENT_SECRET,
    redirect_uri: getSlackRedirectUri(),
  });

  const response = await fetchWithRetry("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    token_type?: string;
    scope?: string;
    authed_user?: {
      id?: string;
      access_token?: string;
      scope?: string;
      token_type?: string;
    };
    team?: { id?: string; name?: string };
    enterprise?: { id?: string; name?: string };
  };

  if (!data.ok) {
    throw new Error(`Slack token exchange failed: ${data.error ?? "oauth.v2.access failed"}`);
  }

  return {
    botAccessToken: data.access_token ?? null,
    botTokenType: data.token_type ?? "bot",
    botScopes: data.scope ? data.scope.split(",") : [],
    userAccessToken: data.authed_user?.access_token ?? null,
    userTokenType: data.authed_user?.token_type ?? "user",
    userScopes: data.authed_user?.scope ? data.authed_user.scope.split(",") : [],
    slackUserId: data.authed_user?.id ?? null,
    teamId: data.team?.id ?? null,
    teamName: data.team?.name ?? null,
    enterpriseId: data.enterprise?.id ?? null,
  };
}

async function slackGet<T>(input: { accessToken: string; path: string; params?: URLSearchParams }) {
  const query = input.params ? `?${input.params.toString()}` : "";
  const response = await fetchWithRetry(`https://slack.com/api/${input.path}${query}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack API failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack API failed: ${data.error ?? "unknown error"}`);
  }

  return data as T;
}

export async function fetchSlackAuthIdentity(input: { accessToken: string }) {
  const data = await slackGet<{ user_id?: string; user?: string; team_id?: string; team?: string }>(
    {
      accessToken: input.accessToken,
      path: "auth.test",
    },
  );

  return {
    userId: data.user_id ?? null,
    userName: data.user ?? null,
    teamId: data.team_id ?? null,
    teamName: data.team ?? null,
  };
}

export async function listSlackConversations(input: { accessToken: string; maxChannels: number }) {
  const params = new URLSearchParams({
    types: "public_channel,private_channel,im,mpim",
    limit: String(Math.min(Math.max(input.maxChannels, 1), 20)),
  });

  const data = await slackGet<{
    channels?: Array<{ id?: string; name?: string; is_im?: boolean; user?: string }>;
  }>({
    accessToken: input.accessToken,
    path: "users.conversations",
    params,
  });

  return (data.channels ?? [])
    .filter((channel) => Boolean(channel.id))
    .map((channel) => ({
      id: channel.id as string,
      name: channel.name ?? (channel.is_im ? `dm-${channel.user ?? "unknown"}` : "unknown"),
    }));
}

export async function listSlackChannelMessages(input: {
  accessToken: string;
  channelId: string;
  limit: number;
}) {
  const params = new URLSearchParams({
    channel: input.channelId,
    limit: String(Math.min(Math.max(input.limit, 1), 25)),
  });

  const data = await slackGet<{
    messages?: Array<{ ts?: string; text?: string; user?: string }>;
  }>({
    accessToken: input.accessToken,
    path: "conversations.history",
    params,
  });

  return (data.messages ?? [])
    .filter((message) => Boolean(message.ts))
    .map((message) => ({
      id: message.ts as string,
      text: message.text ?? "",
      userId: message.user ?? null,
      occurredAt: message.ts
        ? new Date(Number(message.ts.split(".")[0]) * 1000).toISOString()
        : new Date().toISOString(),
    }));
}
