import type { Locale } from "@/i18n/routing";

/**
 * Long-form prose — legal documents, help pages, the about page.
 *
 * Deliberately not in `messages/*.json`. That catalogue is interface strings:
 * short, interpolated, and shipped to the browser for the Client Components
 * that need them. A terms-of-service document is neither — it is a page's
 * entire content, it is server-rendered, and putting several thousand words of
 * it into the message catalogue would bloat every page's payload to serve one
 * route.
 *
 * Structured rather than raw markdown so the renderer controls the typography
 * and the anchors, and so a missing heading is a type error rather than a
 * silently unstyled page.
 */

export type Block =
  /** A paragraph. */
  | { p: string }
  /** A bulleted list. */
  | { ul: string[] }
  /** A term and its explanation — used for the data tables in the privacy doc. */
  | { dl: Array<{ term: string; detail: string }> };

export type Section = {
  /** Becomes the heading and its `id`, so every section is linkable. */
  id: string;
  heading: string;
  blocks: Block[];
};

export type ProseDocument = {
  title: string;
  /** One or two sentences under the title. */
  lead: string;
  /** ISO date. Shown as "last updated". */
  updated: string;
  /**
   * True while the document has not been through legal review.
   *
   * Renders a visible notice at the top of the page. Not a code comment: the
   * person agreeing to these terms is the one who needs to know they are a
   * draft, and they cannot read the repository.
   */
  draft?: boolean;
  sections: Section[];
};

export type LocalisedDocument = Record<Locale, ProseDocument>;
