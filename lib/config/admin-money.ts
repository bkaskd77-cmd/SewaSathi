/**
 * Which admin writes move money, and what proves the person is still there.
 *
 * WHY THIS FILE EXISTS. `/admin/payouts` has needed a fifteen-minute proof of
 * identity since it shipped — `REAUTH_WINDOW_MINUTES`, read off the session's
 * `amr` claim and threaded into `lib/data/payouts.ts`. Six other admin actions
 * move real rupees and had nothing but the eight-hour `STEP_UP_HOURS` window
 * behind them, including `sendRefundToGateway`, which initiates a transfer.
 * There was no reason for the split beyond their having been written on
 * different days, and nothing in the repository could see it: the gap was found
 * by reading every action in a pre-launch audit, which is the slowest possible
 * detector and runs once.
 *
 * SO THE RULE IS MECHANICAL NOW, the shape `MONEY_ASSERTIONS` already uses one
 * concern over. Every money-moving data-layer function an admin action can
 * reach is declared here with how its proof arrives, and
 * `tests/unit/admin-money-reauth.test.ts` reads the action sources through the
 * TypeScript AST and fails when one of them is called without it.
 *
 * THE COVERAGE HALF IS THE POINT, not the list. A list alone goes stale the
 * first time somebody adds an action; the test also fails on any function
 * imported from a money module by an admin action and not declared here, so the
 * question "and does this move money?" is asked when the action is written
 * rather than at the next audit.
 *
 * Pure and dependency-free so the test can reach it without a session, a
 * database or a build.
 */

/**
 * The modules a money write can live in.
 *
 * Deliberately a short list of whole modules rather than a pattern over
 * function names: a name tells you nothing — `settleNoShowClaim` and
 * `resolveTripDebtDispute` both move money and neither says so — while the
 * module a writer lives in is a fact about where this product keeps its money
 * code. An admin action importing from one of these is the trigger for the
 * question, never the answer to it.
 *
 * WHAT IS DELIBERATELY NOT HERE, said out loud so the omissions read as
 * decisions rather than as oversights. `@/lib/data/bands` publishes a price
 * band: it changes what a FUTURE quote is framed by, with its own evidence
 * screen and its own stored rejection, and it moves nothing on a booking that
 * has already been taken. `@/lib/data/recovery` and `@/lib/data/duration-loop`
 * do move money and have no admin caller at all — they run from the reconcile
 * cron, where `CRON_SECRET` is the gate and a second factor is meaningless.
 * Adding an admin screen over either one puts its module on this list in the
 * same commit.
 */
export const MONEY_MODULES: readonly string[] = [
  "@/lib/data/ai-ceilings",
  "@/lib/data/claims",
  "@/lib/data/customer-risk",
  "@/lib/data/payments",
  "@/lib/data/payout-destinations",
  "@/lib/data/payouts",
  "@/lib/data/survey",
];

/**
 * How the fifteen-minute proof reaches a writer.
 *
 * `fresh-actor` — the action calls `freshAdminActor()`, which refuses before
 *                 anything is read or written. The shape for a writer whose
 *                 only caller is one admin action.
 * `threaded`    — the action reads `sessionAuthenticatedAt()` and passes it in;
 *                 the data layer runs `isFresh` itself. The shape for a writer
 *                 that must refuse on its own account because something other
 *                 than an admin screen can reach it.
 * `none`        — deliberately no second proof, with the reason stated. A code
 *                 demanded for a write that cannot cost anybody anything is how
 *                 people learn to tap through the ones that can.
 */
export type MoneyProof = "fresh-actor" | "threaded" | "none";

export type AdminMoneyWrite = {
  /** The exported function, as an action imports it. */
  fn: string;
  /** Which of `MONEY_MODULES` it comes from. */
  module: string;
  proof: MoneyProof;
  why: string;
};

