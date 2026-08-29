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
  // Booking requires an account: the professional needs a name and a number to
  // arrive at. Being on this list is what makes /login send them back here
  // with the provider and urgency still in the URL.
  "/book",
] as const;

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
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  const path = stripLocale(next);
  if (path.startsWith("/login") || path.startsWith("/verify")) return "/";
  return path;
}
