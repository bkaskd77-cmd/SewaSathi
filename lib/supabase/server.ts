import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/supabase";

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 *
 * Create a new one per request — never hoist this to a module-level singleton,
 * or one visitor's session leaks into another's render.
 *
 * Server Components cannot write cookies, so `setAll` throws there and is
 * caught. That is safe as long as middleware refreshes the session (see
 * ./middleware.ts) — which is what Phase 3 wires up.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot mutate cookies.
            // Middleware handles the refresh instead.
          }
        },
      },
    },
  );
}
