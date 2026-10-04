/**
 * Performance budgets, enforced by the build.
 *
 * Numbers are kilobytes of "First Load JS" as `next build` reports them — the
 * JS a visitor downloads before the page is interactive.
 *
 * These are ceilings with deliberate headroom, not targets. They exist to
 * catch a regression that would otherwise only surface in a Lighthouse run
 * someone remembered to do. The landing page is the one that matters: most
 * visitors arrive there on a mid-range Android over 3G.
 *
 * What set these numbers: the account menu once imported the browser Supabase
 * client and took `/` from 126 kB to 197 kB in a single commit, and nothing
 * failed. `/` has otherwise sat between 126 and 129 kB for three phases.
 *
 * Raising a ceiling is a decision, not a fix. If a change genuinely needs the
 * room, move the number in the same commit and say why.
 *
 * Every ceiling below moved once, in the next-intl migration, and every route
 * name gained the `[locale]` segment. next-intl's client runtime — the ICU
 * message parser and the formatters — is about 18 kB on the landing page and
 * 5-6 kB elsewhere, and it is not optional: the hero card renders a triage
 * result in the browser and has to hold the safety lines in both languages for
 * the offline path. The numbers below are the measured sizes plus the same
 * headroom the old ones carried, not a blanket raise.
 */
/**
 * THE METRIC CHANGED WITH NEXT 16, AND THE NUMBERS BELOW ARE NOT THE OLD ONES REBASED
 * BY A FUDGE FACTOR. Every ceiling here used to be Next's printed "First Load JS" — the
 * potential weight of a route's chunk tree — parsed out of the build table. Next 16
 * deleted those columns under both builders, so `check-bundle-budget.mjs` measures
 * script actually transferred to a real Chromium instead.
 *
 * THE TWO METRICS DISAGREE AND THE OLD ONE WAS THE OPTIMISTIC ONE. Measured on the
 * SAME Next 14 build, the printed figure for `/[locale]` was 156 kB and the browser
 * pulled 161 kB. So these are rebased against a measurement, not converted: each
 * number below is what Next 16 + React 19 transfers today, plus about a tenth for
 * headroom, and the Next 14 figure is recorded beside it so the next person can see
 * what the upgrade cost rather than inferring it.
 *
 * WHAT THE UPGRADE COST, MEASURED THE SAME WAY ON BOTH: +14 to +36 kB of transferred
 * script per route, which is React 19's client runtime and Next 16's app-router
 * runtime. It cost nothing user-visible on this machine — mobile Lighthouse on `/` is
 * 100, 100, 100 on Next 16 + webpack, identical to Next 14, with LCP 1.5 s and 0 ms
 * total blocking time — because those bytes are deferred rather than render-blocking.
 * That is why the ceilings moved rather than the upgrade being refused.
 *
 * `anyRoute` and `sharedByAll` ARE GONE, not quietly dropped. Both were derived from
 * the printed table: one from every route in it, the other from its "shared by all"
 * line. A browser check sees only the routes it is pointed at, so neither has a data
 * source any more, and keeping a number nothing computes would be worse than not
 * having it. The routes below are the ones with a budget; adding a route means adding
 * it here and in `URL_FOR`, and the check fails on a budget it cannot measure rather
 * than skipping it.
 */
export const BUDGET = {
  routes: {
    /*
     * The landing page, and the one that matters most: it is what a stranger meets on
     * a Nepali mobile connection. Next 14 transferred 161.3 kB here; Next 16 + React 19
     * transfers 196.9 kB.
     */
    "/[locale]": 215,
    /*
     * 163.6 kB on Next 14, 199.2 kB now — and the highest of the four, which is not
     * what you would guess from a page with one form on it. 46 kB of that is
     * framer-motion, fetched after hydration because `MotionProvider` mounts here; the
     * check waits for it deliberately rather than racing it. This is the ceiling to
     * watch if that provider ever creeps toward the root layout.
     */
    "/[locale]/login": 220,
    /*
     * The catalogue. This is the ceiling that is really watching: if it grows, something
     * turned a Server Component into a Client one. 155.5 kB on Next 14, 191.1 kB now.
     */
    "/[locale]/services": 210,
    // 136.5 kB on Next 14, 172.6 kB now.
    "/[locale]/services/[slug]": 190,
    /*
     * A provider page needs a real provider id and the seed ships none — `providers.json`
     * was emptied deliberately when the invented professionals were removed. Budgeted
     * and reported as unmeasurable rather than deleted, so the day there is seeded data
     * the ceiling is already here. 124 kB printed on Next 14, for reference.
     */
    "/[locale]/services/[slug]/[providerId]": 190,
  },
};
