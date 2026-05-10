import { getHydraEnv } from "@/lib/env";
import { ensureHydraTenant } from "@/lib/hydradb/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import type { Workspace } from "@/types";

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === "23505";
}

async function readExistingWorkspaceForUser(input: { userId: string }) {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace:workspaces(*)")
    .eq("user_id", input.userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data?.workspace as Workspace | null) ?? null;
}

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
      const fallbackResult = await params.userSupabaseClient.from("profiles").upsert(profilePayload);
      profileError = fallbackResult.error ?? null;
    }
  }

  if (profileError) throw profileError;

  const existingWorkspace = await readExistingWorkspaceForUser({
    userId: params.userId,
  });

  if (existingWorkspace) {
    return existingWorkspace;
  }

  const workspaceName = "ContextIQ Workspace";
  const workspaceId = crypto.randomUUID();
  const fixedTenantId = env.HYDRADB_TENANT_ID?.trim() ?? "";

  if (process.env.NODE_ENV === "production" && fixedTenantId.length > 0) {
    console.warn(
      "HYDRADB_TENANT_ID is set in production. Ignoring fixed tenant override and using per-workspace tenant IDs.",
    );
  }

  const shouldUseFixedTenant = fixedTenantId.length > 0 && process.env.NODE_ENV !== "production";
  const candidateTenantIds = shouldUseFixedTenant
    ? [fixedTenantId, `workspace_${workspaceId}`]
    : [`workspace_${workspaceId}`];

  let workspace: Workspace | null = null;
  let lastWorkspaceError: unknown = null;

  for (const hydraTenantId of candidateTenantIds) {
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

    const insertResult = await supabase
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

    if (!insertResult.error && insertResult.data) {
      workspace = insertResult.data as Workspace;
      break;
    }

    lastWorkspaceError = insertResult.error;
    if (!isUniqueViolation(insertResult.error)) {
      break;
    }

    const recovered = await readExistingWorkspaceForUser({ userId: params.userId });
    if (recovered) {
      return recovered;
    }
  }

  if (!workspace) {
    throw lastWorkspaceError ?? new Error("Failed to create workspace.");
  }

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: params.userId,
    role: "owner",
  });

  if (memberError) {
    const recovered = await readExistingWorkspaceForUser({ userId: params.userId });
    if (recovered) {
      return recovered;
    }
    throw memberError;
  }

  return workspace;
}
