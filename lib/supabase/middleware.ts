import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/supabase";

/**
 * Refresh the Supabase auth session on every request and write the rotated
 * tokens back onto the response.
 *
 * Not yet mounted — Phase 3 adds a root `middleware.ts` that calls this:
 *
 *   export async function middleware(request: NextRequest) {
 *     return updateSession(request);
 *   }
 *
 *   export const config = {
 *     matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
 *   };
 *
 * Without this, server-rendered pages read an expired token and users get
 * logged out at seemingly random moments.
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
  await supabase.auth.getUser();

  return response;
}
