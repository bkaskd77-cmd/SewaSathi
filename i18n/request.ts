import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "@/i18n/routing";

/**
 * Per-request messages.
 *
 * One catalogue file per locale, namespaced inside. Splitting further would
 * mean deciding per route which namespaces to load; at this size the whole
 * catalogue is a few kilobytes on the server and only the namespaces a Client
 * Component asks for are serialised to the browser.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Nepal has one timezone and prices are NPR. Fixing them here means a
    // date rendered on the server and the same date rendered in the browser
    // cannot disagree.
    timeZone: "Asia/Kathmandu",
    now: new Date(),
  };
});
