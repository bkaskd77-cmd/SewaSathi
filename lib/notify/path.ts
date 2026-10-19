import type { NotificationKind } from "./channel";

/**
 * Where a notification takes the person who taps it.
 *
 * EVERY PUSH IN THIS PRODUCT OPENED THE CUSTOMER'S BOOKING PAGE. The service
 * worker derived the path from `bookingId` alone — `/bookings/{id}`, or
 * `/bookings` without one — and three kinds that wake a phone go to a
 * PROFESSIONAL:
 *
 *   - `booking.assigned` is work being offered. A professional tapping "you
 *     have a new job" reached `/bookings/{id}`, which reads with
 *     `{ customerId: profile.id }` and then calls `notFound()`. **A 404 on the
 *     notification whose whole job is to get somebody to accept work.**
 *   - `booking.quoteExpired` goes to both sides; the provider half 404ed too.
 *   - `payout.destinationChanged` is the account-takeover control, and it
 *     carries no booking at all — so it opened `/bookings`, a customer's job
 *     list, on the one notification that exists to be read by somebody who did
 *     NOT change where they are paid.
 *
 * THE KIND CANNOT DECIDE THIS AND THE AUDIENCE CAN. `booking.quoteExpired` is
 * sent to the customer in one place and the professional in another, so a map
 * from kind to path would be wrong for one of them whichever way it was
 * written. `Notification.audience` is the field the caller always knows — it is
 * literally `recipientId: booking.customerId` against
 * `recipientId: booking.providerId` at the call site — and making it required
 * is what put the question in front of all twenty-two of them.
 *
 * IT IS PURE AND IT IS HERE RATHER THAN IN `push.ts`, so the worker, the test
 * and any later channel read one rule. A second copy in the service worker is
 * what this is replacing.
 */

export type NotificationAudience = "customer" | "provider";

/**
 * The unprefixed path. The caller adds the locale.
 *
 * A PROFESSIONAL'S JOBS ARE ONE SCREEN, so a provider-bound notice about a
 * booking lands on the list rather than on a per-job route — there is no
 * `/provider/jobs/[id]`, and inventing a URL the product does not serve would
 * be a 404 of a different shape. The booking id rides as a fragment, which is
 * honest: it is where that job's card is on the page it lands on.
 */
export function notificationPath(input: {
  kind: NotificationKind;
  audience: NotificationAudience;
  bookingId: string | null;
}): string {
  const { kind, audience, bookingId } = input;

  if (audience === "provider") {
    /*
     * MONEY GOES TO THE MONEY SCREEN. `payout.destinationChanged` has no
     * booking and never will: it is about where this person is paid, so
     * `/provider/payouts` is both the honest destination and the screen that
     * shows what the new account is — which is the single judgement the
     * message asks the reader to make ("that is not mine").
     */
    if (kind.startsWith("payout.")) return "/provider/payouts";
    return bookingId ? `/provider/jobs#job-${bookingId}` : "/provider/jobs";
  }

  return bookingId ? `/bookings/${bookingId}` : "/bookings";
}
