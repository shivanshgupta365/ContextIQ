import { slugify } from "@/lib/utils";
import { ensureHydraTenant } from "@/lib/hydradb/client";
import { getHydraEnv } from "@/lib/env";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Workspace } from "@/types";

export async function bootstrapUserWorkspace(params: {
  userId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  userSupabaseClient?: any;
}): Promise<Workspace> {
  const env = getHydraEnv();
  const supabase = getSupabaseAdminClient();

  const profilePayload = {
    id: params.userId,
    email: params.email,
    full_name: params.fullName,
    avatar_url: params.avatarUrl,
    updated_at: new Date().toISOString(),
  };

  let { error: profileError } = await supabase.from("profiles").upsert(profilePayload);

  if (profileError && params.userSupabaseClient) {
    const code = (profileError as { code?: string } | null)?.code;
    if (code === "42501") {
      const fallbackResult = await params.userSupabaseClient
        .from("profiles")
        .upsert(profilePayload);
      profileError = fallbackResult.error ?? null;
    }
  }

  if (profileError) throw profileError;

  const { data: existingMembership } = await supabase
    .from("workspace_members")
    .select("workspace:workspaces(*)")
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();

  if (existingMembership?.workspace) {
    return existingMembership.workspace as Workspace;
  }

  const workspaceName = "ContextIQ Workspace";
  const workspaceId = crypto.randomUUID();
  const fixedTenantId = env.HYDRADB_TENANT_ID?.trim() ?? "";
  const hydraTenantId = fixedTenantId.length > 0 ? fixedTenantId : `workspace_${workspaceId}`;
  try {
    await ensureHydraTenant({
      tenantId: hydraTenantId,
      tenantName: workspaceName,
      tenantDescription: `HydraDB tenant for ${params.email ?? params.userId}`,
    });
  } catch (error) {
    // Do not block sign-in when HydraDB credentials are misconfigured.
    console.error("Hydra tenant bootstrap failed; continuing without blocking auth", error);
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({
      id: workspaceId,
      owner_id: params.userId,
      name: workspaceName,
      slug: slugify(`${workspaceName}-${workspaceId.slice(0, 6)}`),
      description: "Live ContextIQ workspace",
      hydradb_tenant_id: hydraTenantId,
    })
    .select("*")
    .single();

  if (workspaceError) throw workspaceError;

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: params.userId,
    role: "owner",
  });

  if (memberError) throw memberError;

  return workspace as Workspace;
}
