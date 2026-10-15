import { describe, expect, it } from "vitest";

import {
  CACHE_RULE,
  PRECACHE_PATHS,
  cachePolicy,
  type CacheQuestion,
} from "@/lib/pwa/cache-rule";
import { serviceWorkerSource } from "@/lib/pwa/worker-source";
import { PROTECTED_ROUTES, PROVIDER_ROUTES } from "@/lib/auth/routes";

/**
 * THE SERVICE WORKER CANNOT SERVE A STALE PRICE, ASSERTED OVER EVERY ROUTE
 * RATHER THAN OVER A FIXTURE.
 *
 * A cache rule tested on three example paths proves nothing about the fourth,
 * and the fourth is the one somebody adds in the phase after this. So the
 * routes come from `scripts/deployed-routes.mjs` — the same two lists
 * `check:deployed` walks and `coverageGaps` refuses to let go stale — and every
 * single one of them must be `never`. When a screen is added, it is added to
 * those lists (the deploy check fails otherwise) and this test covers it the
 * same day with nobody deciding to.
 */

const GET = (pathname: string, over: Partial<CacheQuestion> = {}): CacheQuestion => ({
  method: "GET",
  sameOrigin: true,
  pathname,
  navigation: false,
  ...over,
});

async function routeLists(): Promise<{ open: string[]; guarded: string[] }> {
  const mod = await import("../../scripts/deployed-routes.mjs");
  return { open: mod.OPEN_ROUTES, guarded: mod.GUARDED_ROUTES };
}

describe("no document for a real route is ever cached", () => {
  it("refuses every public route the deploy check walks", async () => {
    const { open } = await routeLists();
    expect(open.length).toBeGreaterThan(20);

    for (const route of open) {
      expect(
        cachePolicy(GET(route, { navigation: true }), CACHE_RULE),
        `${route} as a navigation`,
      ).toBe("never");
      /*
       * AND AS A NON-NAVIGATION TOO, which is the case that is easy to miss: a
       * client-side route change fetches the RSC payload for the same path with
       * `mode: "cors"`, not `"navigate"`. If only navigations were refused, the
       * worker would happily store the React payload of `/services/plumbing` —
       * the published price band — and serve it on the next soft navigation.
       * The prices are in that payload exactly as they are in the document.
       */
      expect(cachePolicy(GET(route), CACHE_RULE), `${route} as a fetch`).toBe(
        "never",
      );
    }
  });

  it("refuses every guarded route, in both languages", async () => {
    const { guarded } = await routeLists();
    expect(guarded.length).toBeGreaterThan(20);

    for (const route of guarded) {
      for (const path of [route, `/ne${route}`]) {
        expect(
          cachePolicy(GET(path, { navigation: true }), CACHE_RULE),
          `${path} as a navigation`,
        ).toBe("never");
        expect(cachePolicy(GET(path), CACHE_RULE), `${path} as a fetch`).toBe(
          "never",
        );
      }
    }
  });

  it("refuses the money screens by name, so the list cannot go quiet", async () => {
    /*
     * NAMED AS WELL AS SWEPT. The sweep above is the real guard, and it is only
     * as good as the lists it reads — a refactor that emptied one would leave
     * every assertion above passing over nothing. These are the paths where a
     * stale number costs somebody money, written out so a broken sweep still
     * fails.
     */
    const money = [
      "/bookings",
      "/bookings/9f1c2d3e-0000-4000-8000-000000000000",
      "/provider",
      "/provider/jobs",
      "/provider/payouts",
      "/admin/payouts",
      "/admin/revenue",
      "/admin/bands",
      "/admin/guarantee-claims",
      "/book",
      "/services/plumbing",
      "/api/triage",
      "/api/payments/reconcile",
      "/api/health",
    ];

    for (const path of money) {
      expect(cachePolicy(GET(path), CACHE_RULE), path).toBe("never");
      expect(
        cachePolicy(GET(path, { navigation: true }), CACHE_RULE),
        path,
      ).toBe("never");
      expect(cachePolicy(GET(`/ne${path}`), CACHE_RULE), `/ne${path}`).toBe(
        "never",
      );
    }
  });

  it("refuses a route nobody has written yet", () => {
    // `never` is the default rather than a list, so an unlisted path is refused
    // by arriving rather than by being remembered.
    expect(cachePolicy(GET("/wallet/balance"), CACHE_RULE)).toBe("never");
    expect(cachePolicy(GET("/_next/image?url=x"), CACHE_RULE)).toBe("never");
    expect(cachePolicy(GET("/_next/data/build/bookings.json"), CACHE_RULE)).toBe(
      "never",
    );
  });

  it("refuses anything that is not a plain same-origin GET", () => {
    expect(cachePolicy(GET("/_next/static/chunk.js", { method: "POST" }), CACHE_RULE)).toBe(
      "never",
    );
    expect(
      cachePolicy(GET("/_next/static/chunk.js", { sameOrigin: false }), CACHE_RULE),
    ).toBe("never");
    // A Supabase read is cross-origin, and it carries personal data.
    expect(
      cachePolicy(
        GET("/rest/v1/bookings", { sameOrigin: false }),
        CACHE_RULE,
      ),
    ).toBe("never");
  });
});

