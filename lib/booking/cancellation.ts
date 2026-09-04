import { type BookingStatus } from "./status";

/**
 * Who may cancel a booking, at which status, and what it costs.
 *
 * Written down here rather than implied by a disabled button, because three
 * different surfaces ask the question — the customer's page, the professional's
 * job list, and the RLS policy on `bookings` — and a rule that lives in three
 * places is three rules.
 *
 * THE WINDOW IS THE POLICY. A customer may cancel while nobody has spent
 * anything on their behalf, and may not once a professional is travelling. That
 * is not a softer rule than a cancellation fee, it is a different one: it means
 * cancelling in this product is always free, and there is never a charge to
 * argue about. The alternative — allowing a late cancellation and billing for
 * it — needs an instrument to collect with, and ours settles *after* the work.
 * A fee on screen that nothing can collect is worse than no fee.
 *
 * `fee` is therefore always 0 today, and it is still returned, because the
 * booking records it and the day there is something to charge against, this is
 * a constant rather than a migration.
 *
 * A PROFESSIONAL'S WITHDRAWAL IS NOT A CANCELLATION AT ALL. They may pull out
 * later than a customer may — a van breaks down, a job overruns — and it does
 * not end the booking: the customer's tap is still dripping. The job goes back
 * to the pool for somebody else to take, and only the customer may actually
 * end it. What is recorded against the professional is the withdrawal, which
 * is what Phase 10's reliability score reads.
 */

export type CancelActor = "customer" | "provider" | "admin";

export type CancelVerdict =
  | {
      allowed: true;
      /** NPR. Always 0 — see the note above. */
      fee: number;
      /** Message key for what the person is about to be told. */
      copyKey: "free" | "providerWithdraws";
    }
  | {
      allowed: false;
      /**
       * `tooLate`  — a professional is on the way or working. Support only.
       * `finished` — the job is over; there is nothing left to cancel.
       * `ended`    — already cancelled or closed unmatched.
       */
      reason: "tooLate" | "finished" | "ended";
    };

/**
 * A customer may cancel while nobody is on the way.
 *
 * `en_route` is the boundary and it is chosen for the professional's sake: at
 * that moment they have left, on a bike, in Kathmandu traffic, and that trip
 * is spent whatever happens next. In progress is later still.
 */
const CUSTOMER_WINDOW: BookingStatus[] = ["pending", "accepted"];

/** A professional may pull out until they are actually doing the work. */
const PROVIDER_WINDOW: BookingStatus[] = ["pending", "accepted", "en_route"];

export function judgeCancellation(
  status: BookingStatus,
  actor: CancelActor,
): CancelVerdict {
  if (status === "completed") return { allowed: false, reason: "finished" };
  if (status === "cancelled" || status === "no_provider_found") {
    return { allowed: false, reason: "ended" };
  }

  // Support has to be able to unstick a job that has gone wrong on site.
  if (actor === "admin") return { allowed: true, fee: 0, copyKey: "free" };

  if (actor === "provider") {
    return PROVIDER_WINDOW.includes(status)
      ? { allowed: true, fee: 0, copyKey: "providerWithdraws" }
      : { allowed: false, reason: "tooLate" };
  }

  return CUSTOMER_WINDOW.includes(status)
    ? { allowed: true, fee: 0, copyKey: "free" }
    : { allowed: false, reason: "tooLate" };
}

/**
 * The button's question, kept as its own name.
 *
 * Pre-dates the policy above and is now a thin read of it, so the page and the
 * policy cannot disagree. Deliberately not deleted: it is what the RLS policy
 * on `bookings` mirrors, and a caller asking "may this person cancel" should
 * not have to destructure a verdict to find out.
 */
export function customerCanCancel(status: BookingStatus): boolean {
  return judgeCancellation(status, "customer").allowed;
}

export function providerCanCancel(status: BookingStatus): boolean {
  return judgeCancellation(status, "provider").allowed;
}
