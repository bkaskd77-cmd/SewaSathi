import "server-only";

import { inApp } from "./in-app";
import { push, type PushFailure } from "./push";
import { sms } from "./sms";
import { wakesAPhone, worthAnSms } from "./urgency";
import type { Notification, NotificationChannel } from "./channel";

/**
 * The notify module's public surface.
 *
 * THREE CHANNELS AND THEY ARE NOT PEERS, which is the change this file needed
 * and the reason it is no longer one array. The old shape — "send on every
 * configured channel, in parallel" — is exactly right while every channel is
 * free, and exactly wrong the moment one of them bills per message. SMS costs
 * money and arrives whether or not anybody wanted it; push costs nothing. So:
 *
 *   1. THE IN-APP ROW IS ALWAYS WRITTEN, for every kind, first and
 *      unconditionally. It is the RECORD — what `/bookings` reads, and what is
 *      still true tomorrow — and it must not depend on whether anybody could be
 *      interrupted.
 *
 *   2. PUSH, if this kind is worth interrupting somebody for. Free, so the bar
 *      is only "would they want to know now".
 *
 *   3. SMS, only when push could not reach them AND the kind is worth paying
 *      for. Both halves are required: `WORTH_AN_SMS` is strictly smaller than
 *      `WAKES_A_PHONE`, because "fall back for everything push covers" is how a
 *      free channel's generosity becomes a bill that scales with every booking
 *      this product ever takes.
 *
 * "NOT DELIVERED" MEANS WHAT A SENDER CAN ACTUALLY KNOW. A push service answers
 * 201 when it has taken a message, never when a phone has shown it, and nothing
 * in the web push standard reports whether a human saw anything. So the
 * fallback fires on the two failures that are real and observable — there was
 * nobody to send to, or every endpoint was refused — and not on a read receipt
 * that does not exist. Waiting for one would mean never falling back; assuming
 * delivery would mean the same thing by the other road.
 *
 * NOTHING HERE THROWS. A notification reports something that already happened —
 * the booking is committed, the payment is settled, the row is in the database
 * — so a dead gateway must not roll any of it back or surface as an error to
 * the person who did the thing.
 */

/**
 * Does this push failure earn a message we pay for?
 *
 * PURE AND EXPORTED SO THE TEST READS THE RULE RATHER THAN A COMMENT, because
 * the two entries that are absent are the ones worth arguing about.
 *
 * `notConfigured` DOES NOT ESCALATE. It means WE have not set a VAPID key up,
 * not that this person is unreachable — billing their phone for our own missing
 * configuration is the wrong way round, and in a deployment with no keys it
 * would send an SMS for every notification in the product on the first day.
 *
 * `unreadable` DOES NOT EITHER, for rule 6's reason: a failed read of the
 * subscriptions table is "we could not look", and not knowing whether somebody
 * has a phone is not the same as knowing they do not. Paying on a database
 * hiccup is a bill with no fact behind it.
 */
export function escalatesToSms(failure: PushFailure): boolean {
  return failure === "noSubscription" || failure === "refused";
}

/** Always written, whatever else happens. */
const RECORD: NotificationChannel = inApp;

/**
 * Tell one person about one event, and never throw.
 */
export async function notify(notification: Notification): Promise<void> {
  // 1. The record. Every kind, always, before anything that can be skipped.
  if (RECORD.isConfigured()) {
    const result = await RECORD.send(notification);
    if (!result.ok) {
      console.error(
        `[notify] ${result.channel} failed for ${notification.kind}: ${result.reason}`,
      );
    }
  }

  // 2. Is this worth interrupting somebody for at all? Most kinds are not.
  if (!wakesAPhone(notification.kind)) return;

  const failure = await push.failureFor(notification);
  if (failure === null) return; // Accepted by at least one push service.

  console.warn(`[notify] push ${failure} for ${notification.kind}`);

  // 3. The paid fallback, on both conditions and never on one.
  if (!escalatesToSms(failure)) return;
  if (!worthAnSms(notification.kind)) return;
  if (!sms.isConfigured()) return;

  const result = await sms.send(notification);
  if (!result.ok) {
    console.error(
      `[notify] sms failed for ${notification.kind}: ${result.reason}`,
    );
  }
}

/** Several people, same event. Used when a status change touches both sides. */
export async function notifyAll(
  notifications: Notification[],
): Promise<void> {
  await Promise.all(notifications.map(notify));
}

export type {
  DeliveryResult,
  Notification,
  NotificationChannel,
  NotificationKind,
} from "./channel";

export {
  WAKES_A_PHONE,
  WORTH_AN_SMS,
  wakesAPhone,
  worthAnSms,
} from "./urgency";

export type { PushFailure } from "./push";
