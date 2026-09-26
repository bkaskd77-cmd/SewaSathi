/**
 * What the live site must answer, and how each answer is judged.
 *
 * SPLIT OUT OF `check-deployed.mjs` FOR ONE REASON: that file calls `main()` at
 * module scope, so importing it to test the rules would fire the network walk.
 * The lists and the judgements are here, pure and side-effect free, so the
 * script imports them, the script's own self-test exercises them, and
 * `tests/unit/deploy-check.test.ts` can break them on purpose.
 *
 * THE GAP THIS CLOSES. `check:deployed` walked public pages only, and there is
 * no way to authenticate from a check script — the only way into this product is
 * a phone OTP, and the gateway is a launch blocker. So for four phases every
 * signed-in screen shipped with no live check of any kind: `/admin/signals`,
 * `/admin/triage-accuracy`, `/provider/jobs` and nine others could 404 in
 * production and nothing in the repository would notice. "We cannot log in"
 * became "we check nothing", which is a much bigger conclusion than the premise
 * supports.
 *
 * WHAT AN ANONYMOUS REQUEST CAN PROVE, WHICH IS MORE THAN IT LOOKS:
 *
 *   - **The page deployed.** A guarded route that 404s did not ship. That is
 *     the same question `ROUTES` asks of a public page and it needs no session.
 *   - **The guard is there.** A guarded route answering 200 to nobody is an
 *     admin screen on the open internet. This is the assertion worth having:
 *     it is a security check that happens to run in a deploy checker, and it
 *     can only be made from outside.
 *   - **The right locale's door.** `lib/auth/routes.ts` exists because a guard
 *     that only knew `/account` would leave `/ne/account` unguarded, and
 *     `middleware.ts` carries the prefix onto every redirect precisely so a
 *     Nepali reader is not dropped at the English login. Nothing has ever
 *     checked that on production. This does, per route, in both languages.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE, stated here rather than left as a
 * silence: the body. No `x-build-commit` and no `og:url` for a guarded route,
 * because we never see its HTML. That costs nothing — one deployment serves one
 * build, so the commit stamp read off `/` is the commit stamp of every route on
 * the same origin; checking it twenty times would be checking one fact twenty
 * times. It also says nothing about whether the screen is *correct*, which is
 * what the test suite is for.
 *
 * THE OBSERVABLE CONTRACT, NOT THE MECHANISM. `/verify` is a PUBLIC route that
 * redirects to the login screen from inside the page when it arrives without a
 * valid number, and `/account` is a PROTECTED route that redirects from the
 * middleware. From outside they are the same fact — an anonymous visitor does
 * not get in — so they are judged the same way. Classifying by mechanism would
 * mean this file needing to know which layer answered, which is exactly the
 * knowledge a check made from outside should not need.
 */

/**
 * Routes an anonymous visitor must be able to open. Prefixed forms are written
 * out because not every page ships in both languages by the same path.
 */
export const OPEN_ROUTES = [
  "/",
  "/services",
  "/services/plumbing",
  "/login",
  "/providers/join",
  "/providers/standards",
  "/book",
  "/about",
  "/contact",
  "/help",
  "/help/complaint",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refunds",
  /*
   * THE CARVE-OUT, PROVED LIVE FOR THE FIRST TIME. `/admin/login` sits under a
   * protected prefix and is opened by `PUBLIC_EXCEPTIONS` in
   * `lib/auth/routes.ts`. Without that exception a signed-out admin reaching it
   * is redirected to `/login?next=/admin/login` — sent through the customer
   * door to reach the admin one. It is a five-line rule guarding the way in for
   * the three accounts that can read every identity document we hold, and until
   * now it was only ever checked in a unit test.
   */
  "/admin/login",
  // Developer surface, noindex, English in both locales on purpose — and still
  // a route that either exists or does not.
  "/design-system",
  "/ne",
  "/ne/services",
  "/ne/providers/join",
  "/ne/providers/standards",
  "/ne/book",
  "/ne/about",
  "/ne/legal/terms",
  "/ne/admin/login",
];

