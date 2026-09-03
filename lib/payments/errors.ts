/**
 * The failure reasons a customer is shown a real sentence for.
 *
 * next-intl renders a missing key as its own dotted path, so an interpolated
 * `errors.${reason}` would put `errors.saveFailed` on screen the first time a
 * reason without copy came back — in the language the reader is least likely
 * to be able to work around. This list is the allow-list, and a test asserts
 * every entry exists in both catalogues.
 *
 * Reasons deliberately absent (saveFailed, notConfigured, unknownReference,
 * bookingNotFound…) are ours, not the customer's: they all collapse to
 * "that didn't work, try again", which is the only useful thing to say about
 * a bug they cannot act on.
 */
export const CUSTOMER_PAYMENT_ERRORS = [
  "alreadyPaid",
  "amountChanged",
  "aboveCeiling",
  "gatewayUnavailable",
  "needsApproval",
  "network",
  "noFinalAmount",
  "notSignedIn",
] as const;

export type CustomerPaymentError = (typeof CUSTOMER_PAYMENT_ERRORS)[number];

/** The message key for a reason, falling back to the generic sentence. */
export function paymentErrorKey(reason: string): string {
  return (CUSTOMER_PAYMENT_ERRORS as readonly string[]).includes(reason)
    ? `errors.${reason}`
    : "errors.failed";
}
