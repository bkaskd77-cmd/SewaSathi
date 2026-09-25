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
  blindCashEntry,
  canSettle,
  judgeFinalAmount,
  judgeMismatchResolution,
  PRICE_RULES,
  type MismatchChoice,
  type MismatchRuling,
  type PriceVerdict,
  type SettledSource,
} from "./pricing";

export {
  COMMISSION_BPS,
  commissionBasis,
  settleSplit,
  splitAmount,
  type Split,
} from "./commission";

export {
  applyRedoRecovery,
  commissionBpsFor,
  daysSoonerWithDigital,
  isDigital,
  payoutDueAt,
  PAYOUT_RULES,
} from "./payout";

export {
  CUSTOMER_PAYMENT_ERRORS,
  paymentErrorKey,
  type CustomerPaymentError,
} from "./errors";

/*
 * The pure half of the refund rule. `refundRail` and `isRefundStale` decide
 * what a screen says about money already agreed, so both sides of the app need
 * them; nothing here reaches a gateway.
 */
export {
  isRefundStale,
  judgeRefund,
  materialsRead,
  MATERIALS_CEILING_SHARE_BPS,
  refundCeiling,
  refundFunding,
  refundRail,
  REFUND_PAYMENT_DAYS,
  type MaterialsRead,
  type RefundCeiling,
  type RefundRail,
  type RefundSubject,
  type RefundVerdict,
} from "./refund";
