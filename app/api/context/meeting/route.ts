import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceAccess } from "@/lib/api/workspace-access";
import { getMeetingContext } from "@/lib/context/service";

const inputSchema = z.object({
  meeting_id: z.string().uuid(),
  person_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const access = await requireWorkspaceAccess();
    const values = inputSchema.parse(await request.json());

    const result = await getMeetingContext({
      workspaceId: access.workspaceId,
      meetingId: values.meeting_id,
      personId: values.person_id ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meeting context failed";
    const status = message === "Unauthorized" ? 401 : message === "Workspace not found" ? 404 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
