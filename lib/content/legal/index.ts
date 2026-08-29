import type { Locale } from "@/i18n/routing";
import { privacy } from "@/lib/content/legal/privacy";
import { refunds } from "@/lib/content/legal/refunds";
import { terms } from "@/lib/content/legal/terms";
import type { ProseDocument } from "@/lib/content/types";

/**
 * The three legal documents, by URL slug.
 *
 * All three are first drafts and all three are marked `draft: true`, which is
 * what puts the review notice on the page. Removing that flag is part of
 * resolving `legal-documents-unreviewed` in LAUNCH-BLOCKERS.md — it is not a
 * cosmetic decision.
 */
export const LEGAL_DOCUMENTS = { terms, privacy, refunds } as const;

export type LegalSlug = keyof typeof LEGAL_DOCUMENTS;

export const LEGAL_SLUGS = Object.keys(LEGAL_DOCUMENTS) as LegalSlug[];

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as string[]).includes(value);
}

export function legalDocument(slug: LegalSlug, locale: Locale): ProseDocument {
  return LEGAL_DOCUMENTS[slug][locale];
}
