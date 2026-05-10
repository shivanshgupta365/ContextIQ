import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceAccess } from "@/lib/api/workspace-access";
import { runMemorySearch } from "@/lib/context/service";

const inputSchema = z.object({
  query: z.string().min(1).max(500),
  accountId: z.string().uuid().nullable().optional(),
  personId: z.string().uuid().nullable().optional(),
  timeframeDays: z.number().int().min(1).max(365).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const access = await requireWorkspaceAccess();
    const values = inputSchema.parse(await request.json());

    const result = await runMemorySearch({
      workspaceId: access.workspaceId,
      hydraTenantId: access.hydraTenantId,
      query: values.query,
      accountId: values.accountId ?? null,
      personId: values.personId ?? null,
      timeframeDays: values.timeframeDays,
      limit: values.limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Memory search failed";
    const status = message === "Unauthorized" ? 401 : message === "Workspace not found" ? 404 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
