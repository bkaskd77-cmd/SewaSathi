import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/supabase";

/**
 * Supabase client for Client Components ("use client").
 *
 * `createBrowserClient` memoises internally, so calling this on every render is
 * fine — you get the same underlying client and the same realtime socket.
 */
export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
  );
}
