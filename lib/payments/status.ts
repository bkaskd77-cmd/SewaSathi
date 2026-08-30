/**
 * What a payment can become, and from where.
 *
 * Deliberately separate from the booking status machine. A booking can be
 * completed and unpaid — for cash that is the normal case, not an error — so
 * folding the two together would make the ordinary path look broken and would
 * make "mark it complete" and "mark it paid" the same privilege, which they
 * must never be.
 *
 * Mirrored by `payment_transition_allowed()` in 20260902000001_payments.sql.
 * `npm run check:transitions` fails the build if the two disagree.
 */

export const PAYMENT_STATUSES = [
  "pending",
  "initiated",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "esewa", "khalti"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Legal transitions.
 *
 * `pending -> paid` is the cash path: there is no gateway to initiate with, so
 * the customer confirming receipt settles it directly.
 *
 * `failed -> initiated` is the retry, and it is the reason a retry reuses the
 * booking but never the reference — the reference is the idempotency key, and
 * reusing it would make the second attempt indistinguishable from a duplicate
 * callback for the first.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["initiated", "paid", "failed"],
  initiated: ["paid", "failed"],
  failed: ["initiated", "pending"],
  paid: ["refunded", "partially_refunded"],
  partially_refunded: ["refunded", "partially_refunded"],
  refunded: [],
};

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Money has arrived. */
export function isSettled(status: PaymentStatus): boolean {
  return status === "paid" || status === "partially_refunded";
}

/** The customer may try again. */
export function canRetry(status: PaymentStatus): boolean {
  return status === "failed";
}

/**
 * Waiting on a gateway we have handed the customer to.
 *
 * This is the state reconciliation exists for: the customer is off on eSewa's
 * page and we have not heard back. On mobile data here, "not heard back" is
 * routine rather than exceptional.
 */
export function isInFlight(status: PaymentStatus): boolean {
  return status === "initiated";
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}
