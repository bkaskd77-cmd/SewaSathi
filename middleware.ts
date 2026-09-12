import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { updateSession } from "@/lib/supabase/middleware";
import {
  isProtectedRoute,
  isProviderRoute,
  roleOpensProviderRoutes,
  safeRedirect,
} from "@/lib/auth";
import { hasSupabaseConfig } from "@/lib/env";
import { routing, stripLocale } from "@/i18n/routing";

/**
 * Two jobs on one request: pick the language, and refresh the session.
 *
 * next-intl runs first because it owns the URL — it is what redirects `/` to
 * `/ne` for a Nepali reader and what tells the rest of the request which
 * locale it is in. Everything after it reasons about the *unprefixed* path:
 * `/ne/account` is the same protected route as `/account`, and a guard that
 * matched the raw pathname would quietly let the Nepali half of the product
 * through unauthenticated.
 *
 * The session refresh has to happen in middleware: Server Components cannot
 * write cookies, so without this a rotated token is never persisted and people
 * get logged out at seemingly random moments. Its `Set-Cookie` headers are
 * copied onto whichever response is actually returned — dropping them on an
 * intl redirect is how you lose a session on a language switch.
 */
const handleIntl = createIntlMiddleware(routing);

/** Move Supabase's refreshed auth cookies onto the response we are returning. */
function carryCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}

export async function middleware(request: NextRequest) {
  const intlResponse = handleIntl(request);

  // A redirect to add or drop the locale prefix. Nothing else should run —
  // the next request lands here again on the settled URL.
  const isRedirect = intlResponse.status >= 300 && intlResponse.status < 400;

  // Before the keys are set, let everything through rather than locking the
  // whole site behind a login that cannot possibly work.
  if (!hasSupabaseConfig()) return intlResponse;

  const { response: authResponse, user, role: roleOf } = await updateSession(request);

  if (isRedirect) return carryCookies(authResponse, intlResponse);

  const pathname = stripLocale(request.nextUrl.pathname);
  const needsAuth = isProtectedRoute(pathname) || isProviderRoute(pathname);
  if (!needsAuth) return carryCookies(authResponse, intlResponse);

  // The locale prefix stays on every redirect below: sending a Nepali reader
  // to the English /login is the one bug this whole migration exists to stop.
  const prefix = localePrefix(request.nextUrl.pathname);

  if (!user) {
    const login = request.nextUrl.clone();
    login.pathname = `${prefix}/login`;
    // Preserve the intent: someone who tapped "Book now" comes back to it.
    const intended = `${prefix}${safeRedirect(pathname + request.nextUrl.search)}`;
    login.search = `?next=${encodeURIComponent(intended)}`;
    return carryCookies(authResponse, NextResponse.redirect(login));
  }

  if (isProviderRoute(pathname)) {
    /*
     * FROM `profiles`, NEVER FROM THE TOKEN'S `user_metadata`.
     *
     * It used to read `user.user_metadata.role`, and `user_metadata` is
     * writable by its own owner — `supabase.auth.updateUser({ data: ... })` is
     * a call any signed-in browser can make. So the guard was asking the
     * person being guarded what they were allowed to do.
     *
     * Nothing was exposed by it: the only entry in `PROVIDER_ROUTES` is a
     * dashboard that does not exist yet, and every admin page re-reads
     * `profiles.role` through `getSessionProfile()` before rendering anything.
     * It was privilege escalation waiting for a route to be added — cheap to
     * close precisely while it guards nothing, and the kind of thing that gets
     * added by somebody who reasonably assumes the existing guard works.
     *
     * The lookup is lazy, so the extra round trip happens only here.
     */
    const role = await roleOf();
    if (!roleOpensProviderRoutes(role)) {
      const home = request.nextUrl.clone();
      home.pathname = prefix || "/";
      home.search = "";
      return carryCookies(authResponse, NextResponse.redirect(home));
    }
  }

  return carryCookies(authResponse, intlResponse);
}

/** "" for English (unprefixed), "/ne" for Nepali. */
function localePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (locale === routing.defaultLocale) continue;
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return `/${locale}`;
    }
  }
  return "";
}

export const config = {
  matcher: [
    /*
     * Everything except API routes, static assets and image files. Auth
     * cookies must not be attached to those, running the refresh for every
     * icon request would be pure overhead, and /api/triage must never be
     * rewritten to /ne/api/triage.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
