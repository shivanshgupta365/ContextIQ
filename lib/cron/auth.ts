import { NextRequest } from "next/server";

import { getCronEnv } from "@/lib/env";

export function assertAuthorizedCronRequest(request: NextRequest) {
  const env = getCronEnv();
  const configured = env.CRON_SYNC_SECRET;

  if (!configured) {
    throw new Error("CRON_SYNC_SECRET is not configured.");
  }

  const bearer = request.headers.get("authorization");
  const vercelHeader = request.headers.get("x-cron-secret");
  const token = bearer?.replace(/^Bearer\s+/i, "").trim() || vercelHeader?.trim() || "";

  if (token !== configured) {
    throw new Error("Unauthorized cron request.");
  }
}
