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
  holdbackTrades,
  holdsBack,
  isDigital,
  payoutDueAt,
  payoutPlan,
  PAYOUT_RULES,
  type PayoutPlan,
} from "./payout";

/*
 * Masking and the cooldown. Pure — no Node builtin, no network — so it belongs
 * on this side even though the only caller today is server code: `maskAccountRef`
 * is what a form uses to echo back the number somebody just typed, and a second
 * implementation of "how much of an account shows" is exactly what
 * `lib/payments/destination.ts` exists to prevent.
 */
export {
  destinationReadiness,
  destinationUsableFrom,
  heldReasonFor,
  maskAccountRef,
  whyWaiting,
  type DestinationReadiness,
  type PayoutHeldReason,
  type PayoutWait,
} from "./destination";

/*
 * What one payout IS. Pure, and shared by the redo recovery and the payout run
 * so the two cannot disagree about what a quarter is a quarter of.
 */
export {
  payableTranches,
  type PayableTranche,
  type SettledBooking,
} from "./tranches";

/*
 * The payout machine. Pure, and on this side for the same reason the booking
 * machine is: a screen that renders a status badge needs the list, and a second
 * copy of "what may follow what" is how two surfaces come to disagree about
 * whether a payout can still be failed.
 */
export {
  canTransitionPayout,
  isPayoutStatus,
  needsReversal,
  PAYOUT_STATUSES,
  PAYOUT_TRANSITIONS,
  UNRESOLVED_PAYOUT_STATUSES,
  type PayoutStatus,
} from "./payout-status";

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
