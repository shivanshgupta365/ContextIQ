import { NextRequest, NextResponse } from "next/server";

import { requireWorkspaceAccess } from "@/lib/api/workspace-access";
import { runMemorySearch } from "@/lib/context/service";
import type { CommandSearchRequest } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as Omit<CommandSearchRequest, "workspaceId">;
    const access = await requireWorkspaceAccess();

    const result = await runMemorySearch({
      workspaceId: access.workspaceId,
      hydraTenantId: access.hydraTenantId,
      query: input.query,
      accountId: input.accountId ?? null,
      personId: input.personId ?? null,
      timeframeDays: input.timeframeDays ?? 30,
      limit: input.limit ?? 12,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Command search failed" },
      { status: 400 },
    );
  }
}
