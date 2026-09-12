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
   * That guard now reads `profiles.role` (it used to read the token's
   * `user_metadata`, which its owner can write). This page is still kept out
   * of it on purpose: it exists precisely to tell a professional how to link
   * their account, and somebody who has applied but not yet been approved is
   * still a `customer` — gating it on role would redirect them home before it
   * could say so, which is the dead end it was built to remove.
   *
   * Route-level gating is not the boundary anyway. `getMyProvider` returns
   * null for anyone without a linked listing, `listProviderJobs` returns
   * nothing, and the RLS policy on `bookings` limits a professional to their
   * own work. Someone signed in who reaches this page sees an empty shell and
   * their own profile id.
   *
   * Singular `/provider`, not `/providers`: the plural is the public
   * directory, and a bare prefix match would have swallowed it.
   */
  "/provider",
  /*
   * Phase 10's application. Signed in, because the phone step IS the OTP we
   * already have — asking for a number twice would be asking a tradesperson to
   * prove the same thing twice on a form that is already long.
   *
   * Plural `/providers/apply`, and it sits under the public `/providers/join`
   * prefix without being swallowed by it: `matches` compares whole segments,
   * and `isPublicRoute` lists `/providers/join` exactly rather than
   * `/providers`.
   */
  "/providers/apply",
  /*
   * The reviewer's queue. Route-level gating is not the boundary — every
   * table it reads is admin-only under RLS, and the page re-reads
   * `profiles.role` server-side. This keeps a signed-out visitor from
   * reaching a shell at all.
   */
  "/admin",
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
 * Does this role open the provider routes?
 *
 * Its own function, beside the route lists, because it is the decision the
 * middleware actually makes and a middleware is awkward to test. The role must
 * come from `profiles` — **never from the token's `user_metadata`**, which its
 * own owner can write with `supabase.auth.updateUser({ data: ... })` from any
 * signed-in browser. That is what this used to read, which made the guard ask
 * the person being guarded what they were allowed to do.
 *
 * Null is "not a provider": no profile, no session, or a read that failed all
 * mean the same thing to a guard, and the safe answer to an unanswerable
 * question is no.
 *
 * Admins pass because an admin who cannot open a provider screen cannot
 * support a professional who is standing in somebody's kitchen.
 */
export function roleOpensProviderRoutes(role: string | null): boolean {
  return role === "provider" || role === "admin";
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

/**
 * Where somebody lands after signing in, once `safeRedirect` has judged the
 * `?next=` they arrived with.
 *
 * ONE RULE: AN EXPLICIT DESTINATION ALWAYS WINS. Somebody who tapped "book",
 * was sent here to sign in and came back is going to their booking whatever
 * else they are — a professional's own plumbing emergency is still a booking,
 * and overriding it with their jobs would lose the draft they were mid-way
 * through.
 *
 * The role only decides when nothing was asked for. Before this, a
 * professional signing in cold landed on the customer homepage and had to go
 * looking for the working half of the product, which for a tradesperson
 * opening the app between two jobs is the whole app being in the wrong place.
 *
 * Pure and separate from the form so the rule can be tested, rather than being
 * three lines inside a component nobody can call.
 */
export function landingFor(input: {
  /** Already through `safeRedirect`, so "/" means "they did not say". */
  next: string;
  worksHere: boolean;
}): string {
  if (input.next !== "/") return input.next;
  return input.worksHere ? "/provider/jobs" : "/";
}
