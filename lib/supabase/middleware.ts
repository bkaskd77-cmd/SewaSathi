import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/supabase";

/**
 * Refresh the Supabase auth session on every request and write the rotated
 * tokens back onto the response.
 *
 * Called from the root `middleware.ts`, which also does the route guarding.
 * Returns the refreshed response together with the user, so the caller does
 * not have to build a second client just to ask who is signed in.
 *
 * Without this refresh, server-rendered pages read an expired token and users
 * get logged out at seemingly random moments.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Auth responses must never be cached by a CDN — otherwise one
          // visitor's refreshed session can be served to another.
          for (const [key, headerValue] of Object.entries(headers)) {
            response.headers.set(key, headerValue);
          }
        },
      },
    },
  );

  // Touching the user is what triggers the refresh. Do it before anything
  // else writes to the response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
