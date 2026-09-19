import { correctionState } from "./correction";
import type { BookingStatus } from "./status";

/**
 * What, if anything, a booking needs from the customer right now.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE. `/bookings` was a flat stack of identical
 * cards, newest first. A job with a professional on the way sat between two
 * finished ones and a cancelled one, in the same box, in the same colour — and
 * a booking that was silently waiting on the customer to confirm the trip
 * looked exactly like a booking that was proceeding. The list answered "what
 * have I booked". It never answered the question somebody actually opens it
 * with: **is anything happening, and does anything need me?**
 *
 * The worst case is `confirmTrip`. Dispatch holds until the customer answers,
 * so an unanswered one is a job that never happens and nobody is told. The
 * whole reason `confirmation_required` exists is to protect a professional
 * from riding across Kathmandu to an address nobody has been to; a customer
 * who cannot see the gate is a customer whose booking dies quietly in it.
 *
 * PURE, so the rule can be tested without a database and so the same judgement
 * can later drive a notification or a badge without being reimplemented. A
 * second copy of "does this need you" would answer differently the first time
 * either was edited.
 */

export type AttentionKind =
  /** Nobody is dispatched until they answer. Invisible unless we say so. */
  | "confirmTrip"
  /** The professional says it is a different job, and work cannot start. */
  | "respondToCorrection"
  /** The figure went over the band and a professional is waiting on a yes. */
  | "approveAmount"
  /** Work is done and nothing has been paid. */
  | "pay"
  /** The two figures for a cash job disagree. A person is already looking. */
  | "resolveMismatch"
  /** Nobody took it. Their problem is still their problem. */
  | "rebook";

/**
 * The order is a ranking of whose time is being wasted, not of severity.
 *
 *   1. `confirmTrip` — nothing is moving and the customer cannot tell.
 *   2. `respondToCorrection` — the same, one step later and with somebody
 *      already assigned: `enforce_price_correction` refuses `in_progress`
 *      while the question is open, so a professional may be standing outside
 *      a door they are not allowed to start work behind.
 *   3. `approveAmount` — somebody is standing in their kitchen waiting.
 *   4. `resolveMismatch` — the two figures disagree.
 *   5. `pay` — somebody did the work and has not been paid.
 *   6. `rebook` — nothing is in flight, and they already know their tap leaks.
 *
 * A dashboard that lists three things needing attention has to put the one
 * that is blocking work first, or it is just another list.
 *
 * `resolveMismatch` SITS ABOVE `pay`, and the first draft had it below —
 * caught by a test, which is the only reason it is not shipped. Nothing
 * settles while a mismatch stands: both figures are kept and a person decides.
 * So a disputed booking that showed "Pay now" would be offering an action that
 * cannot complete, on a figure the customer has already said is wrong. That is
 * how a product teaches somebody their objection was ignored.
 */
const RANK: Record<AttentionKind, number> = {
  confirmTrip: 0,
  respondToCorrection: 1,
  approveAmount: 2,
  resolveMismatch: 3,
  pay: 4,
  rebook: 5,
};

/** Just enough of a booking to judge it. Keeps this loadable anywhere. */
export type AttentionInput = {
  status: BookingStatus;
  confirmationRequired: boolean;
  confirmedAt: string | null;
  finalAmount: number | null;
  finalAmountApprovedAt: string | null;
  amountMismatchAt: string | null;
  paymentStatus: string;
  /*
   * OPTIONAL, because most callers predate corrections and a booking without
   * them is simply one nobody has corrected. Read through `correctionState`
   * rather than tested here: `providerBandAt` is the existence test and the
   * reason why is written once, next to the rule.
   */
  providerBandAt?: string | null;
  bandChangeApprovedAt?: string | null;
  bandChangeDeclinedAt?: string | null;
};

/**
 * One booking, one answer.
 *
 * At most one thing is returned even when two are true, because a card with
 * two calls to action has none. The ranking decides, and the next one surfaces
 * as soon as the first is dealt with.
 */
