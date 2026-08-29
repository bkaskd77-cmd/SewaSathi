import { defineRouting } from "next-intl/routing";

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
  locales: ["en", "ne"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: true,
  localeCookie: {
    name: "sajilokaam-locale",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },
});

export type Locale = (typeof routing.locales)[number];

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
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return pathname;
}
