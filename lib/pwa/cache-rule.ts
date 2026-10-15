/**
 * What the service worker is allowed to keep, and the one question it asks.
 *
 * THE DANGER A SERVICE WORKER ADDS TO THIS PRODUCT IS NOT STALENESS IN GENERAL,
 * IT IS A STALE PRICE. Everything a customer reads as a number — a quoted band,
 * a final amount, what a professional is owed, a payout, a refund ceiling —
 * arrives inside an HTML document or a JSON response. A worker that caches
 * documents "for offline" would therefore serve last week's quote with a fresh
 * page's confidence, from inside the browser, with no request for any server to
 * see. That is worse than being offline: offline is a state somebody can read,
 * and a stale page is one they cannot.
 *
 * SO THE RULE IS NOT "NETWORK-FIRST FOR DYNAMIC PAGES", WHICH IS THE USUAL
 * SHAPE AND IS A PROMISE ABOUT ORDERING RATHER THAN ABOUT CONTENT. Network-first
 * still writes the document into a cache, which means the stale copy exists and
 * is one failed request away from being served. This worker never puts a
 * document for a real route into a cache at all. Nothing can go stale that was
 * never stored, which is a structural answer rather than a careful one, and it
 * is the only kind worth having over money.
 *
 * WHAT IS LEFT IS GENUINELY IMMUTABLE OR GENUINELY EMPTY.
 *
 *   `immutable` is `/_next/static/**` and nothing else. Those URLs are
 *   content-hashed by the build, so a changed file is a changed URL and a stale
 *   response cannot be addressed. The fonts live there too (next/font
 *   self-hosts at build time), which matters on a Nepali connection: the
 *   Devanagari face is the largest asset in the product.
 *
 *   `precache` is the offline page, the manifest and the icons. The offline
 *   page is the only HTML this worker stores, and it is built to contain no
 *   product data of any kind — no session, no price, no booking, not even a
 *   count. `tests/unit/pwa-cache-rule.test.ts` is what holds that true: it runs
 *   this rule over every route the product has, from the same lists
 *   `check:deployed` walks, and fails unless every one of them is `never`.
 *
 *   `never` is everything else, and it is the default rather than a list. A
 *   route added tomorrow is uncached without anybody remembering to say so,
 *   which is the opposite way round from a deny-list — and a deny-list of
 *   money pages is exactly the artefact that would be one phase out of date.
 *
 * PURE AND SELF-CONTAINED ON PURPOSE, with no imports at all. The service
 * worker is a separate script in a separate global, so this function's own
 * source text is serialised into it by `app/sw.js/route.ts` — the worker and
 * the test therefore run the same characters, and a test asserts that they do.
 * A rule reimplemented in the worker is the one-list-written-twice sin with a
 * cache attached, and it would fail silently: the wrong answer there looks
 * exactly like a working application.
 */

import precachePaths from "./precache-paths.json";

/** What may be stored, and under which discipline. */
export type CacheVerdict =
  /** Stored at install, served when the network cannot be reached. */
  | "precache"
  /** Content-hashed build output. Cache-first, because the URL names the bytes. */
  | "immutable"
  /** Never stored, never read from a cache. The network or nothing. */
  | "never";

/**
 * The paths stored at install time.
 *
 * BOTH LANGUAGES, BECAUSE AN OFFLINE PAGE IN THE WRONG LANGUAGE IS A SECOND
 * FAILURE. Somebody whose phone is set to Nepali and whose signal has gone is
 * the reader least able to absorb an English apology, and this is the one
 * screen guaranteed to be read in a bad moment. `localeDetection` cannot help —
 * there is no server to run it — so the worker picks by the document language
 * of the page that failed.
 *
 * IT IS A `.json` FILE AND THAT IS NOT A STYLE CHOICE. Three readers need this
 * list and they cannot share a module: this one, the generator that writes it
 * into the worker, and `scripts/check-deployed.mjs`, which walks every entry
 * against a real deployment because `cache.addAll` fails WHOLE on one 404 —
 * a missing icon means nobody ever gets an offline shell, silently. A `.mjs`
 * copy for the script would be the list written twice, in the one place where
 * the two copies decide whether the app installs at all. JSON is the one format
 * `resolveJsonModule` and `readFileSync` both read.
 *
 * THE ICONS ARE HERE AND NOT UNDER `immutable` BECAUSE THEY ARE NOT HASHED.
 * `/icons/icon-192.png` keeps its URL across deploys, so it cannot be treated
 * as immutable; precaching re-fetches it on every version, which is the right
 * cost for three small files and the reason the install prompt still has an
 * icon on a dead connection.
 */
