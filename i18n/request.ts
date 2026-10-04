import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { contentOverrides, mergeOverrides } from "@/lib/data/content";
import { routing } from "@/i18n/routing";

/**
 * Per-request messages.
 *
 * One catalogue file per locale, namespaced inside. Splitting further would
 * mean deciding per route which namespaces to load; at this size the whole
 * catalogue is a few kilobytes on the server and only the namespaces a Client
 * Component asks for are serialised to the browser.
 *
 * ADMIN OVERRIDES ARE LAID OVER THE CATALOGUE HERE, which is the one place every
 * rendered string in the product passes through. `content_strings` holds only what
 * somebody edited; the JSON stays the source of truth, so `check:messages` and
 * `check:keys` go on guarding exactly what they guarded before.
 *
 * AN UNREACHABLE TABLE MUST NEVER BLANK A PAGE. `contentOverrides` returns `{}` on any
 * failure and the catalogue shows through unchanged — rule 6 in the shape it takes for
 * copy, and sharper than the `/services` case it comes from: a failed read there could
 * explain itself on a screen, and a failed read here would have no screen left to
 * explain itself on.
 *
 * THE READ IS CACHED ACROSS VISITORS. next-intl calls this on every render, and the
 * landing page is static — a per-visitor query would both undo that and add a Singapore
 * round trip to every page in the product.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const [catalogue, overrides] = await Promise.all([
    import(`../messages/${locale}.json`),
    contentOverrides(locale),
  ]);

  return {
    locale,
    messages: mergeOverrides(catalogue.default, overrides),
    // Nepal has one timezone and prices are NPR. Fixing them here means a
    // date rendered on the server and the same date rendered in the browser
    // cannot disagree.
    timeZone: "Asia/Kathmandu",
    now: new Date(),
  };
});
