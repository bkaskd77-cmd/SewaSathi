import type { PhotoVerdict } from "@/lib/ai/triage";

/**
 * Whether to ask for another photo, and whether to stop asking.
 *
 * PURE, AND SEPARATE FROM THE SCREEN, because what counts as "stop asking" is a product
 * promise rather than a rendering detail — and because the one thing that must never
 * happen here is easier to assert than to review: a booking is never blocked.
 *
 * TWO TRIES, THEN THE OFFER CLOSES. A third "that is not it" is not help, it is an
 * argument with somebody who is trying to report a broken tap, and the professional's
 * on-site correction already fixes a misleading photo. So the upload closes and the
 * booking carries on with no photo at all.
 *
 * `unclear` COUNTS TOWARDS THE LIMIT AND `related` RESETS IT. Both are deliberate. A dark
 * photo and a wrong photo cost the same two attempts, because the alternative is an
 * unbounded loop with somebody in a dim bathroom; and a customer who gets it right has
 * not been uncooperative, so their count goes back to nothing.
 *
 * NOTHING HERE CAN BLOCK A BOOKING OR CHANGE AN ANSWER. The verdict arrives beside the
 * triage result, never inside it.
 */

/** How many photos may ride on one request, once they are kept. */
export const MAX_PHOTOS_PER_REQUEST = 3;

/** How many rejected photos before the offer closes for this request. */
export const MAX_REJECTED_PHOTOS = 2;

export type RetakeState = {
  /** Rejected so far on this request. Reset by a photo that is related. */
  rejected: number;
};

export type RetakeDecision =
  /** Keep it. Nothing is said. */
  | { kind: "keep" }
  /** Ask for another, with the model's own reason. */
  | { kind: "retake"; relevance: "unrelated" | "unclear"; reason: string | null }
  /** Stop asking. The booking continues with no photo. */
  | { kind: "closed"; relevance: "unrelated" | "unclear"; reason: string | null };

/** A decision that asks the customer for something. Never `keep`. */
export type RetakeAsk = Exclude<RetakeDecision, { kind: "keep" }>;

export function judgePhoto(
  verdict: PhotoVerdict | null | undefined,
  state: RetakeState,
): { decision: RetakeDecision; next: RetakeState } {
  /*
   * NO VERDICT MEANS KEEP IT. Null is "no photo, or nobody looked" — the fallback
   * answered, the call failed, the model said nothing. Treating silence as a rejection
   * would make a customer retake a perfectly good photo because our key had expired,
   * which is rule 6's shape for a judgement: not recorded is not a finding.
   */
  if (!verdict || verdict.relevance === "related") {
    return { decision: { kind: "keep" }, next: { rejected: 0 } };
  }

  const rejected = state.rejected + 1;
  const common = { relevance: verdict.relevance, reason: verdict.reason };

  return {
    decision:
      rejected >= MAX_REJECTED_PHOTOS
        ? { kind: "closed", ...common }
        : { kind: "retake", ...common },
    next: { rejected },
  };
}

/** Has this request used up its photo slots? */
export function photosFull(kept: number): boolean {
  return kept >= MAX_PHOTOS_PER_REQUEST;
}