export const PRECACHE_PATHS: readonly string[] = precachePaths;

/**
 * The one prefix the build content-hashes, and so the only cacheable bytes.
 *
 * Named rather than inlined for the same reason as the list above: the worker
 * needs the value and must not carry its own spelling of it. `/_next/image` is
 * deliberately NOT here — it is an optimisation endpoint whose answer depends
 * on the request, not a hashed file.
 */
export const NEXT_STATIC_PREFIX = "/_next/static/";

/** Everything the rule needs to know about one request. */
export type CacheQuestion = {
  /** The HTTP method. Anything but GET is never cached. */
  method: string;
  /** Is this the worker's own origin? */
  sameOrigin: boolean;
  /** The pathname alone, with the query string already removed. */
  pathname: string;
  /**
   * Is the browser asking for a document to show?
   *
   * `request.mode === "navigate"`, which is the browser's own answer and not a
   * guess from the path. It is what makes the rule total over routes nobody
   * listed: a page is a navigation whatever it is called.
   */
  navigation: boolean;
};

/**
 * The two values the rule compares against, passed in rather than closed over.
 *
 * THIS SHAPE IS FORCED BY MINIFICATION AND IT IS NOT STYLE. `cachePolicy`'s own
 * source text is pasted into the service worker, and the server bundle it is
 * pasted from is minified in production — so a body that read `PRECACHE_PATHS`
 * by name would arrive in the worker reading `a`, against a script that defines
 * `PRECACHE_PATHS`. The worker would then throw on its first fetch and the
 * browser would fall back to no worker at all: every route still works, nothing
 * is logged anywhere we read, and the offline page quietly never appears. A
 * failure that presents as a working product is the one this repository keeps
 * paying for, so the function is given everything it needs and closes over
 * nothing. Only its own locals can be renamed, which is harmless.
 */
export type CacheRule = {
  precache: readonly string[];
  staticPrefix: string;
};

/** The rule as this product configures it. Serialised into the worker as JSON. */
export const CACHE_RULE: CacheRule = {
  precache: PRECACHE_PATHS,
  staticPrefix: NEXT_STATIC_PREFIX,
};

/**
 * May this be cached, and how.
 *
 * THE DEFAULT IS THE SAFETY, AND THE FIRST VERSION OF THIS COMMENT SAID IT WAS
 * THE ORDER. That claim was tested by deleting the navigation check and
 * expecting the suite to go red; it stayed green, correctly, because a document
 * for a real route is refused by falling off the end of this function and not
 * by any check above it. Both mutations that do matter — defaulting to
 * `immutable`, and adding a page to `PRECACHE_PATHS` — fail loudly, the second
 * of them in four places. The comment is corrected rather than the test
 * widened: a sentence claiming a line is load-bearing when it is not is how the
 * next person comes to delete the line that is.
 *
 * WHAT THE NAVIGATION CHECK ACTUALLY DOES is keep the stored shell from being
 * served to somebody who is online. Without it, a visitor who navigates to
 * `/offline` with a working connection reads the copy stored at install — a
 * page that will one day say something the live one does not. It is a
 * correctness line, not the containment line, and it has a case of its own
 * because nothing else in the suite noticed its absence. It is placed above the
 * allow-list so that list can never be read as a set of documents it is
 * acceptable to cache.
 */
export function cachePolicy(
  question: CacheQuestion,
  rule: CacheRule,
): CacheVerdict {
  if (question.method !== "GET") return "never";
  if (!question.sameOrigin) return "never";
  if (question.navigation) return "never";

  for (const path of rule.precache) {
    if (question.pathname === path) return "precache";
  }

  if (question.pathname.startsWith(rule.staticPrefix)) return "immutable";

  return "never";
}
