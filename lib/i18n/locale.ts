/**
 * Language, as far as it goes today.
 *
 * The toggle in the header writes the cookie below and refreshes; the server
 * reads it (see ./server.ts) and renders category names in that language. That
 * is deliberately all it does — see the i18n note in CLAUDE.md before
 * extending it. Wiring one real string end to end proves the mechanism without
 * committing the product to a translation approach we have not chosen.
 *
 * Constants and types only, so a Client Component can import them. The cookie
 * read lives in ./server.ts because `next/headers` cannot be bundled for the
 * browser — importing it here broke the build once already.
 */

export type Locale = "en" | "ne";

export const LOCALE_COOKIE = "sajilokaam-locale";
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "en" || value === "ne";
}
