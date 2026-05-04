import { createClient } from "@supabase/supabase-js";

import { getSupabaseAdminEnv } from "@/lib/env";

let adminClient: any = null;

export function getSupabaseAdminClient(): any {
  if (adminClient) return adminClient;

  const env = getSupabaseAdminEnv();

  adminClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  ) as any;

  return adminClient;
}
