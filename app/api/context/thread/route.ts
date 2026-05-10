import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceAccess } from "@/lib/api/workspace-access";
import { getThreadContext } from "@/lib/context/service";

const inputSchema = z
  .object({
    conversation_id: z.string().uuid().optional(),
    source_thread_id: z.string().min(1).max(200).optional(),
    person_id: z.string().uuid().optional(),
  })
  .refine((value) => Boolean(value.conversation_id || value.source_thread_id), {
    message: "conversation_id or source_thread_id is required",
  });

export async function POST(request: NextRequest) {
  try {
    const access = await requireWorkspaceAccess();
    const values = inputSchema.parse(await request.json());

    const result = await getThreadContext({
      workspaceId: access.workspaceId,
      conversationId: values.conversation_id ?? null,
      sourceThreadId: values.source_thread_id ?? null,
      personId: values.person_id ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Thread context failed";
    const status = message === "Unauthorized" ? 401 : message === "Workspace not found" ? 404 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