/**
 * Routes that must send an anonymous visitor to the login screen.
 *
 * WRITTEN UNPREFIXED AND WALKED IN BOTH LANGUAGES, because the locale prefix is
 * the specific thing being checked — the expected destination differs per
 * language and getting it wrong is silent. `localesFor` is what pairs them.
 *
 * ADD A SCREEN HERE IN THE PHASE THAT SHIPS IT, and `coverageGaps` makes that
 * mechanical rather than remembered: it reads the page files and fails on any
 * static route missing from these lists.
 */
export const GUARDED_ROUTES = [
  // The customer's own pages.
  "/bookings",
  "/account",
  "/account/security",
  "/onboarding",
  // Deliberately not a PROVIDER_ROUTE — see the note in lib/auth/routes.ts.
  "/provider",
  "/provider/jobs",
  "/providers/apply",
  // Public route, page-level redirect: arriving with no number must not show
  // six code boxes that can never succeed.
  "/verify",
  // The admin surface. Twelve screens, none of which had a live check before.
  "/admin",
  "/admin/appeals",
  "/admin/applications",
  "/admin/audit",
  "/admin/claims",
  "/admin/guarantee-claims",
  "/admin/lookup",
  "/admin/mismatches",
  "/admin/signals",
  "/admin/survey-fees",
  "/admin/triage-accuracy",
];

/** Routes that must NOT exist — links removed rather than shipped. */
export const GONE_ROUTES = ["/careers", "/ne/careers"];

/** The two prefixes every guarded route is walked under. "" is English. */
export const LOCALE_PREFIXES = ["", "/ne"];

/**
 * Dynamic routes cannot be walked without inventing an id, so they are named
 * here with what covers them instead. Listed rather than silently skipped: a
 * route nobody checks should at least be a route somebody wrote down.
 */
export const NOT_WALKABLE = [
  { route: "/services/[slug]", covered: "/services/plumbing is walked" },
  { route: "/services/[slug]/[providerId]", covered: "no stable public id" },
  { route: "/legal/[slug]", covered: "/legal/terms, /privacy, /refunds are walked" },
  { route: "/bookings/[id]", covered: "needs a booking of the signed-in customer" },
  { route: "/admin/applications/[id]", covered: "needs an application id" },
  { route: "/[...rest]", covered: "the not-found catch-all" },
];

/* ------------------------------------------------------------------ *
 * The judgements
 * ------------------------------------------------------------------ */

/** The login path a redirect from `prefix` must land on. */
export function loginPathFor(prefix) {
  return `${prefix}/login`;
}

/**
 * Where a Location header actually points, as a path.
 *
 * `NextResponse.redirect` writes an absolute URL, but a relative one is legal
 * and a proxy may rewrite either. Returns null for a header that is missing or
 * unparseable rather than guessing, because "it redirected somewhere we could
 * not read" is not "it redirected to the right place".
 */
export function redirectPath(location, origin = "https://example.test") {
  if (!location) return null;
  try {
    return new URL(location, origin).pathname;
  } catch {
    return null;
  }
}

/**
 * Judge one guarded route's answer.
 *
 * Returns `{ ok, detail, failure }` — `detail` for the run's own output line,
 * `failure` (null when ok) as the sentence a human reads at the end. Every
 * branch names what is actually wrong, because "FAIL /admin/signals 200" tells
 * somebody a number and not a problem.
 */
