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
 */
export const BUDGET = {
  /** Per-route First Load JS ceilings, in kB. */
  routes: {
    "/": 140,
    "/login": 190,
  },

  /** No route may exceed this, in kB — catches pages nobody budgeted for. */
  anyRoute: 200,

  /** The shared chunk every page pays for, in kB. */
  sharedByAll: 95,
};
