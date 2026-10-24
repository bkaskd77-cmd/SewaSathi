import { defineRouting } from "next-intl/routing";

import { ALL_LOCALES, servedLocales, type AnyLocale } from "@/lib/config/locales";

/**
 * Locale routing — the one place the language contract is declared.
 *
 * `as-needed` keeps English on the unprefixed paths it already had (`/services`,
 * `/login`) and puts Nepali under `/ne`. Every link that was shared, indexed or
 * hard-coded before this migration still resolves, and the paint check and the
 * bundle budget keep watching the same URLs.
 *
 * The cookie keeps the name the old hand-rolled toggle used, so a returning
 * visitor's preference survives the migration rather than silently resetting to
 * English.
 *
 * `localeDetection` is on: a phone set to Nepali should land in Nepali without
 * being told there is a toggle. An explicit choice writes the cookie and wins
 * from then on.
 */
export const routing = defineRouting({
  /*
   * WHAT THIS DEPLOYMENT SERVES, which is both locales unless
   * `NEXT_PUBLIC_ENGLISH_ONLY=true` — the option the launch gating decision
   * added, so a launch can go ahead with the Nepali half hidden while its
   * money, safety and legal strings are still waiting for a native read. See
   * `lib/config/locales.ts`; `check:blockers` reads the same variable, so the
   * gate cannot forgive unread copy that somebody is still being served.
   */
  locales: [...servedLocales()],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: true,
  localeCookie: {
    name: "sajilokaam-locale",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },
});

/**
 * EVERY locale, never the served ones.
 *
 * `Locale` was `(typeof routing.locales)[number]`, which was the same thing
 * until a deployment could serve one language. It must not be: `messages/ne.json`,
 * `categoryCopy`, `formatNpr` and every `locale === "ne"` branch are still in the
 * product and still correct, so narrowing this union to what is served would make
 * hiding Nepali a type-level deletion of the Nepali half of the codebase — and
 * `tests/unit/english-only.test.ts` pins it for that reason.
 */
export type Locale = AnyLocale;

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "en" || value === "ne";
}

/**
 * The pathname with any locale prefix removed.
 *
 * Route guards match on `/book`, not `/ne/book`. Everything that reads a
 * pathname for a decision — the middleware, `safeRedirect` — goes through here
 * first, because `/ne/account` is the same protected route as `/account`.
 */
export function stripLocale(pathname: string): string {
  /*
   * `ALL_LOCALES`, NOT THE SERVED ONES, AND THIS IS THE DANGEROUS HALF OF
   * HIDING A LOCALE. Route guards match the unprefixed path, so if this iterated
   * the served list then with Nepali hidden `/ne/account` would strip to
   * `/ne/account` — which is not in `PROTECTED_ROUTES`, so `middleware.ts` would
   * wave it through. A hidden locale must 404 at the router, never become a way
   * past the guard, and `/ne/...` is still a string anybody can type.
   */
  for (const locale of ALL_LOCALES) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return pathname;
}
