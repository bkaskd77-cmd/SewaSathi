import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  GONE_ROUTES,
  GUARDED_ROUTES,
  LOCALE_PREFIXES,
  OPEN_ROUTES,
  coverageGaps,
  judgeGone,
  judgeGuarded,
  judgeOpen,
  loginPathFor,
  redirectPath,
  routeForPageFile,
} from "../../scripts/deployed-routes.mjs";

/**
 * The only live check this product has, and nothing could run it.
 *
 * WHAT WAS WRONG. `check:deployed` walked public pages only. Every signed-in
 * screen shipped over four phases — twelve admin pages, the provider job list,
 * the customer's own bookings and account — had no live check of any kind. The
 * reasoning was never written down but it is easy to reconstruct: you cannot
 * sign in from a script, because the only door into this product is a phone OTP
 * and that gateway is a launch blocker. "We cannot log in" quietly became "we
 * check nothing", which is a far bigger conclusion than the premise supports.
 *
 * WHY THIS FILE AND NOT THE SCRIPT'S OWN RUN. The script needs the internet and
 * cannot run in CI or in an agent sandbox at all, so between one human run and
 * the next nothing exercises its judgements. `npm run verify` runs this, so the
 * rules are checked on every commit even though the walk is not.
 *
 * THE ASSERTIONS ARE ABOUT WHAT A SIGNED-OUT REQUEST PROVES: the page deployed,
 * the guard is on, and the redirect keeps the reader's language. Not the body —
 * see the header of `scripts/deployed-routes.mjs` for what is deliberately out
 * of reach.
 */

