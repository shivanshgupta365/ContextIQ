import { NextRequest, NextResponse } from "next/server";

import { runCommandSearch } from "@/lib/command/search";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { CommandSearchRequest } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as Omit<CommandSearchRequest, "workspaceId">;
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, workspace:workspaces(hydradb_tenant_id)")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (membershipError || !membership?.workspace_id) {
      return NextResponse.json({ ok: false, message: "Workspace not found" }, { status: 404 });
    }

    const result = await runCommandSearch({
      workspaceId: membership.workspace_id as string,
      hydraTenantId:
        ((membership.workspace as { hydradb_tenant_id?: string } | null)?.hydradb_tenant_id as
          | string
          | undefined) ?? null,
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
