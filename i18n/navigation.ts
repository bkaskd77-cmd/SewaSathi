import type { RedirectType } from "next/navigation";
import { createNavigation } from "next-intl/navigation";

import { routing } from "@/i18n/routing";

/**
 * Locale-aware replacements for `next/link` and the navigation hooks.
 *
 * Import these, never `next/link`, for any internal href. They add the `/ne`
 * prefix when the reader is in Nepali and leave English alone — which is what
 * stops a Nepali visitor being dropped back into English by a single stray
 * link, the failure mode that makes a bolted-on translation layer feel broken.
 */
const navigation = createNavigation(routing);

export const { Link, usePathname, useRouter, getPathname } = navigation;

/**
 * `redirect` with an explicit `never` return type.
 *
 * TypeScript only treats a call as terminating control flow when the thing
 * being called carries an explicit annotation, and next-intl's is inferred
 * through a factory. Without this, every `if (!profile) redirect(…)` left
 * `profile` possibly-null on the line after it.
 */
export const redirect: (
  args: {
    href: string | { pathname: string; query?: Record<string, unknown> };
    locale: string;
    forcePrefix?: boolean;
  },
  type?: RedirectType,
) => never = navigation.redirect as never;
