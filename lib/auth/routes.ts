import { stripLocale } from "@/i18n/routing";

/**
 * One place that decides what each route requires.
 *
 * Kept as data rather than scattered checks so the middleware, the header and
 * any future guard all agree. Provider routes are empty of pages until
 * Phase 10 — the pattern is wired now so that phase adds files, not plumbing.
 *
 * Every path below is written **without** a locale prefix, and every function
 * here strips one before matching. `/ne/account` and `/account` are the same
 * protected route; a guard that only knew about the second would leave the
 * Nepali half of the product unguarded.
 */

/** Anyone, signed in or not. Prefix match. */
export const PUBLIC_ROUTES = [
  "/",
  "/services",
  "/login",
  "/verify",
  "/legal",
  "/help",
  "/about",
  "/careers",
  "/contact",
  "/providers/join",
  "/design-system",
] as const;

/** Requires a session. */
export const PROTECTED_ROUTES = [
  "/bookings",
  "/account",
  "/onboarding",
  /*
   * Phase 8's job screen. Signed-in, but deliberately NOT a PROVIDER_ROUTE.
   *
   * That guard reads `user_metadata.role`, which nothing in this product ever
   * writes — the role lives on `profiles`. So every provider route is shut to
   * everybody, which is correct for the unbuilt dashboard and was a dead end
   * here: the page exists precisely to tell a professional how to link their
   * account, and it was redirecting them home before it could say so.
   *
   * Route-level gating is not the boundary anyway. `getMyProvider` returns
   * null for anyone without a linked listing, `listProviderJobs` returns
   * nothing, and the RLS policy on `bookings` limits a professional to their
   * own work. Someone signed in who reaches this page sees an empty shell and
   * their own profile id. Phase 10 tightens it against `profiles.role` once
   * provider onboarding exists to set one.
   *
   * Singular `/provider`, not `/providers`: the plural is the public
   * directory, and a bare prefix match would have swallowed it.
   */
  "/provider",
] as const;

/**
 * `/book` is deliberately NOT protected, and that changed in Phase 6.
 *
 * Booking still requires an account — the professional needs a name and a
 * number to arrive at — but the account is asked for at the fourth step, not
 * the first. A stranger describes the problem, gives the address and picks a
 * time, and only then signs in; the draft is in sessionStorage and the
 * redirect intent is in the URL, so they come back to the step they left.
 *
 * Guarding the whole route put the login wall in front of step one, which is
 * where funnels die. The flow does the guarding now, and `confirmBookingAction`
 * re-reads the session server-side, so nothing is trusted to the browser.
 */

/** Requires a session AND profiles.role = 'provider'. */
export const PROVIDER_ROUTES = ["/providers/dashboard"] as const;

function matches(rawPathname: string, routes: readonly string[]): boolean {
  const pathname = stripLocale(rawPathname);
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function isPublicRoute(pathname: string): boolean {
  // Provider routes are checked first: /providers/join is public but
  // /providers/dashboard is not, and a bare prefix match would let the
  // shorter public entry swallow both.
  if (matches(pathname, PROVIDER_ROUTES)) return false;
  return matches(pathname, PUBLIC_ROUTES);
}

export function isProtectedRoute(pathname: string): boolean {
  return matches(pathname, PROTECTED_ROUTES);
}

export function isProviderRoute(pathname: string): boolean {
  return matches(pathname, PROVIDER_ROUTES);
}

/**
 * Where to send someone after they sign in.
 *
 * Only same-origin paths are honoured — an attacker-supplied `?next=` is a
 * classic open redirect, and this value comes straight off the query string.
 *
 * Returns an **unprefixed** path. Callers add the locale back: pages through
 * `redirect` from `@/i18n/navigation`, the middleware by hand. Stripping first
 * also closes the loop that `/ne/login` would otherwise open — it does not
 * start with `/login`, so without this it would sail past the check below and
 * bounce a signed-in visitor between the two screens.
 */
export function safeRedirect(next: string | null | undefined): string {
  if (!next) return "/";

  // Browsers normalise a backslash to a forward slash inside a URL, and strip
  // tab, newline and carriage return before parsing at all. So "/\\evil.test"
  // and "/\tevil.test" both reach another origin while passing a naive
  // startsWith("//") check. Strip what the browser strips, then judge the
  // shape. Found by a test, not by review.
  const cleaned = next.replace(/[\t\n\r]/g, "");
  if (!cleaned.startsWith("/")) return "/";
  // "//host" and "/\host" are both origin jumps.
  if (/^\/[/\\]/.test(cleaned)) return "/";
  if (cleaned.includes("\\")) return "/";

  const path = stripLocale(cleaned);
  if (path.startsWith("/login") || path.startsWith("/verify")) return "/";
  return path;
}
