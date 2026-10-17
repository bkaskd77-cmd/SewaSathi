import type { NotificationKind } from "./channel";

/**
 * Which notifications are worth waking a phone for, and which are worth paying
 * for.
 *
 * TWO QUESTIONS, NOT ONE, AND COLLAPSING THEM IS THE EXPENSIVE MISTAKE. Push
 * costs nothing, so the bar is "would this person want their phone to buzz".
 * SMS costs money per message and arrives whether or not anybody wanted it, so
 * its bar is higher: it is the fallback for somebody who cannot be reached any
 * other way, about something that stops if they do not answer.
 *
 * A PUSH FOR EVERYTHING IS A PUSH FOR NOTHING. There are twenty-six kinds and
 * most of them are a record rather than a summons — `booking.quoteApproved`
 * tells a professional something good happened, and nobody needs to be
 * interrupted for it. A product that buzzes on all twenty-six teaches people to
 * swipe the notification away without reading, and the one that mattered goes
 * with the rest. So `WAKES_A_PHONE` is an allow-list and the default is
 * silence, which is the same shape as `LIST_NOTES` one file over and for the
 * same reason: a kind added to the union and not considered here is quiet,
 * which is the honest failure.
 *
 * EVERY KIND STILL WRITES ITS IN-APP ROW. Nothing below decides whether
 * somebody is told; it decides whether they are INTERRUPTED. The record is the
 * `notifications` table and it is always written.
 */

/**
 * The kinds that interrupt.
 *
 * Each is here for one of three reasons, named in its comment: work being
 * offered, a job moving while somebody is waiting on it, or a question that
 * stops the job until it is answered.
 */
export const WAKES_A_PHONE: readonly NotificationKind[] = [
  /* --- Work offered. A job nobody picks up is a customer with nobody coming. --- */
  /** The customer chose this professional after somebody else refused. */
  "booking.assigned",
  /** First refusal lapsed; the job is open. This is the offer going out wide. */
  "booking.widened",

  /* --- A job moving, while somebody is waiting on exactly this. --- */
  "booking.accepted",
  "booking.en_route",
  /** Somebody is at the door. The one notification that exists to PREVENT a claim. */
  "booking.providerArrived",
  "booking.in_progress",
  "booking.completed",
  /** The professional withdrew. The customer needs to pick somebody else. */
  "booking.declined",
  /** We took the professional off the job. Same need, a different cause. */
  "booking.providerUnavailable",
  /** Nobody took it. Ending is news; silence would read as still looking. */
  "booking.noProviderFound",
  /** The person who was coming has run out of day. */
  "booking.mayRunLate",

  /* --- A gate. The job does not move until this is answered. --- */
  /** A surveyed price is ready and nothing starts until the customer says yes. */
  "booking.quoteReady",
  /** Nobody answered in time; the price is no longer one anybody can honour. */
  "booking.quoteExpired",
  /** The product turned out to be a different one. `in_progress` is refused until answered. */
  "booking.priceCorrected",
  /** The two cash figures disagree. Nothing settles until a person looks. */
  "payment.mismatch",

  /*
   * --- The security one. ---
   *
   * WHERE SOMEBODY IS PAID HAS BEEN CHANGED, and the whole value of this
   * message is reaching a person who did NOT do it. `lib/notify/channel.ts`
   * records the trap for the SMS channel: an attacker who takes an account over
   * changes the phone number too, so a channel reading `provider_contacts` at
   * send time warns them about their own theft.
   *
   * PUSH DOES NOT HAVE THAT PROBLEM AND IT IS WORTH SAYING WHY. A subscription
   * is held by a browser and a push service, and nothing inside this product
   * can redirect one — an attacker with the password cannot move the victim's
   * endpoint, only add their own. Sending to EVERY live subscription for the
   * account therefore reaches the handset in the real person's pocket, which is
   * exactly what `DESTINATION_COOLDOWN_HOURS` buys them the time to act on.
   */
  "payout.destinationChanged",
];

/**
 * The kinds worth sending an SMS about when push could not be used.
 *
 * STRICTLY SMALLER THAN THE LIST ABOVE, AND THAT IS THE POINT. SMS costs per
 * message, the gateway is not contracted yet, and "the fallback for everything
 * push covers" is how a free channel's generosity becomes a bill. So the test
 * is harder: something STOPS, or somebody is owed a warning they cannot get any
 * other way.
 *
 * `booking.en_route` IS DELIBERATELY NOT HERE although a customer would like
 * it. Nothing stops if they miss it — the professional still arrives, and the
 * in-app row and the live booking page both say so. Paying per message for a
 * progress update is the charge that scales with every booking we ever take.
 */
export const WORTH_AN_SMS: readonly NotificationKind[] = [
  /* Work offered: a job that is not picked up is a customer with nobody coming. */
  "booking.assigned",
  "booking.widened",
  /* Gates: the job is stopped until somebody answers. */
  "booking.quoteReady",
  "booking.priceCorrected",
  "payment.mismatch",
  /* Ending: silence would read as "still looking". */
  "booking.noProviderFound",
  /*
   * The professional was taken off the job by us. Worth paying for because the
   * customer is otherwise waiting at home for somebody who is not coming, and
   * because we caused it — a notification we are the reason for is not one to
   * leave to whether they happen to open the app.
   */
  "booking.providerUnavailable",
  /* Somebody is at the door right now and the clock on a wasted trip is running. */
  "booking.providerArrived",
];

/**
 * `payout.destinationChanged` IS PUSH-ONLY AND IS DELIBERATELY ABSENT ABOVE.
 *
 * It is the kind with the strongest claim to an SMS — somebody's earnings are
 * being redirected and they may have hours to object — and it is the one kind
 * this product must not send one for yet. `lib/notify/channel.ts` wrote the
 * trap down before any channel existed: every other kind may look the
 * recipient's number up at delivery, and this one must deliver to the contact
 * AS IT STOOD BEFORE THE CHANGE, because somebody who has taken an account over
 * changes the phone number too. A channel reading the number at send time
 * warns the attacker about their own theft and tells the real person nothing.
 *
 * NOTHING IN THIS SCHEMA CAN ANSWER "WHAT WAS THE NUMBER BEFORE". There is no
 * history on `provider_contacts` and none on `profiles.phone`, so an SMS here
 * could only be sent to whatever the account says now — which is precisely the
 * wrong number in the only scenario that matters.
 *
 * PUSH HAS NO SUCH PROBLEM, which is why this kind is in `WAKES_A_PHONE`. A
 * subscription is held by a browser and a push service and nothing inside this
 * product can redirect one: an attacker with the password can add their own
 * device but cannot take the victim's away, so sending to every live
 * subscription reaches the handset in the real person's pocket. The warning
 * goes where it can be trusted and nowhere else.
 *
 * WHAT WOULD CHANGE THIS is a recorded history of the contact number with the
 * instant each became current — then the SMS goes to the one in force before
 * the change, and this kind joins the list above. That is a schema decision
 * and it is not being taken speculatively here.
 */

/** Should this kind interrupt somebody? */
export function wakesAPhone(kind: NotificationKind): boolean {
  return WAKES_A_PHONE.includes(kind);
}

/** Is this worth a message we pay for, when push was not available? */
export function worthAnSms(kind: NotificationKind): boolean {
  return WORTH_AN_SMS.includes(kind);
}