describe("what it does keep", () => {
  it("keeps content-hashed build output", () => {
    expect(cachePolicy(GET("/_next/static/chunks/main-abc123.js"), CACHE_RULE)).toBe(
      "immutable",
    );
    expect(
      cachePolicy(GET("/_next/static/media/noto-sans-devanagari-x.woff2"), CACHE_RULE),
    ).toBe("immutable");
  });

  it("keeps the shell, the manifest and the icons, and nothing else", () => {
    for (const path of PRECACHE_PATHS) {
      expect(cachePolicy(GET(path), CACHE_RULE), path).toBe("precache");
    }
    expect(PRECACHE_PATHS).toHaveLength(6);
  });

  it("will not serve the stored shell to somebody who is online", () => {
    /*
     * WHAT THE NAVIGATION CHECK IS FOR, pinned because deleting it does not
     * break anything else — which was established by deleting it. Containment
     * comes from the default; this line is why a visitor with a working
     * connection reads the live `/offline` rather than the copy stored at
     * install, and without the case it would read as a redundant guard.
     */
    expect(cachePolicy(GET("/offline", { navigation: true }), CACHE_RULE)).toBe(
      "never",
    );
    expect(cachePolicy(GET("/ne/offline", { navigation: true }), CACHE_RULE)).toBe(
      "never",
    );
    // And it is still the shell when the worker asks for it to store it.
    expect(cachePolicy(GET("/offline"), CACHE_RULE)).toBe("precache");
  });

  it("precaches no page that can carry data", () => {
    /*
     * THE ONE HTML DOCUMENT STORED IS THE OFFLINE PAGE, and this is the
     * assertion that keeps it that way: no precached path may be a route this
     * product guards, and the only precached pages are the two offline ones.
     * Adding, say, `/bookings` to the shell "so it works offline" fails here
     * rather than in production.
     */
    /*
     * COMPARED AS PLAIN STRINGS, and the cast is the interesting part: with
     * today's two lists TypeScript reports the comparison as impossible,
     * because no literal in one appears in the other. That is the compiler
     * agreeing with the assertion rather than making it redundant — the moment
     * somebody adds `/bookings` to the shell the union widens and the check is
     * the only thing standing between that and a cached booking list.
     */
    const guardedPrefixes: string[] = [...PROTECTED_ROUTES, ...PROVIDER_ROUTES];
    for (const path of PRECACHE_PATHS as readonly string[]) {
      for (const guarded of guardedPrefixes) {
        expect(
          path === guarded || path.startsWith(`${guarded}/`),
          `${path} is under the guarded route ${guarded}`,
        ).toBe(false);
      }
    }

    const pages = (PRECACHE_PATHS as readonly string[]).filter(
      (path) => !path.startsWith("/icons/") && path !== "/manifest.webmanifest",
    );
    expect(pages).toEqual(["/offline", "/ne/offline"]);
  });
});