export function judgeGuarded({ route, prefix = "", status, location }) {
  const url = `${prefix}${route}`;
  const expected = loginPathFor(prefix);

  if (status === 200) {
    return {
      ok: false,
      detail: "200 — NOT GUARDED",
      failure:
        `${url} answered 200 to a request with no session. This is not a deploy problem: ` +
        `the route is reachable by anybody on the internet. Three causes, cheapest first — ` +
        `the deployment has no Supabase keys, so middleware.ts returns early and guards ` +
        `nothing (likely on a preview, never on production); the route stopped being matched ` +
        `by PROTECTED_ROUTES in lib/auth/routes.ts; or the middleware no longer runs on it.`,
    };
  }

  if (status === 404) {
    return {
      ok: false,
      detail: "404 — did not deploy",
      failure: `${url} answered 404. The page exists in the repository, so the deploy has not landed or the route was renamed without updating this list.`,
    };
  }

  if (typeof status !== "number" || status < 300 || status > 399) {
    return {
      ok: false,
      detail: `${status}`,
      failure: `${url} answered ${status}, expected a redirect to ${expected}.`,
    };
  }

  const landed = redirectPath(location);
  if (!landed) {
    return {
      ok: false,
      detail: `${status} — no readable Location`,
      failure: `${url} answered ${status} with no Location we could read (${location ?? "header absent"}), so where it sends somebody is unknown.`,
    };
  }

  if (landed === expected) {
    return { ok: true, detail: `${status} → ${expected}`, failure: null };
  }

  /*
   * THE ONE WORTH NAMING SEPARATELY. A Nepali reader bounced to the English
   * login is the exact bug `middleware.ts` carries the prefix to prevent, and
   * it is invisible to anybody who does not read Nepali — the page works, it is
   * simply in the wrong language at the one moment somebody is trying to get in.
   */
  if (prefix === "/ne" && landed === "/login") {
    return {
      ok: false,
      detail: `${status} → /login — wrong language`,
      failure: `${url} redirects a Nepali reader to the ENGLISH login (${landed}). middleware.ts is meant to carry the /ne prefix onto every redirect.`,
    };
  }

  return {
    ok: false,
    detail: `${status} → ${landed}`,
    failure: `${url} redirects to ${landed}, expected ${expected}.`,
  };
}

/** An open route must simply be there. */
export function judgeOpen({ route, status }) {
  if (status === 200) return { ok: true, detail: "200", failure: null };
  return {
    ok: false,
    detail: String(status),
    failure: `${route} answered ${status}, expected 200.`,
  };
}

/** A removed route must stay removed. */
export function judgeGone({ route, status }) {
  if (status === 404) return { ok: true, detail: "404", failure: null };
  return {
    ok: false,
    detail: String(status),
    failure: `${route} answered ${status}, expected 404 — the page was removed but is still being served.`,
  };
}

/* ------------------------------------------------------------------ *
 * The cron targets
 * ------------------------------------------------------------------ */

/**
 * Every path `vercel.json` schedules, read from the file rather than copied.
 *
 * WHY THIS IS HERE. A cron nobody calls looks identical to a cron with nothing
 * to do. `/api/payments/reconcile` runs `sweepRedoRecovery`, which moves money
 * between us and a professional, and the only two observable outcomes of a run
 * with no debt outstanding are "wrote nothing" and "was never invoked" — the
 * same silence. Nothing in this product could tell them apart.
 *
 * DERIVED, NEVER LISTED, for the same reason `coverageGaps` reads the page
 * files: a cron added to `vercel.json` is checked the moment it exists, and a
 * hand-kept copy is correct until the first person who forgets.
 */
export function cronPaths(vercelJsonText) {
  try {
    const parsed = JSON.parse(vercelJsonText);
    const crons = Array.isArray(parsed?.crons) ? parsed.crons : [];
    return crons
      .map((c) => (typeof c?.path === "string" ? c.path : null))
      .filter((p) => typeof p === "string" && p.startsWith("/"));
  } catch {
    // A vercel.json we cannot parse is not a vercel.json with no crons in it.
    return null;
  }
}

