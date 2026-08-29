import "server-only";

import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { absoluteUrl, site } from "@/lib/config/site";

/**
 * The Open Graph block for a page.
 *
 * Next does not merge `openGraph` with the parent layout's — a page that
 * defines its own replaces it wholesale. So the first version of the per-page
 * og:url silently dropped og:locale and og:site_name from every services page.
 * Building the whole block here means a page can only ever set the parts that
 * differ, and the parts that must never differ cannot be forgotten.
 */

/** Open Graph wants a full territory tag, not a bare language. */
const OG_LOCALE: Record<Locale, string> = {
  en: "en_NP",
  ne: "ne_NP",
};

export function openGraphFor({
  locale,
  href,
  title,
  description,
  type = "website",
}: {
  locale: Locale;
  /** An unprefixed internal path — the locale prefix is added here. */
  href: string;
  title: string;
  description: string;
  type?: "website" | "profile";
}) {
  return {
    type,
    siteName: site.name,
    url: absoluteUrl(getPathname({ href, locale })),
    title,
    description,
    locale: OG_LOCALE[locale],
    alternateLocale: routing.locales
      .filter((l) => l !== locale)
      .map((l) => OG_LOCALE[l]),
  };
}
