/**
 * What a trade has to produce, and the two questions nobody should conflate.
 *
 *   IS THIS PERSON WHO THEY SAY THEY ARE?   — identity
 *   CAN THIS PERSON ACTUALLY DO THE TRADE?  — competence
 *
 * A verified citizenship certificate proves nothing about plumbing, and a
 * CTEVT certificate proves nothing about who is holding it. Platforms collapse
 * the two into one "verified" tick and the tick then means nothing, which is
 * why `providers.checks` is an array on this schema rather than a boolean and
 * why the two lists below are separate.
 *
 * POLICE CLEARANCE IS REQUIRED FOR EVERY TRADE WE SELL, and the reason is that
 * every one of them ends with somebody inside a house. A cleaner is alone in a
 * bedroom; a mover carries the contents of a home into a van. There is no
 * category here where "they do not really go inside" is true, so inventing a
 * distinction to reduce paperwork would be inventing a lie.
 */

import { CATEGORY_SEED } from "@/lib/config/services";

export type DocumentKind =
  /** Citizenship certificate, or the newer National ID. */
  | "citizenship"
  /** Permanent Account Number, where they have one. */
  | "pan"
  /** A face, to compare against the document. */
  | "selfie"
  /** चरित्र प्रमाणपत्र — the police clearance. */
  | "police_clearance"
  /** CTEVT skill certificate, where the trade has one. */
  | "ctevt";

export type DocumentRequirement = {
  kind: DocumentKind;
  /** Identity says who; competence says what they can do. */
  proves: "identity" | "competence";
  required: boolean;
  /** Whether it carries a date past which it is no longer evidence. */
  expires: boolean;
};

/**
 * The trades CTEVT actually certifies.
 *
 * Nepal's Council for Technical Education and Vocational Training runs short
 * courses for the wiring, pipe and machine trades; it does not certify house
 * cleaning, pest control, moving or tank cleaning. Listing a certificate for a
 * trade that has none would make an applicant hunt for a document that does
 * not exist, so those trades get the practical assessment instead — which is
 * the honest instrument for them anyway.
 */
const CTEVT_TRADES = new Set([
  "electrical",
  "plumbing",
  "ac-servicing",
  "carpentry",
  "painting",
  "appliance-repair",
]);

export function tradeHasCtevt(categorySlug: string): boolean {
  return CTEVT_TRADES.has(categorySlug);
}

const IDENTITY_DOCUMENTS: DocumentRequirement[] = [
  { kind: "citizenship", proves: "identity", required: true, expires: false },
  { kind: "selfie", proves: "identity", required: true, expires: false },
  /*
   * EXPIRES, and this is the one that actually lapses. A police clearance is a
   * statement about a moment; a certificate issued three years ago says
   * nothing about the last three years. `lib/verification/reverify.ts` is what
   * makes that real rather than a sentence in a policy.
   */
  {
    kind: "police_clearance",
    proves: "identity",
    required: true,
    expires: true,
  },
  /*
   * NOT REQUIRED, deliberately. Plenty of working tradespeople in Nepal have
   * no PAN, and demanding one would exclude exactly the people this platform
   * is for. It is collected where it exists because it is a strong duplicate
   * key, not because it gates anything.
   */
  { kind: "pan", proves: "identity", required: false, expires: false },
];

/** Everything this trade's applicant is asked for, identity and competence. */
export function documentsFor(categorySlugs: string[]): DocumentRequirement[] {
  const wantsCtevt = categorySlugs.some(tradeHasCtevt);
  return wantsCtevt
    ? [
        ...IDENTITY_DOCUMENTS,
        /*
         * Required only in the sense that the trade has one to give. Somebody
         * with twenty years on the tools and no certificate is a real and
         * common case in Nepal, and the practical assessment exists for them:
         * `competenceSatisfied` accepts either.
         */
        { kind: "ctevt", proves: "competence", required: false, expires: true },
      ]
    : IDENTITY_DOCUMENTS;
}

export function requiredDocumentsFor(categorySlugs: string[]): DocumentKind[] {
  return documentsFor(categorySlugs)
    .filter((requirement) => requirement.required)
    .map((requirement) => requirement.kind);
}

/**
 * Has competence been established, by either route?
 *
 * A CTEVT certificate OR a recorded practical assessment with a named
 * assessor. Never neither, and the platform must not pretend a citizenship
 * certificate covers it.
 */
export function competenceSatisfied(input: {
  hasCtevt: boolean;
  assessmentPassed: boolean;
}): boolean {
  return input.hasCtevt || input.assessmentPassed;
}

/** Guard against a trade being added to the seed without anybody deciding. */
export function knownTrade(slug: string): boolean {
  return CATEGORY_SEED.some((category) => category.slug === slug);
}
