"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

function decodeMessage(input: string | null) {
  if (!input) return null;
  const normalized = input.trim();
  const knownMessages: Record<string, string> = {
    missing_provider_token: "Provider token missing from callback response",
    provider_token_recovery_failed: "Supabase did not return a usable Microsoft access token",
    existing_tokens_reused: "Reused the existing stored Outlook session",
    use_microsoft_for_outlook: "Use Microsoft sign-in for Outlook connection",
    use_google_for_gmail: "Use Google sign-in for Gmail connection",
  };
  if (knownMessages[normalized]) {
    return knownMessages[normalized];
  }
  return input
    .split(",")
    .filter(Boolean)
    .map((part) => part.replaceAll("_", " "))
    .join(" • ");
}

export function IntegrationStatusBanner() {
  const params = useSearchParams();
  const integration = params.get("integration");
  const status = params.get("status");
  const message = params.get("message");

  const content = useMemo(() => {
    if (!integration || !status) return null;

    const readableStatus = status.replaceAll("_", " ");
    const readableIntegration = integration.toUpperCase();
    const readableMessage = decodeMessage(message);
    const isError = status === "error";

    return {
      isError,
      text: `${readableIntegration}: ${readableStatus}${readableMessage ? ` • ${readableMessage}` : ""}`,
    };
  }, [integration, status, message]);

  if (!content) return null;

  return (
    <div
      className={`border-b px-8 py-2 text-[12px] font-semibold ${
        content.isError
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
    >
      {content.text}
    </div>
  );
}
