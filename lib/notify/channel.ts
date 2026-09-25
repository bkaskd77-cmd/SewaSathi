/**
 * The contract every notification channel satisfies.
 *
 * In-app today; SMS and push are Phase 13 and must be one new file each plus a
 * line in the registry. That is the adapter law, and it is worth stating what
 * it buys here specifically: the thing that decides *what* happened — a
 * booking moved to en_route — should never also know how a message reaches a
 * phone. Those change for completely different reasons.
 *
 * A NOTIFICATION CARRIES A KEY, NOT A SENTENCE. `kind` is a message-catalogue
 * key and `params` are its placeholders. A sentence baked in English at write
 * time cannot be read back in Nepali, and the reader's language is a property
 * of the reader — it can even change between the event and the reading. Every
 * channel therefore renders at delivery, from the recipient's own language.
 */

export type NotificationKind =
  | "booking.accepted"
  | "booking.en_route"
  | "booking.in_progress"
  | "booking.completed"
  | "booking.cancelled"
  | "booking.declined"
  /** The customer picked this professional after somebody else refused. */
  | "booking.assigned"
  | "booking.amountEntered"
  | "booking.paid"
  /**
   * The receipt, to both sides, on every settlement.
   *
   * Carries the recorded amount, which is the point: somebody who paid Rs
   * 2,000 and receives a receipt for Rs 1,000 finds out after the professional
   * has left, when saying so costs them nothing.
   */
  | "payment.receipt"
  /** The two figures for a cash job disagreed. Nothing settles until a person looks. */
  | "payment.mismatch"
  /**
   * A person looked, and the job settled at a figure.
   *
   * BOTH SIDES GET IT, and it names the amount. The one who was told their
   * number was not the one used should hear that from us rather than work it
   * out from a receipt — and the professional waiting to be paid should know
   * the hold has started.
   */
  | "payment.mismatchResolved"
  /** First refusal lapsed; the job is now open to other professionals. */
  | "booking.widened"
  /** Nobody took it. The booking has ended rather than waiting for ever. */
  | "booking.noProviderFound"
  /**
   * A surveyed price is ready and the customer has to answer it.
   *
   * THE ONE NOTIFICATION THAT IS ALSO A GATE. Nothing can start on a
   * survey-priced job until the customer approves the figure, so this is not a
   * progress update somebody can ignore — it is the step. One tap from here to
   * the button, because the approval is the drop-off point on the highest-value
   * trade we sell.
   */
  | "booking.quoteReady"
  /** Nobody answered in time. The price is no longer one anybody can honour. */
  | "booking.quoteExpired"
  | "booking.quoteApproved"
  /**
   * The customer said no. Sent so the professional knows the job is over, and
   * deliberately NOT counted anywhere: a customer turning down a price is not
   * a professional failing.
   */
  | "booking.quoteDeclined"
  /**
   * The professional says the job is a different product, and the customer has
   * to answer before work starts.
   *
   * A GATE, LIKE `booking.quoteReady`, NOT A PROGRESS UPDATE. `in_progress` is
   * refused until they answer, so ignoring it stops the job rather than
   * delaying a screen. Separate from the survey keys on purpose: this is a
   * banded job whose product turned out wrong, and telling somebody their
   * "survey" is ready would be a sentence about a thing that never happened.
   */
  | "booking.priceCorrected"
  /** They agreed. The professional can start. */
  | "booking.priceCorrectionApproved"
  /**
   * They said no, so the job is ending. Deliberately NOT counted against
   * anybody: a customer declining a price is not a professional failing, and a
   * professional correcting an understated product is the honest move this
   * whole mechanism exists to make safe.
   */
  | "booking.priceCorrectionDeclined"
  /**
   * The professional who offered to squeeze this job in has run out of day.
   *
   * SENT TO THE CUSTOMER, and it is the point of counting misses at all: an
   * offer nobody can rely on is worse than no offer. The job reopens
   * immediately and the customer is told, rather than finding out on the day
   * from somebody who does not arrive — which is the failure slot capacity
   * exists to prevent and which an unchecked offer would reintroduce.
   */
  | "booking.mayRunLate"
  /**
   * A review has come out of its envelope.
   *
   * Sent to the professional when the pair publishes — not when the customer
   * writes it. Telling them earlier would be the leak double-blind exists to
   * stop, and telling them not at all would mean a public record about their
   * work appearing with no notice at all.
   */
  | "review.published"
  /**
   * A job has come back. Sent to the professional whose work it was, because
   * the common path — and the cheap one — is that they go round themselves.
   */
  | "claim.opened"
  /** Somebody has been and looked. Carries the verdict, which decides who pays. */
  | "claim.resolved"
  /**
   * A redo was attended by somebody else, so the amount is now a debt netted
   * off future earnings. Told, never billed: a deduction nobody can account
   * for is worse than the deduction.
   */
  | "claim.ledger"
  /**
   * Money back has been agreed. NOT that it has been sent.
   *
   * Two of our three rails cannot move money from inside this product — eSewa
   * has no merchant-initiated refund on ePay v2, cash comes back the way it
   * went out — so approval and payment are genuinely two events and the
   * customer is told about each. One message covering both would have to be
   * written before the second happened, which is how a product says "sent"
   * about money nobody has sent.
   */
  | "claim.refundApproved"
  /** It has actually gone, with the reference it went under. */
  | "claim.refundSent";