/**
 * Judge a cron target, asked WITHOUT the secret.
 *
 * WHAT 401 PROVES: the route is deployed and it is refusing unauthenticated
 * callers. Both halves matter — a 404 means the scheduler is firing into
 * nothing every night and the log would show a successful invocation of a page
 * that does not exist, and a 200 means anybody on the internet can make us
 * hammer a payment gateway and run a money sweep.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE, said here so nobody reads more into a
 * green line than it carries. Two things:
 *
 *   - **That `CRON_SECRET` is set.** The handler answers 401 both when the
 *     offered secret is wrong and when no secret is configured at all — it
 *     refuses rather than running open, which is the right behaviour and makes
 *     the two indistinguishable from outside. `/api/health?deep=1` is what
 *     tells you the secret works, because it needs the real one.
 *   - **That the cron ever fired.** Reachability is a precondition, not
 *     evidence. Only Vercel's own cron log says a schedule ran.
 */
export function judgeCron({ path, status }) {
  if (status === 401) {
    return { ok: true, detail: "401 — deployed and guarded", failure: null };
  }

  if (status === 404) {
    return {
      ok: false,
      detail: "404 — the cron fires into nothing",
      failure:
        `${path} is scheduled in vercel.json and answers 404. The scheduler invokes it on ` +
        `its cron and gets a missing page every time, which in Vercel's log reads as an ` +
        `invocation that happened. Either the route did not deploy or the path in ` +
        `vercel.json no longer matches the handler.`,
    };
  }

  if (status === 200) {
    return {
      ok: false,
      detail: "200 — OPEN TO ANYBODY",
      failure:
        `${path} ran for a request carrying no secret. This route reconciles payments and ` +
        `sweeps money between us and professionals; open, it is a way for anybody to make ` +
        `us hammer a gateway. CRON_SECRET must be required, and the handler must refuse ` +
        `rather than run when it is unset.`,
    };
  }

  if (status === 405) {
    return {
      ok: false,
      detail: "405 — wrong method",
      failure: `${path} answered 405. The check must ask the way the scheduler does; Vercel invokes a cron with GET.`,
    };
  }

  return {
    ok: false,
    detail: String(status),
    failure: `${path} answered ${status}, expected 401 from an unauthenticated caller.`,
  };
}

/* ------------------------------------------------------------------ *
 * Is anything unchecked?
 * ------------------------------------------------------------------ */

/**
 * Turn a page file's repository path into the route it serves.
 *
 * Route groups — `(app)`, `(admin)`, `(work)` — are organisation and not URL,
 * so they are dropped. Returns null for a file that cannot be walked without
 * inventing a value, which is what `NOT_WALKABLE` records instead.
 */
export function routeForPageFile(file) {
  const withoutRoot = file
    .replace(/^app\/\[locale\]/, "")
    .replace(/\/page\.tsx?$/, "");
  const segments = withoutRoot
    .split("/")
    .filter((s) => s.length > 0 && !/^\(.*\)$/.test(s));
  if (segments.some((s) => s.startsWith("["))) return null;
  return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
}

/**
 * Static page routes that no list covers.
 *
 * ONE DIRECTION ONLY, DELIBERATELY. A route listed here that no longer exists
 * is caught by the walk itself — it 404s — so a reverse check would be a second
 * implementation of a question the network already answers. The direction the
 * network can NEVER answer is the one this covers: a page that shipped and was
 * never added to a list is a page no request is ever made to, and its absence
 * looks exactly like success.
 *
 * `pageFiles` are repository-relative paths; kept as an argument so this is
 * pure and the test can hand it a synthetic tree.
 */
export function coverageGaps(pageFiles) {
  const unprefixed = (route) => route.replace(/^\/ne(?=\/|$)/, "") || "/";
  const covered = new Set([
    ...OPEN_ROUTES.map(unprefixed),
    ...GUARDED_ROUTES,
  ]);

  const gaps = [];
  for (const file of pageFiles) {
    const route = routeForPageFile(file);
    if (route === null) continue;
    if (covered.has(route)) continue;
    gaps.push({ route, file });
  }
  return gaps.sort((a, b) => a.route.localeCompare(b.route));
}
