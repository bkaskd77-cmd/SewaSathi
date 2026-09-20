import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "@/types/supabase";

/**
 * Service-role Supabase client. Bypasses row level security entirely.
 *
 * Use only in trusted server code (Route Handlers, Server Actions, webhooks)
 * for work a user genuinely cannot do as themselves — verifying a provider,
 * reconciling a payment callback, running an admin action. Never reach for it
 * to work around an RLS policy that should have been written properly.
 *
 * The `server-only` import makes bundling this into a Client Component a build
 * error rather than a leaked key.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    publicEnv.supabaseUrl,
    serverEnv.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
