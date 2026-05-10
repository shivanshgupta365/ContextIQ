import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function requireWorkspaceAccess() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("workspace_id,role,workspace:workspaces(hydradb_tenant_id)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (error || !membership?.workspace_id) {
    throw new Error("Workspace not found");
  }

  return {
    userId: user.id,
    workspaceId: membership.workspace_id as string,
    role: (membership.role as "owner" | "member" | null) ?? "member",
    hydraTenantId:
      ((membership.workspace as { hydradb_tenant_id?: string } | null)?.hydradb_tenant_id as
        | string
        | undefined) ?? null,
  };
}