describe("the worker runs the same rule, not a copy of it", () => {
  const source = serviceWorkerSource("abc1234");

  it("pastes the function's own source text", () => {
    expect(source).toContain(cachePolicy.toString());
  });

  it("binds the paste to a name of its own, never the function's", () => {
    /*
     * THIS IS THE ASSERTION THAT WAS MISSING WHEN THE WORKER SHIPPED BROKEN.
     * `next build` minified `cachePolicy` to `function f(a,b){…}`, so the
     * generated script defined `f` and called `cachePolicy` — a ReferenceError
     * on the first fetch, a discarded worker, and a product that works
     * perfectly with no offline support and nothing in any log.
     */
    expect(source).toContain("const decideCache = ");
    expect(source).toContain("decideCache(");
    // The call site must not name the function, because its name is not ours.
    expect(source.includes("\n  const verdict = cachePolicy(")).toBe(false);
  });

  it("defines everything the pasted body reads", () => {
    /*
     * The body closes over nothing — see `CacheRule`'s note on minification —
     * so what has to be true is that the generated call site passes the rule
     * in. Asserting the paste alone would pass with the worker calling it
     * wrongly.
     */
    expect(source).toContain("const CACHE_RULE = ");
    expect(source).toContain("CACHE_RULE,");
  });

  it("carries the build commit as its cache name", () => {
    expect(source).toContain('const VERSION = "abc1234"');
    expect(source).toContain('const CACHE = "sajilokaam-" + VERSION');
    expect(serviceWorkerSource("def5678")).toContain('"def5678"');
  });

  /**
   * Run a generated worker in a stub environment and report, per request,
   * whether it took the request (`"handled"`) or left it to the browser.
   */
  function runWorker(script: string) {
    const listeners: Record<string, (event: unknown) => void> = {};
    const self = {
      addEventListener(name: string, fn: (event: unknown) => void) {
        listeners[name] = fn;
      },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      location: { origin: "https://sewasathi.test" },
    };
    const caches = {
      open: () =>
        Promise.resolve({ addAll: () => Promise.resolve(), put: () => Promise.resolve() }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match: () => Promise.resolve(undefined),
    };

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const load = new Function("self", "caches", "fetch", "Response", "URL", script);
    load(self, caches, () => Promise.resolve({}), class {}, URL);

    return (request: { url: string; method: string; mode: string }) => {
      let verdict: string | null = null;
      listeners.fetch({
        request,
        respondWith: () => {
          verdict = "handled";
        },
      });
      return verdict;
    };
  }

  it("still works when the compiler renames the rule", () => {
    /*
     * THE PRODUCTION FAILURE, REPRODUCED. `next build` minified `cachePolicy`
     * to `function f(a,b){…}` and the generated script went on calling it by
     * the name it no longer had. Nothing in the suite could see it: vitest does
     * not minify, so the paste and the call site agreed in every test and
     * disagreed in the only build anybody runs.
     *
     * So the rule's source is handed in here under a name no part of the
     * generator knows, exactly as a minifier would leave it. It is the one
     * test that would have been red on the broken commit.
     */
    const renamed = cachePolicy
      .toString()
      .replace(/^(export\s+)?function\s+\w+/, "function zz");
    expect(renamed).toContain("function zz");

    const ask = runWorker(serviceWorkerSource("abc1234", renamed));

    expect(
      ask({ url: "https://sewasathi.test/provider/payouts", method: "GET", mode: "cors" }),
    ).toBe(null);
    expect(
      ask({
        url: "https://sewasathi.test/_next/static/chunks/main-abc.js",
        method: "GET",
        mode: "cors",
      }),
    ).toBe("handled");
  });

  it("still works when the rule arrives as an arrow with no name at all", () => {
    // A different compiler, or a different Next release, may emit this shape.
    // The binding must not care.
    const arrow =
      "(question, rule) => { if (question.method !== 'GET') return 'never';" +
      " if (!question.sameOrigin) return 'never';" +
      " if (question.navigation) return 'never';" +
      " for (const p of rule.precache) if (question.pathname === p) return 'precache';" +
      " return question.pathname.startsWith(rule.staticPrefix) ? 'immutable' : 'never'; }";

    const ask = runWorker(serviceWorkerSource("abc1234", arrow));
    expect(ask({ url: "https://sewasathi.test/bookings", method: "GET", mode: "cors" })).toBe(
      null,
    );
    expect(
      ask({
        url: "https://sewasathi.test/_next/static/chunks/main-abc.js",
        method: "GET",
        mode: "cors",
      }),
    ).toBe("handled");
  });

  it("executes, and routes the same way the rule does", async () => {
    /*
     * THE PASTE IS EVALUATED RATHER THAN ONLY MATCHED. A `toString()` that
     * arrived mangled — by a minifier renaming a free identifier, which is the
     * failure `CacheRule` exists to prevent — would satisfy every assertion
     * above and throw on the worker's first fetch, which presents as no worker
     * at all: every page still works and the offline shell silently never
     * appears. So the script is run in a stub environment and asked what it
     * decides.
     */
    const listeners: Record<string, (event: unknown) => void> = {};
    const answered: { verdict: string | null } = { verdict: null };

    const stub = {
      addEventListener(name: string, fn: (event: unknown) => void) {
        listeners[name] = fn;
      },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      location: { origin: "https://sewasathi.test" },
    };

    // eslint-disable-next-line no-new-func
    const run = new Function(
      "self",
      "caches",
      "fetch",
      "Response",
      "URL",
      `${source}\nreturn { listeners: null };`,
    );

    const caches = {
      open: () => Promise.resolve({ addAll: () => Promise.resolve(), put: () => Promise.resolve() }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match: () => Promise.resolve(undefined),
    };

    expect(() =>
      run(stub, caches, () => Promise.resolve({}), class {}, URL),
    ).not.toThrow();
    expect(typeof listeners.fetch).toBe("function");

    /** Fire one fetch event and report whether the worker took the request. */
    const ask = (request: { url: string; method: string; mode: string }) => {
      answered.verdict = null;
      listeners.fetch({
        request,
        respondWith: () => {
          answered.verdict = "handled";
        },
      });
      return answered.verdict;
    };

    // A money page: the worker must not take it as a non-navigation at all.
    expect(
      ask({
        url: "https://sewasathi.test/provider/payouts",
        method: "GET",
        mode: "cors",
      }),
    ).toBe(null);

    // A hashed chunk: taken.
    expect(
      ask({
        url: "https://sewasathi.test/_next/static/chunks/main-abc.js",
        method: "GET",
        mode: "cors",
      }),
    ).toBe("handled");

    // A navigation: taken, because it needs the offline fallback on failure.
    expect(
      ask({
        url: "https://sewasathi.test/bookings",
        method: "GET",
        mode: "navigate",
      }),
    ).toBe("handled");

    // A POST, even to a cacheable-looking path: left alone.
    expect(
      ask({
        url: "https://sewasathi.test/_next/static/chunks/main-abc.js",
        method: "POST",
        mode: "cors",
      }),
    ).toBe(null);
  });

  it("serves itself with no-store, so an update can always land", async () => {
    const { GET: handler } = await import("@/app/sw.js/route");
    const response = handler();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Type")).toContain("text/javascript");
    expect(response.headers.get("Service-Worker-Allowed")).toBe("/");
  });
});
