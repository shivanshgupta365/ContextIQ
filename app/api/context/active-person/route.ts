import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceAccess } from "@/lib/api/workspace-access";
import { getActivePersonContext } from "@/lib/context/service";

const inputSchema = z
  .object({
    person_id: z.string().uuid().optional(),
    person_query: z.string().min(1).max(240).optional(),
    account_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(30).optional(),
  })
  .refine((value) => Boolean(value.person_id || value.person_query), {
    message: "person_id or person_query is required",
  });

export async function POST(request: NextRequest) {
  try {
    const access = await requireWorkspaceAccess();
    const values = inputSchema.parse(await request.json());

    const result = await getActivePersonContext({
      workspaceId: access.workspaceId,
      personId: values.person_id ?? null,
      personQuery: values.person_query ?? null,
      accountId: values.account_id ?? null,
      limit: values.limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Active person context failed";
    const status = message === "Unauthorized" ? 401 : message === "Workspace not found" ? 404 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
