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
  /** First refusal lapsed; the job is now open to other professionals. */
  | "booking.widened"
  /** Nobody took it. The booking has ended rather than waiting for ever. */
  | "booking.noProviderFound";

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
