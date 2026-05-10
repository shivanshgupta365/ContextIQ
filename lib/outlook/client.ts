import { randomBytes } from "node:crypto";

import { getAppEnv, getMicrosoftOAuthEnv } from "@/lib/env";
import { fetchWithRetry } from "@/lib/integrations/http";

interface GraphListMessagesResponse {
  value?: Array<{
    id: string;
    conversationId?: string;
    subject?: string;
    bodyPreview?: string;
    receivedDateTime?: string;
    from?: { emailAddress?: { address?: string; name?: string } };
    toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
    ccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  }>;
}

function getMicrosoftRedirectUri() {
  const env = getAppEnv();
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/auth/outlook/callback`;
}

export function buildMicrosoftOAuthState() {
  return randomBytes(24).toString("hex");
}

export function buildOutlookConnectUrl(input: { state: string }) {
  const env = getMicrosoftOAuthEnv();
  if (!env.MICROSOFT_CLIENT_ID) {
    throw new Error("Missing MICROSOFT_CLIENT_ID.");
  }

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: getMicrosoftRedirectUri(),
    response_mode: "query",
    prompt: "select_account",
    state: input.state,
    scope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeMicrosoftCodeForToken(input: { code: string }) {
  const env = getMicrosoftOAuthEnv();
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("Missing MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET.");
  }

  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: getMicrosoftRedirectUri(),
    scope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
  });

  const response = await fetchWithRetry(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
    tokenType: data.token_type ?? "Bearer",
    scopes: data.scope ? data.scope.split(" ") : [],
  };
}

function parseEmails(value: string | null | undefined) {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

function formatRecipient(value: { address?: string; name?: string } | null | undefined) {
  if (!value?.address) return null;
  return value.name ? `${value.name} <${value.address}>` : value.address;
}

export async function refreshMicrosoftAccessToken(input: { refreshToken: string }) {
  const env = getMicrosoftOAuthEnv();
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("Missing MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET.");
  }

  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    scope: "openid profile email offline_access Mail.Read Calendars.Read User.Read",
  });

  const response = await fetchWithRetry(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft token refresh failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    refresh_token?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? input.refreshToken,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
    tokenType: data.token_type ?? "Bearer",
    scopes: data.scope ? data.scope.split(" ") : [],
  };
}

export async function listOutlookMessages(input: { accessToken: string; maxResults: number }) {
  const query = new URLSearchParams({
    "$top": String(Math.min(Math.max(input.maxResults, 1), 50)),
    "$select":
      "id,conversationId,subject,bodyPreview,receivedDateTime,from,toRecipients,ccRecipients",
    "$orderby": "receivedDateTime desc",
  });

  const response = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/me/messages?${query.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft Graph messages failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as GraphListMessagesResponse;
  return (data.value ?? []).map((message) => {
    const from = formatRecipient(message.from?.emailAddress);
    const toList = (message.toRecipients ?? [])
      .map((recipient) => formatRecipient(recipient.emailAddress))
      .filter(Boolean) as string[];
    const ccList = (message.ccRecipients ?? [])
      .map((recipient) => formatRecipient(recipient.emailAddress))
      .filter(Boolean) as string[];

    const fromEmails = parseEmails(from);
    const toEmails = [...toList, ...ccList].flatMap((value) => parseEmails(value));

    return {
      id: message.id,
      threadId: message.conversationId ?? null,
      subject: message.subject ?? null,
      snippet: message.bodyPreview ?? "",
      receivedAt: message.receivedDateTime ?? null,
      from,
      to: toList.join(", ") || null,
      cc: ccList.join(", ") || null,
      fromEmails,
      toEmails,
    };
  });
}

interface GraphListEventsResponse {
  value?: Array<{
    id: string;
    subject?: string;
    start?: { dateTime?: string; timeZone?: string };
    end?: { dateTime?: string; timeZone?: string };
    isCancelled?: boolean;
    attendees?: Array<{ emailAddress?: { address?: string; name?: string } }>;
    webLink?: string;
  }>;
}

export async function listOutlookCalendarEvents(input: {
  accessToken: string;
  maxResults: number;
}) {
  const query = new URLSearchParams({
    "$top": String(Math.min(Math.max(input.maxResults, 1), 25)),
    "$select": "id,subject,start,end,isCancelled,attendees,webLink",
    "$orderby": "start/dateTime asc",
  });

  const response = await fetchWithRetry(
    `https://graph.microsoft.com/v1.0/me/events?${query.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft Graph events failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as GraphListEventsResponse;
  return (data.value ?? []).map((event) => ({
    id: event.id,
    subject: event.subject ?? "Untitled event",
    startsAt: event.start?.dateTime ?? null,
    endsAt: event.end?.dateTime ?? null,
    status: event.isCancelled ? "cancelled" : "confirmed",
    attendeeEmails: (event.attendees ?? [])
      .map((attendee) => attendee.emailAddress?.address?.toLowerCase() ?? null)
      .filter(Boolean) as string[],
    attendeeDisplay: (event.attendees ?? [])
      .map((attendee) => formatRecipient(attendee.emailAddress))
      .filter(Boolean) as string[],
    webLink: event.webLink ?? null,
  }));
}

export async function fetchMicrosoftProfile(input: { accessToken: string }) {
  const response = await fetchWithRetry("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft profile fetch failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    id?: string;
    mail?: string;
    userPrincipalName?: string;
  };

  return {
    id: data.id ?? null,
    email: data.mail ?? data.userPrincipalName ?? null,
  };
}
