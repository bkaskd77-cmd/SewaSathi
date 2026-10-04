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
  return createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      /*
       * ASYNC, BECAUSE NEXT 16 MADE `cookies()` ASYNC — and the store is awaited
       * INSIDE these two methods rather than once above them, which is what keeps
       * `createClient()` synchronous for its fifty-two callers. `@supabase/ssr` types
       * both hooks as returning a promise or a value, so this is the contract rather
       * than a trick; the alternative was `await createClient()` at every call site,
       * fifty-two chances to miss one and get a client with no session.
       */
      cookies: {
        async getAll() {
          return (await cookies()).getAll();
        },
        async setAll(cookiesToSet) {
          try {
            const store = await cookies();
            for (const { name, value, options } of cookiesToSet) {
              store.set(name, value, options);
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
