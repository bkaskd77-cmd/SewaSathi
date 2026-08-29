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
    // Measured 148 after the migration (128 before it).
    "/[locale]": 155,
    // Measured 195. /verify and /onboarding sit alongside it at 196.
    "/[locale]/login": 205,
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