export const ADMIN_MONEY_WRITES: readonly AdminMoneyWrite[] = [
  {
    fn: "issueRefund",
    module: "@/lib/data/claims",
    proof: "fresh-actor",
    why: "Decides how much of a customer's money goes back, and funds it from a professional's future earnings. One tap, one figure, and `refundFunding` is run on the screen beside it — this is the decision, not a record of one.",
  },
  {
    fn: "markRefundPaid",
    module: "@/lib/data/claims",
    proof: "fresh-actor",
    why: "Asserts that money left. `guarantee_claims.refund_rupees` may legitimately lag the payment, so this write is what closes that gap — a false one records a refund nobody sent and closes the claim behind it.",
  },
  {
    fn: "sendRefundToGateway",
    module: "@/lib/data/claims",
    proof: "fresh-actor",
    why: "The only admin action in the product that moves money on a rail with no person in between. Everything else here records a decision somebody then carries out by hand.",
  },
  {
    fn: "settleNoShowClaim",
    module: "@/lib/data/customer-risk",
    proof: "fresh-actor",
    why: "Pays `trip_compensation` to a professional and adds the matching debt to a customer. Two ledgers move on one tap.",
  },
  {
    fn: "resolveTripDebtDispute",
    module: "@/lib/data/customer-risk",
    proof: "fresh-actor",
    why: "`cancel` zeroes a customer's carried balance. Writing off somebody's debt is moving money as surely as paying it.",
  },
  {
    fn: "resolveCommissionAppeal",
    module: "@/lib/data/payments",
    proof: "fresh-actor",
    why: "Waives the commission floor and recomputes the split, so our fee and their earning both change on a booking that was already settled.",
  },
  {
    fn: "resolveAmountMismatch",
    module: "@/lib/data/payments",
    proof: "fresh-actor",
    why: "Sets the final amount on a disputed cash job, which decides the fee, the earning and the guarantee ceiling together. The adjudicated branch takes a figure typed into a box.",
  },
  {
    fn: "decideSurveyVisitFee",
    module: "@/lib/data/survey",
    proof: "fresh-actor",
    why: "Approves a trip fee we pay. The monthly cap bounds the damage and does not remove it.",
  },
  {
    fn: "revealDestination",
    module: "@/lib/data/payout-destinations",
    proof: "fresh-actor",
    why: "Not a transfer — a DISCLOSURE, and the only path in the product that returns a bank account number. An eight-hour window on an unlocked phone is every professional's account, read one at a time. The audit row records who asked; it does not stop them.",
  },
  {
    fn: "confirmFirstPayout",
    module: "@/lib/data/payout-destinations",
    proof: "fresh-actor",
    why: "The human witness in the account-takeover control: a destination nobody could be notified about waits here. Somebody who can confirm their own new account from a walked-up session has removed the only check that is not another session.",
  },
  {
    fn: "saveAiLimits",
    module: "@/lib/data/ai-ceilings",
    proof: "fresh-actor",
    why: "A ceiling raised from one dollar to a hundred is a hundred-dollar decision taken in one box. It did this check inline before this list existed, with its own copy of the arithmetic.",
  },
  {
    fn: "approvePayout",
    module: "@/lib/data/payouts",
    proof: "threaded",
    why: "A week of somebody's earnings. Threaded rather than gated at the action because `lib/data/payouts.ts` is reached by the weekly run as well, and a writer that refuses on its own account cannot be routed around by a second caller.",
  },
  {
    fn: "markPayoutSent",
    module: "@/lib/data/payouts",
    proof: "threaded",
    why: "Records that the money went, and re-reads the destination as it does. Same module, same reasoning as the approval.",
  },
  {
    fn: "markPayoutFailed",
    module: "@/lib/data/payouts",
    proof: "threaded",
    why: "Reverses a sent payout, which writes the ledger back. Same module, same reasoning.",
  },
  {
    fn: "markPayoutConfirmed",
    module: "@/lib/data/payouts",
    proof: "none",
    why: "It records an answer that came from outside — a bank said the transfer landed — and moves no money of its own. A code demanded for a write that cannot cost anybody anything is how people learn to tap through the ones that can.",
  },
];

/** The declaration for one writer, or null if nobody has made one. */
export function moneyWriteFor(fn: string): AdminMoneyWrite | null {
  return ADMIN_MONEY_WRITES.find((write) => write.fn === fn) ?? null;
}
