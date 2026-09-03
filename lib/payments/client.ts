/**
 * The payments module's isomorphic entry.
 *
 * `@/lib/payments` is server-only — its registry reaches the adapters, and
 * eSewa's signs a form with `node:crypto`. A Client Component importing it
 * fails the build with an unhandled `node:` scheme, which is how this file
 * came to exist: the payment panel needs the method names and the error
 * allow-list, and none of that has any business dragging a gateway with it.
 *
 * Same shape as `lib/auth`, and enforced the same way — `no-restricted-imports`
 * permits exactly this path and `@/lib/payments`, nothing else.
 *
 * WHAT MAY GO IN HERE: pure tables and pure judgements, with no Node builtin
 * and no network anywhere in their import graph. The price rules are here on
 * purpose — the screen should be able to say why a figure needs approving —
 * but they are never the enforcement. That is the server's, every time.
 */

export {
  canRetry,
  canTransitionPayment,
  isInFlight,
  isPaymentMethod,
  isPaymentStatus,
  isSettled,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  type PaymentMethod,
  type PaymentStatus,
} from "./status";

export {
  canSettle,
  judgeFinalAmount,
  PRICE_RULES,
  type PriceVerdict,
} from "./pricing";

export { COMMISSION_BPS, splitAmount, type Split } from "./commission";

export {
  CUSTOMER_PAYMENT_ERRORS,
  paymentErrorKey,
  type CustomerPaymentError,
} from "./errors";
