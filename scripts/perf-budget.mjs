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
export const BUDGET = {
  /** Per-route First Load JS ceilings, in kB. */
  routes: {
    /*
     * Measured 148 after the next-intl migration (128 before it), then 155 —
     * and 155 was also the ceiling, so this route had ZERO SPARE and the next
     * honest kilobyte was going to fail whatever it was for. A ceiling set to
     * the current measurement is not a budget; it is a tripwire that teaches
     * whoever hits it to raise the number without thinking, which is the one
     * habit this file exists to prevent.
     *
     * 158 is the sub-band ask — the question the triage card puts to a
     * customer when it could not name a product — measured at 156.0, plus the
     * ~2 kB of headroom every other ceiling here carries. The ask is worth it:
     * a category band spans 10-13x and the matcher names a product for about a
     * sixth of requests, so without it most customers read the wide band as the
     * promise. The labels themselves are NOT in this number; they ride back on
     * the triage response precisely so 36 products in two languages never
     * become landing-page JavaScript.
     */
    "/[locale]": 158,
    /*
     * 205 kB until Phase 9, when moving the OTP send behind a server action
     * took supabase-js out of this bundle entirely: 197 kB -> 128 kB, on the
     * one screen every customer must load before they can do anything, over a
     * connection that is often a phone on mobile data. The ceiling comes down
     * with it — a win nobody can regress into is worth more than the win.
     */
    "/[locale]/login": 140,
    // The discovery routes. `/services/[slug]` carries the only client-side
    // JavaScript in this group — the filter bar — and that is what the ceiling
    // is really watching: if it grows, something turned a Server Component
    // into a Client Component.
    "/[locale]/services": 120,
    "/[locale]/services/[slug]": 135,
    "/[locale]/services/[slug]/[providerId]": 130,
  },

  /** No route may exceed this, in kB — catches pages nobody budgeted for. */
  anyRoute: 210,

  /** The shared chunk every page pays for, in kB. Measured 87.4. */
  sharedByAll: 95,
};
