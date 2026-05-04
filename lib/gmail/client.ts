import { getGoogleOAuthEnv } from "@/lib/env";
import { fetchWithRetry } from "@/lib/integrations/http";

interface GmailListResponse {
  messages?: Array<{ id: string; threadId?: string }>;
}

interface GmailMessageResponse {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

function parseEmails(value: string | null | undefined) {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

function getHeaderValue(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
) {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

async function gmailFetch<T>(accessToken: string, path: string) {
  const response = await fetchWithRetry(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gmail API failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

export async function listGmailMessageIds(input: {
  accessToken: string;
  query: string;
  maxResults: number;
}) {
  const query = new URLSearchParams({
    q: input.query,
    maxResults: String(input.maxResults),
    includeSpamTrash: "false",
  });

  const result = await gmailFetch<GmailListResponse>(
    input.accessToken,
    `/messages?${query.toString()}`,
  );

  return result.messages ?? [];
}

export async function getGmailMessageMetadata(input: {
  accessToken: string;
  messageId: string;
}) {
  const query = new URLSearchParams({
    format: "metadata",
    metadataHeaders: "From",
  });
  query.append("metadataHeaders", "To");
  query.append("metadataHeaders", "Cc");
  query.append("metadataHeaders", "Subject");
  query.append("metadataHeaders", "Date");

  const result = await gmailFetch<GmailMessageResponse>(
    input.accessToken,
    `/messages/${input.messageId}?${query.toString()}`,
  );

  const headers = result.payload?.headers;
  const from = getHeaderValue(headers, "From");
  const to = getHeaderValue(headers, "To");
  const cc = getHeaderValue(headers, "Cc");
  const subject = getHeaderValue(headers, "Subject");
  const date = getHeaderValue(headers, "Date");

  const fromEmails = parseEmails(from);
  const toEmails = [...parseEmails(to), ...parseEmails(cc)];

  return {
    id: result.id,
    threadId: result.threadId ?? null,
    snippet: result.snippet ?? "",
    labelIds: result.labelIds ?? [],
    internalDate: result.internalDate ?? null,
    from,
    to,
    cc,
    subject,
    date,
    fromEmails,
    toEmails,
  };
}

export async function refreshGoogleAccessToken(input: { refreshToken: string }) {
  const env = getGoogleOAuthEnv();

  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error(
      "Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET for Gmail token refresh.",
    );
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });

  const response = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google token refresh failed: ${response.status} ${errorBody}`);
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
    scopes: data.scope ? data.scope.split(" ") : [],
  };
}

function toBase64Url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function gmailPost<T>(input: {
  accessToken: string;
  path: string;
  body: Record<string, unknown>;
}) {
  const response = await fetchWithRetry(
    `https://gmail.googleapis.com/gmail/v1/users/me${input.path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.body),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gmail API failed: ${response.status} ${errorBody}`);
  }

  return (await response.json()) as T;
}

export async function createGmailDraft(input: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
}) {
  const raw = [
    `To: ${input.to}`,
    "Content-Type: text/plain; charset=utf-8",
    `Subject: ${input.subject}`,
    "",
    input.body,
  ].join("\r\n");

  return gmailPost<{ id: string; message?: { id?: string } }>({
    accessToken: input.accessToken,
    path: "/drafts",
    body: {
      message: {
        raw: toBase64Url(raw),
      },
    },
  });
}

export async function sendGmailMessage(input: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
}) {
  const raw = [
    `To: ${input.to}`,
    "Content-Type: text/plain; charset=utf-8",
    `Subject: ${input.subject}`,
    "",
    input.body,
  ].join("\r\n");

  return gmailPost<{ id: string; threadId?: string; labelIds?: string[] }>({
    accessToken: input.accessToken,
    path: "/messages/send",
    body: {
      raw: toBase64Url(raw),
    },
  });
}
