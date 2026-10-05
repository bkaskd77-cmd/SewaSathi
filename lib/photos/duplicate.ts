/**
 * What to do about a photograph that looks like one we have seen before.
 *
 * THREE BANDS, AND ONLY THE FIRST REFUSES ANYTHING. A hard reject is the one check in this
 * product that turns somebody away with no appeal inside the flow, so it is drawn where two
 * genuine photographs cannot land: distance 4 on a 64-bit dHash catches the same file
 * re-uploaded, re-compressed or lightly cropped, and two real photographs of the same tap
 * taken minutes apart do not collide there. Everything from 5 to 10 goes to the person
 * deciding a claim and refuses nothing.
 *
 * SCOPED TO OTHER BOOKINGS AND OTHER ACCOUNTS, which is the clause that keeps an honest
 * person out of it. The same photograph arriving twice on the SAME booking is a retry on a
 * weak connection — the arrival panel queues a failed call and drains it later, so a second
 * pass is ordinary — and that is deduplicated, never refused.
 *
 * NULL IS "NOT COMPARED", NEVER "NO MATCH". A photograph whose bytes would not decode has
 * no hash, and a missing hash is not evidence that a photograph is new. Rule 6.
 *
 * PURE, AND SEPARATE FROM THE HASH, so the bands can be tested without decoding anything —
 * and so the one number that refuses a person sits in a file with the reason beside it
 * rather than inside a data-layer function nobody re-reads.
 */
import { hammingDistance } from "@/lib/photos/hash";

/** Identical or all but identical. Refused. */
export const DUPLICATE_REJECT_AT = 4;
/** Close enough to be worth a person's eye. Flagged, never refused. */
export const DUPLICATE_FLAG_AT = 10;

export type PriorPhoto = {
  hash: string;
  /** The booking it was used on. The same booking means a retry, not a reuse. */
  bookingId: string;
  /** Whose photograph it was. A different account is the stronger signal. */
  accountId: string | null;
};

export type DuplicateVerdict =
  | { kind: "unseen" }
  /** The same photograph arriving again on the same booking. Keep one, refuse nothing. */
  | { kind: "retry"; distance: number }
  | { kind: "reject"; distance: number; match: PriorPhoto }
  | { kind: "flag"; distance: number; match: PriorPhoto }
  /** No hash on one side or the other, so nothing was compared. */
  | { kind: "not-compared" };

export function judgeDuplicate(input: {
  hash: string | null;
  bookingId: string;
  accountId: string | null;
  priors: PriorPhoto[];
}): DuplicateVerdict {
  if (!input.hash) return { kind: "not-compared" };

  let nearest: { prior: PriorPhoto; distance: number } | null = null;

  for (const prior of input.priors) {
    const distance = hammingDistance(input.hash, prior.hash);
    if (distance === null) continue;
    if (!nearest || distance < nearest.distance) nearest = { prior, distance };
  }

  if (!nearest) return { kind: "unseen" };

  /*
   * THE SAME BOOKING IS A RETRY WHATEVER THE DISTANCE, checked before the bands rather
   * than after. The alternative refuses somebody for re-sending the photograph they
   * already sent, on the one screen where they are standing in a street with a bad signal
   * — and the arrival panel is built to resend.
   */
  if (nearest.prior.bookingId === input.bookingId) {
    return { kind: "retry", distance: nearest.distance };
  }

  if (nearest.distance <= DUPLICATE_REJECT_AT) {
    return { kind: "reject", distance: nearest.distance, match: nearest.prior };
  }
  if (nearest.distance <= DUPLICATE_FLAG_AT) {
    return { kind: "flag", distance: nearest.distance, match: nearest.prior };
  }
  return { kind: "unseen" };
}
