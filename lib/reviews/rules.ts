/**
 * Who may say what about whom, and when anybody gets to read it.
 *
 * Pure and dependency-free. The customer's review page, the professional's
 * dashboard, the publication sweep and the database tests all ask these
 * questions, and three of those are client code.
 */

/**
 * How long a review stays sealed.
 *
 * FOURTEEN DAYS, and both halves of the number are load-bearing. Long enough
 * that somebody who was away for a week still gets a say; short enough that a
 * listing is not stale for a month while one side sits on a review. When the
 * window closes, whatever is in publishes — a review nobody answered is still
 * the customer's account and withholding it would punish them for the other
 * side's silence.
 */
export const REVIEW_WINDOW_DAYS = 14;

/** The longest a reply may be. One paragraph answers; three argue. */
export const REPLY_MAX_CHARS = 600;

/**
 * What a professional may record about a customer.
 *
 * NO PROSE AND NO SCORE, and that is stronger than it first looks.
 *
 * A NUMBER IS A JUDGEMENT, NOT A RECORD. "3 out of 5" about a private
 * individual, held indefinitely and never shown to them, is prose with fewer
 * characters — it cannot be checked, answered or explained. `customer_risk`
 * was already built as counters rather than a score, with `completed_jobs`
 * retiring strikes so the ladder is not a ratchet, and these are more counters
 * of exactly that kind.
 *
 * PROSE IS ALSO NOT SIGNAL. "Difficult" cannot be counted, compared across
 * professionals or aggregated, so it cannot support the human review it exists
 * to inform — and it would hold health details, allegations and third parties'
 * information we have no use for and would have to defend keeping.
 *
 * AND THE LIST IS WHAT MAKES RETALIATION UNEXPRESSIBLE. Every flag is an
 * observable fact about the visit. NONE of them can express a price
 * disagreement, deliberately and permanently: a customer declining a surveyed
 * quote or refusing an over-band final amount is exercising a right this
 * product gives them, and charging under the band is already published as
 * never-a-signal. There is no "wanted a discount" flag and
 * `tests/unit/review-rules.test.ts` asserts there never is one.
 */
export const CUSTOMER_FLAGS = [
  /** Nobody at the address at the agreed time. */
  "not_at_address",
  /** The address or landmark did not lead anywhere. */
  "address_unusable",
  /** Could not get in — locked gate, nobody answering. */
  "could_not_access",
  /** The work was materially different from the description. */
  "job_not_as_described",
  /** Conditions at the site made the work unsafe. */
  "unsafe_site",
  /** Asked to do the job outside SajiloKaam. */
  "asked_off_platform",
  /** Threatening or abusive behaviour. */
  "abusive",
] as const;

export type CustomerFlag = (typeof CUSTOMER_FLAGS)[number];

export function isCustomerFlag(value: string): value is CustomerFlag {
  return (CUSTOMER_FLAGS as readonly string[]).includes(value);
}

export type ReviewSide = {
  submittedAt: string | null;
};

export type ReviewPair = {
  /** The customer's review of the professional. Public once published. */
  customer: ReviewSide | null;
  /** The professional's answer about the visit. Never public. */
  provider: ReviewSide | null;
  /** When the sealed window closes — set from the job finishing. */
  windowClosesAt: string | null;
};

function instant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? null : when;
}

/** When a job finishing now would stop accepting reviews. */
export function reviewWindowFrom(finishedAt: Date = new Date()): Date {
  return new Date(finishedAt.getTime() + REVIEW_WINDOW_DAYS * 24 * 60 * 60_000);
}

/**
 * Is the pair still sealed?
 *
 * DOUBLE-BLIND, AND IT MATTERS EVEN THOUGH ONLY ONE SIDE IS PUBLIC. The
 * reciprocity problem does not need both reviews to be visible — it needs one
 * side to see the other before writing. A professional who reads a two-star
 * and then ticks `abusive` is the whole failure, and it is the direction that
 * costs a real person the most.
 */
export function sealed(pair: ReviewPair, now: Date = new Date()): boolean {
  const closes = instant(pair.windowClosesAt);
  if (closes && now.getTime() >= closes.getTime()) return false;
  return !(pair.customer?.submittedAt && pair.provider?.submittedAt);
}

/** May this be read by the other side, or by the public? */
export function published(pair: ReviewPair, now: Date = new Date()): boolean {
  return !sealed(pair, now);
}

/**
 * May the author still change it?
 *
 * ONLY WHILE SEALED. Once it is public it is fixed, which closes the channel
 * where a professional offers to put something right in exchange for a better
 * score. A review that can be edited after the subject has read it is not a
 * review, it is an opening position.
 */
export function canEdit(pair: ReviewPair, now: Date = new Date()): boolean {
  return sealed(pair, now);
}

export type ReplyRefusal =
  | "notPublished"
  | "alreadyReplied"
  | "disputeOpen"
  | "windowPassed";

/**
 * May the professional answer this review?
 *
 * ONCE, AND IT CANNOT SCORE BACK. A public record decides their livelihood and
 * they are the party with least power in it; no right of reply at all would
 * cost us the professionals worth keeping. The reply adds facts — there is no
 * counter-rating anywhere in this design.
 *
 * NOT WHILE SOMETHING IS OPEN. A reply on a job with a live dispute or claim is
 * arguing in public about a question that already has a process, and the reply
 * would outlive whatever that process found.
 */
export function canReply(input: {
  pair: ReviewPair;
  alreadyReplied: boolean;
  disputeOpen: boolean;
  now?: Date;
}): { ok: true } | { ok: false; reason: ReplyRefusal } {
  const now = input.now ?? new Date();
  if (!published(input.pair, now)) return { ok: false, reason: "notPublished" };
  if (input.alreadyReplied) return { ok: false, reason: "alreadyReplied" };
  if (input.disputeOpen) return { ok: false, reason: "disputeOpen" };
  return { ok: true };
}

/**
 * Does this review move the rating average?
 *
 * PUBLISHED ALWAYS, AVERAGED UNLESS A PERSON FOUND OTHERWISE. A review on a
 * disputed job is the one a future customer most wants to read, so suppressing
 * it would make the average a survivorship artifact — and withholding it
 * "pending investigation" would put us in the business of deciding which bad
 * reviews see daylight.
 *
 * So it counts by DEFAULT. It leaves the average only when a person's finding
 * says the customer caused it, and it never leaves the page. A rating average
 * is evidence and must not be moved by an account a process contradicted; a
 * review page is testimony and must not lose anything.
 */
export function countsTowardAverage(review: {
  excludedFromAverageAt: string | null;
}): boolean {
  return review.excludedFromAverageAt === null;
}
