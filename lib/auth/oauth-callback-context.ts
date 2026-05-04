import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Workspace } from "@/types";

export async function getOAuthCallbackContext() {
  const supabase = await getSupabaseServerClient();
  const admin = getSupabaseAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const [{ data: membership, error: membershipError }, { data: profile }] =
    await Promise.all([
      admin
        .from("workspace_members")
        .select("workspace:workspaces(*)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin.from("profiles").select("email,full_name").eq("id", user.id).maybeSingle(),
    ]);

  if (membershipError || !membership?.workspace) {
    throw membershipError ?? new Error("Workspace not found");
  }

  return {
    userId: user.id,
    userEmail: user.email ?? null,
    workspace: membership.workspace as Workspace,
    profile: {
      email: (profile?.email as string | null) ?? null,
      full_name: (profile?.full_name as string | null) ?? null,
    },
  };
}
