import { type NextRequest, NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";
import {
  isProtectedRoute,
  isProviderRoute,
  safeRedirect,
} from "@/lib/auth/routes";
import { hasSupabaseConfig } from "@/lib/env";

/**
 * Refreshes the Supabase session on every request and guards the routes that
 * need one.
 *
 * The refresh has to happen in middleware: Server Components cannot write
 * cookies, so without this a rotated token is never persisted and people get
 * logged out at seemingly random moments.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Before the keys are set, let everything through rather than locking the
  // whole site behind a login that cannot possibly work.
  if (!hasSupabaseConfig()) return NextResponse.next({ request });

  const { response, user } = await updateSession(request);

  const needsAuth = isProtectedRoute(pathname) || isProviderRoute(pathname);
  if (!needsAuth) return response;

  if (!user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Preserve the intent: someone who tapped "Book now" comes back to it.
    login.search = `?next=${encodeURIComponent(safeRedirect(pathname + search))}`;
    return NextResponse.redirect(login);
  }

  if (isProviderRoute(pathname)) {
    const role = (user.user_metadata?.role as string | undefined) ?? "customer";
    // Phase 10 replaces this with a profiles lookup once provider onboarding
    // exists; until then no one has the claim and the routes stay shut.
    if (role !== "provider" && role !== "admin") {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Auth cookies must not
     * be attached to those, and running the refresh for every icon request
     * would be pure overhead.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