export function attentionFor(booking: AttentionInput): AttentionKind | null {
  const wanted: AttentionKind[] = [];

  // Live bookings only: a cancelled job's unanswered confirmation is not a
  // question anybody still needs to answer.
  const live =
    booking.status === "pending" ||
    booking.status === "accepted" ||
    booking.status === "en_route" ||
    booking.status === "in_progress";

  if (live && booking.confirmationRequired && !booking.confirmedAt) {
    wanted.push("confirmTrip");
  }

  /*
   * THE PROFESSIONAL SAYS IT IS A DIFFERENT JOB AND NOBODY HAS ANSWERED.
   *
   * The same shape as the trip gate and the same reason for being here: the
   * database refuses `in_progress` while the question is open, so the booking
   * is stopped and the only person who can unstop it is the one reading this
   * dashboard. Without it, `/bookings` showed a blocked job exactly as it
   * showed a proceeding one.
   *
   * Live only. Declining cancels the booking, so a question on a dead job is
   * not a question — and re-asking it would be asking somebody to answer for
   * work that is not going to happen.
   */
  if (live && correctionState(booking) === "awaiting-answer") {
    wanted.push("respondToCorrection");
  }

  // A figure is recorded and nobody has agreed it. The type says exactly this:
  // a final amount with no approval is "waiting on you".
  if (booking.finalAmount !== null && booking.finalAmountApprovedAt === null) {
    wanted.push("approveAmount");
  }

  if (booking.amountMismatchAt) wanted.push("resolveMismatch");

  if (booking.status === "completed" && booking.paymentStatus === "unpaid") {
    wanted.push("pay");
  }

  if (booking.status === "no_provider_found") wanted.push("rebook");

  if (wanted.length === 0) return null;
  return wanted.sort((a, b) => RANK[a] - RANK[b])[0];
}

/** Is this booking still in flight? Decides which half of the page it sits in. */
export function isLiveBooking(status: BookingStatus): boolean {
  return (
    status === "pending" ||
    status === "accepted" ||
    status === "en_route" ||
    status === "in_progress"
  );
}

/**
 * Is something still happening on this booking?
 *
 * A FINISHED JOB WITH A GUARANTEE CLAIM ON IT IS NOT FINISHED. The status is
 * `completed` and always will be — the claim is a second visit, not a rerun of
 * the first — so `isLiveBooking` filed it under "Earlier, quiet and small",
 * beside jobs closed in June. Somebody who has reported that their tap is
 * leaking again and is waiting for us to send a person was being shown their
 * booking as history.
 *
 * SEPARATE FROM `attentionFor`, AND DELIBERATELY NOT ONE OF ITS KINDS. That
 * rule answers "does this need ME"; a claim in flight needs US. Putting it in
 * "Needs you" would ask the customer to act on the one thing they have already
 * done, which is how a product teaches somebody their report was not received.
 */
export function isHappeningNow(booking: {
  status: BookingStatus;
  /** A guarantee claim at `open`, `dispatched` or `attended`. */
  hasLiveClaim?: boolean;
}): boolean {
  return isLiveBooking(booking.status) || booking.hasLiveClaim === true;
}

/**
 * The customer's own history, counted honestly.
 *
 * ONLY WHAT WE ACTUALLY KNOW. `spent` sums recorded amounts on jobs that were
 * paid for, so a completed-but-unpaid job contributes nothing and a quoted
 * range contributes nothing — a total that quietly included estimates would be
 * a number a customer could disprove with their own wallet. The same rule as
 * the landing page's counters: a figure nobody can check is worse than no
 * figure, and one somebody CAN check had better be right.
 */
export function summarise(
  bookings: ReadonlyArray<{
    status: BookingStatus;
    finalAmount: number | null;
    paymentStatus: string;
  }>,
): { done: number; spent: number } {
  let done = 0;
  let spent = 0;

  for (const booking of bookings) {
    if (booking.status !== "completed") continue;
    done += 1;
    if (booking.paymentStatus === "paid" && booking.finalAmount !== null) {
      spent += booking.finalAmount;
    }
  }

  return { done, spent };
}
