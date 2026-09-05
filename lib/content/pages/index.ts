import type { Locale } from "@/i18n/routing";
import type { LocalisedDocument, ProseDocument } from "@/lib/content/types";
import { about } from "@/lib/content/pages/about";
import { complaint } from "@/lib/content/pages/complaint";
import { contact } from "@/lib/content/pages/contact";
import { help } from "@/lib/content/pages/help";
import { standards } from "@/lib/content/pages/standards";

/**
 * The information pages the footer links to.
 *
 * /careers is deliberately not here and its footer link is gone: there are no
 * jobs to post, and a careers page that says "no openings" is worse than not
 * claiming to have one. It comes back when there is something to apply for.
 */
const PAGES: Record<string, LocalisedDocument> = {
  about,
  contact,
  help,
  "help/complaint": complaint,
  // The enforcement ladder, linked from /providers/join. Deterrence that
  // nobody can read is not deterrence — it is a trap, and it drives away the
  // honest half while the rest simply learn the thresholds by experiment.
  "providers/standards": standards,
};

export function isInfoPage(slug: string): boolean {
  return slug in PAGES;
}

export const INFO_PAGE_SLUGS = Object.keys(PAGES);

export function infoPage(slug: string, locale: Locale): ProseDocument | null {
  return PAGES[slug]?.[locale] ?? null;
}
