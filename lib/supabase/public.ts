import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/supabase";

/**
 * A Supabase client with NO cookies, for data that is the same for everybody.
 *
 * WHY THIS EXISTS, and it is a performance fix rather than a security one.
 *
 * `lib/supabase/server.ts` reads `cookies()` so it can act as the signed-in
 * person. Touching `cookies()` in a Server Component opts that route out of
 * static rendering for ever: Next.js cannot cache a page whose output might
 * depend on who is asking. So the catalogue — categories, the provider
 * directory, reviews, all of it identical for every visitor — was being
 * rendered from scratch on every request, with a round trip to Singapore for
 * each read, on pages where nothing about the answer varies.
 *
 * Reading them without cookies makes those pages cacheable again. The landing
 * page and the catalogue are then served from Vercel's cache in milliseconds
 * instead of waiting on a database.
 *
 * THE SECURITY POSITION IS UNCHANGED. This is the same anon key the browser
 * already holds, and the request arrives at Postgres as `anon`, so the RLS
 * policies decide exactly what it may read — the public directory and nothing
 * else. Anything that depends on who is asking (bookings, addresses, a
 * professional's phone number) must keep using `createClient()`, because with
 * this one there IS no who.
 *
 * The session is deliberately not persisted: a module-level client that
 * remembered a session would be one visitor's identity leaking into another
 * visitor's render, which is the exact bug the per-request rule exists to
 * prevent.
 */

let client: ReturnType<typeof createSupabaseClient<Database>> | null = null;

export function createPublicClient() {
  if (client) return client;

  client = createSupabaseClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  return client;
}