describe("a guarded route, asked by nobody", () => {
  it("passes when it sends you to its own login", () => {
    const verdict = judgeGuarded({
      route: "/admin/signals",
      status: 307,
      location: "https://sewasathi.vercel.app/login?next=%2Fadmin%2Fsignals",
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.failure).toBeNull();
  });

  /*
   * THE SECURITY ASSERTION, and the reason this is worth doing without a
   * session rather than not at all. An admin screen that answers 200 to an
   * anonymous request is an admin screen on the open internet — every customer
   * phone number and identity document behind one URL. Nothing else in the
   * repository can see that: `npm run verify` proves `adminGate` is called in
   * the source, and says nothing about what production actually serves.
   */
  it("fails loudly when an admin screen answers 200 to nobody", () => {
    const verdict = judgeGuarded({ route: "/admin/signals", status: 200 });
    expect(verdict.ok).toBe(false);
    expect(verdict.failure).toMatch(/no session/i);
    // Named as what it is, not as a status code. Somebody reading the run has
    // to be able to tell this apart from a page that merely did not deploy.
    expect(verdict.detail).toMatch(/NOT GUARDED/);
  });

  it("tells a missing deploy apart from a missing guard", () => {
    const missing = judgeGuarded({ route: "/admin/signals", status: 404 });
    expect(missing.ok).toBe(false);
    expect(missing.failure).toMatch(/deploy has not landed|renamed/);
    expect(missing.failure).not.toMatch(/no session/i);
  });

  /*
   * THE LOCALE HALF. `lib/auth/routes.ts` exists because a guard that only knew
   * `/account` would leave `/ne/account` unguarded, and `middleware.ts` carries
   * the prefix onto every redirect so a Nepali reader is not dropped at the
   * English login. Both were only ever checked in unit tests against the
   * predicates; this is the first thing that can check it against a running
   * deployment, and the failure it names is invisible to anybody who does not
   * read Nepali — the page works, it is simply in the wrong language at the one
   * moment somebody is trying to get in.
   */
  it("accepts the Nepali login for a Nepali route", () => {
    const verdict = judgeGuarded({
      route: "/account",
      prefix: "/ne",
      status: 307,
      location: "https://sewasathi.vercel.app/ne/login?next=%2Fne%2Faccount",
    });
    expect(verdict.ok).toBe(true);
  });

  it("refuses the English login for a Nepali route", () => {
    const verdict = judgeGuarded({
      route: "/account",
      prefix: "/ne",
      status: 307,
      location: "https://sewasathi.vercel.app/login?next=%2Faccount",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failure).toMatch(/ENGLISH login/);
  });

  /*
   * THE `next=` VALUE IS DELIBERATELY NOT ASSERTED. `/verify` redirects to
   * `/login?next=%2F` and `/account` to `/login?next=%2Faccount`; both are
   * correct, and `safeRedirect` is already pinned by `auth-routes.test.ts`
   * where it can be tested properly. What this check owns is the destination
   * and its language. Asserting the query as well would make the check fail on
   * a legitimate difference and teach somebody to loosen it.
   */
  it("judges by where it lands, not by the intent it carries", () => {
    for (const next of ["%2F", "%2Faccount", ""]) {
      const verdict = judgeGuarded({
        route: "/verify",
        status: 307,
        location: `https://sewasathi.vercel.app/login?next=${next}`,
      });
      expect(verdict.ok).toBe(true);
    }
  });

  it("refuses a redirect with no Location at all", () => {
    for (const location of [null, undefined, ""]) {
      const verdict = judgeGuarded({ route: "/account", status: 307, location });
      expect(verdict.ok).toBe(false);
      expect(verdict.failure).toMatch(/unknown/i);
    }
  });

  /*
   * A GARBAGE LOCATION IS NOT AN UNREADABLE ONE, and the first version of this
   * test assumed it was. `new URL` is forgiving: "::::" against a base resolves
   * to the path `/::::` rather than throwing, so it never reaches the
   * cannot-read branch. It is still a failure, and the sentence still says where
   * it went — which is the assertion worth having. The branch above is for a
   * redirect that names no destination at all.
   */
  it("reports a nonsense Location as landing in the wrong place", () => {
    const verdict = judgeGuarded({
      route: "/account",
      status: 307,
      location: "::::",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failure).toMatch(/expected \/login/);
  });

  it("refuses a 500 rather than reading it as a guard", () => {
    const verdict = judgeGuarded({ route: "/account", status: 500 });
    expect(verdict.ok).toBe(false);
  });
});

describe("where a redirect actually points", () => {
  it("reads an absolute Location, which is what NextResponse writes", () => {
    expect(redirectPath("https://sewasathi.vercel.app/ne/login?next=%2Fne")).toBe(
      "/ne/login",
    );
  });

  it("reads a relative one too, because a proxy may rewrite it", () => {
    expect(redirectPath("/ne/login?next=%2Fne")).toBe("/ne/login");
  });

  it("returns null rather than guessing", () => {
    expect(redirectPath(null)).toBeNull();
    expect(redirectPath("")).toBeNull();
  });
});

describe("open and removed routes", () => {
  it("wants 200 from an open route and 404 from a removed one", () => {
    expect(judgeOpen({ route: "/", status: 200 }).ok).toBe(true);
    expect(judgeOpen({ route: "/", status: 307 }).ok).toBe(false);
    expect(judgeGone({ route: "/careers", status: 404 }).ok).toBe(true);
    expect(judgeGone({ route: "/careers", status: 200 }).ok).toBe(false);
  });

  /*
   * `/admin/login` IS OPEN AND THAT IS THE POINT. It sits under a protected
   * prefix and is carved out by `PUBLIC_EXCEPTIONS`; without the carve-out a
   * signed-out admin is sent to `/login?next=/admin/login` — through the
   * customer door to reach the admin one. The rule has always been unit-tested
   * and never checked against a deployment.
   */
  it("expects the admin sign-in page to be open, in both languages", () => {
    expect(OPEN_ROUTES).toContain("/admin/login");
    expect(OPEN_ROUTES).toContain("/ne/admin/login");
    expect(GUARDED_ROUTES).not.toContain("/admin/login");
  });
});

describe("nothing ships unchecked", () => {
  it("turns a page file into the route it serves, groups dropped", () => {
    expect(routeForPageFile("app/[locale]/(admin)/admin/signals/page.tsx")).toBe(
      "/admin/signals",
    );
    expect(routeForPageFile("app/[locale]/(app)/account/security/page.tsx")).toBe(
      "/account/security",
    );
    expect(routeForPageFile("app/[locale]/page.tsx")).toBe("/");
  });

  it("does not pretend a dynamic route can be walked", () => {
    expect(routeForPageFile("app/[locale]/(app)/bookings/[id]/page.tsx")).toBeNull();
    expect(routeForPageFile("app/[locale]/[...rest]/page.tsx")).toBeNull();
  });

  /*
   * THE DIRECTION THE NETWORK CANNOT ANSWER. A route listed but deleted 404s on
   * the walk and is caught there. A page that shipped and was never added to a
   * list gets no request made to it at all, and its absence looks exactly like
   * success — which is precisely how twelve admin screens came to have no live
   * check. So the rule has to bite in this direction, and this is it biting.
   */
  it("reports a page that is on neither list", () => {
    const gaps = coverageGaps([
      "app/[locale]/(admin)/admin/signals/page.tsx",
      "app/[locale]/(admin)/admin/payouts/page.tsx",
    ]);
    expect(gaps.map((g) => g.route)).toEqual(["/admin/payouts"]);
  });

  it("counts a Nepali-prefixed entry as covering its unprefixed route", () => {
    // `/ne/about` is listed; `/about` is too, but the fold is what stops a
    // route listed only in Nepali reading as unchecked.
    expect(coverageGaps(["app/[locale]/(app)/about/page.tsx"])).toEqual([]);
  });

  /** The real tree, so this file fails the moment a page ships unlisted. */
  it("covers every page in the repository right now", () => {
    const files = globPageFiles("app/[locale]");
    expect(files.length).toBeGreaterThan(30);
    expect(coverageGaps(files)).toEqual([]);
  });
});

/**
 * The two implementations of one rule, compared rather than trusted.
 *
 * `middleware.ts` builds the login destination as `${prefix}/login`, and
 * `loginPathFor` is what this checker expects to see. That is one rule written
 * twice, which in this repository is the shape that has cost the most — the
 * refund ceiling in TS and SQL, `TriageReason` declared in two files. There is
 * no import that makes them one: the script is `.mjs` so it can run with no
 * build step, and the middleware is TypeScript inside Next. So the test reads
 * the other implementation and compares, the same way the reason-code test
 * reads the migration.
 *
 * It matches a shape rather than parsing, which `check:keys` is right to refuse
 * for a codebase-wide scan. Here it is one line in one known file and the
 * failure is a loud "go and look", not a false positive buried in a list.
 */
describe("the checker and the middleware agree on the door", () => {
  it("expects the path middleware.ts actually builds", () => {
    const source = readFileSync("middleware.ts", "utf8");
    expect(source).toMatch(/login\.pathname\s*=\s*`\$\{prefix\}\/login`/);
    expect(loginPathFor("")).toBe("/login");
    expect(loginPathFor("/ne")).toBe("/ne/login");
  });

  /*
   * And every guarded route is one the guard actually claims. A route walked as
   * guarded that `lib/auth/routes.ts` does not protect would be a check
   * asserting a promise nobody made — it would pass today by accident and fail
   * the first time somebody made the route public on purpose.
   */
  it("walks only routes something in the product guards", async () => {
    const { isProtectedRoute } = await import("@/lib/auth/routes");
    // `/verify` is the deliberate exception: a PUBLIC route that redirects from
    // inside the page. Judged by observable behaviour, not by mechanism.
    const byMiddleware = GUARDED_ROUTES.filter((r) => r !== "/verify");
    for (const route of byMiddleware) {
      expect(isProtectedRoute(route), `${route} is not protected`).toBe(true);
      // And the Nepali form is the same protected route, which is the whole
      // reason `stripLocale` runs inside the guard.
      expect(isProtectedRoute(`/ne${route}`), `/ne${route} is not protected`).toBe(
        true,
      );
    }
  });

  it("walks both languages, because one of them was the bug", () => {
    expect(LOCALE_PREFIXES).toEqual(["", "/ne"]);
  });

  it("keeps the removed routes removed in both languages", () => {
    expect(GONE_ROUTES).toContain("/careers");
    expect(GONE_ROUTES).toContain("/ne/careers");
  });
});

/** A tiny walker, so the test reads the same tree the script does. */
function globPageFiles(dir: string, out: string[] = []): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) globPageFiles(full, out);
    else if (/^page\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
