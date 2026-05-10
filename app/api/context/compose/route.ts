import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceAccess } from "@/lib/api/workspace-access";
import { getComposeContext } from "@/lib/context/service";

const inputSchema = z.object({
  person_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),
  draft_intent: z.string().max(240).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const access = await requireWorkspaceAccess();
    const values = inputSchema.parse(await request.json());

    const result = await getComposeContext({
      workspaceId: access.workspaceId,
      personId: values.person_id,
      accountId: values.account_id ?? null,
      draftIntent: values.draft_intent ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Compose context failed";
    const status = message === "Unauthorized" ? 401 : message === "Workspace not found" ? 404 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