export type Notification = {
  /** Who it is for. Their language is read at delivery, not passed in. */
  recipientId: string;
  kind: NotificationKind;
  /** Placeholders for the catalogue entry: a reference, a name, an amount. */
  params: Record<string, string>;
  bookingId: string | null;
};

export type DeliveryResult =
  | { ok: true; channel: string }
  /**
   * A channel that could not deliver. Never thrown: a booking must not fail
   * because an SMS gateway is down, and a notification is not the event — the
   * event is already in the database.
   */
  | { ok: false; channel: string; reason: string };

export type NotificationChannel = {
  name: string;
  /** False when its credentials are absent, so it is skipped rather than failing. */
  isConfigured(): boolean;
  send(notification: Notification): Promise<DeliveryResult>;
};

/* ------------------------------------------------------------------ *
 * Reading a kind back as a sentence
 * ------------------------------------------------------------------ */

/**
 * The catalogue key for one notification kind, or null if it has no sentence.
 *
 * THE BUG THIS EXISTS TO STOP, AND IT WAS ALREADY SHIPPED. `/bookings` turned
 * a kind into a key by stripping the `booking.` prefix and interpolating the
 * rest — which is correct for exactly the kinds that carry it and wrong for
 * every other. next-intl reads a dot as nesting, so an unread `claim.resolved`
 * rendered `booking.notifications.claim.resolved` onto a customer's list: not
 * a build error, not a runtime error, just the key path printed on the page in
 * the language they are least likely to be reading. The catalogue check cannot
 * see it either, since both languages are equally missing it.
 *
 * AN ALLOW-LIST, LIKE `KNOWN_CORRECTION_ERRORS` AND FOR THE SAME REASON. A
 * kind added to the union above and not given copy returns null and shows
 * nothing, which is the honest failure: the card simply carries no note, the
 * same as a booking nothing has happened to. Interpolating would guarantee the
 * opposite — the more kinds this product grows, the more key paths leak onto
 * the one screen a customer opens to see whether anybody is coming.
 */
const LIST_NOTES: Partial<Record<NotificationKind, string>> = {
  "booking.accepted": "accepted",
  "booking.en_route": "en_route",
  "booking.in_progress": "in_progress",
  "booking.completed": "completed",
  "booking.cancelled": "cancelled",
  "booking.declined": "declined",
  "booking.assigned": "assigned",
  "booking.amountEntered": "amountEntered",
  "booking.paid": "paid",
  "booking.widened": "widened",
  "booking.noProviderFound": "noProviderFound",
  "booking.mayRunLate": "mayRunLate",
  "booking.quoteReady": "quoteReady",
  "booking.quoteExpired": "quoteExpired",
  "booking.quoteApproved": "quoteApproved",
  "booking.quoteDeclined": "quoteDeclined",
  "booking.priceCorrected": "priceCorrected",
  "booking.priceCorrectionApproved": "priceCorrectionApproved",
  "booking.priceCorrectionDeclined": "priceCorrectionDeclined",
  "payment.receipt": "receipt",
  "payment.mismatch": "mismatch",
  "payment.mismatchResolved": "mismatchResolved",
  "review.published": "reviewPublished",
  "claim.refundApproved": "refundApproved",
  "claim.refundSent": "refundSent",
};

/** Every kind that has a sentence on the bookings list. Exported for the test. */
export const LIST_NOTE_KINDS = Object.keys(LIST_NOTES) as NotificationKind[];

/**
 * `booking.notifications.<key>` for this kind, or null.
 *
 * Returns the leaf only — the namespace belongs to the screen, so a second
 * screen can read the same kinds under its own.
 */
export function listNoteKey(kind: string): string | null {
  return LIST_NOTES[kind as NotificationKind] ?? null;
}
