import "server-only";

import { cookies } from "next/headers";

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
} from "@/lib/i18n/locale";

/**
 * The reader's language.
 *
 * Separate file from the constants because `next/headers` cannot be bundled
 * for the browser, and the toggle that writes this cookie is a Client
 * Component that needs the cookie name.
 */
export function getLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
