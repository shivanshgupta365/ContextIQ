"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

function decodeMessage(input: string | null) {
  if (!input) return null;
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
