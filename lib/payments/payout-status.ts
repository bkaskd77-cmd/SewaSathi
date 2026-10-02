/**
 * What a payout can become, and from where.
 *
 * A THIRD MACHINE, DELIBERATELY SEPARATE FROM THE OTHER TWO. A payment is money
 * arriving from a customer; a payout is money leaving towards a professional, and
 * the two are not mirror images — a booking can be paid and its payout not yet
 * drafted, drafted and not approved, sent and not confirmed. Folding them
 * together would make "the customer paid" and "the professional was paid" the
 * same fact, which is exactly the conflation the whole ledger exists to prevent.
 *
 * Mirrored by `payout_transition_allowed()` in
 * 20261001000003_payouts.sql. `npm run check:transitions` fails the build if the
 * two disagree.
 */

export const PAYOUT_STATUSES = [
  /** The run worked out what is owed. Nobody has looked and no money has moved. */
  "draft",
  /** A person checked it. Still no money. */
  "approved",
  /** Handed to a rail. We believe it is on its way and cannot prove it yet. */
  "sent",
  /** The rail says it arrived. */
  "confirmed",
  /** The rail says it did not. The amount goes back to the ledger. */
  "failed",
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * Legal transitions.
 *
 * `draft -> failed` IS ALLOWED AND IS NOT A PAYMENT FAILURE. A draft can be
 * abandoned — the professional's destination went into cooldown, their listing
 * closed, the period was recalculated — and the ledger has to be able to say so
 * rather than leaving a draft that never resolves. Nothing was sent, so nothing
 * is reversed.
 *
 * `sent -> failed` is the one that moves money back. A `payout` row was written
 * when it was sent, so the failure writes a `payout_reversal` and the balance
 * returns to what it was.
 *
 * `confirmed` IS TERMINAL AND `failed` IS NOT. A confirmed payout that turns out
 * to have bounced is a new fact, not an edit of an old one — it is handled by a
 * reversal and a fresh draft, so that the record keeps both. A failed one may be
 * retried, which is a new row for the same reason `payments` mints a new
 * reference on retry: reusing the old one makes attempt two indistinguishable
 * from a duplicate of attempt one.
 */
export const PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  draft: ["approved", "failed"],
  approved: ["sent", "failed"],
  sent: ["confirmed", "failed"],
  confirmed: [],
  failed: [],
};

export function isPayoutStatus(value: unknown): value is PayoutStatus {
  return (PAYOUT_STATUSES as readonly string[]).includes(value as string);
}

export function canTransitionPayout(
  from: PayoutStatus,
  to: PayoutStatus,
): boolean {
  return PAYOUT_TRANSITIONS[from].includes(to);
}

/**
 * Has this payout put money into the ledger that a failure must take back out?
 *
 * ONLY FROM `sent`. A draft and an approval have moved nothing, so reversing one
 * would credit a professional for a payment nobody made. The state machine knows
 * this and the caller should not have to re-derive it.
 */
export function needsReversal(from: PayoutStatus): boolean {
  return from === "sent";
}

/**
 * The statuses that mean "this payout is not finished with".
 *
 * ONE LIST WRITTEN TWICE — here and as the predicate of
 * `payouts_one_in_flight_idx` in `20261002000003_one_payout_in_flight.sql`, which is
 * what refuses a second unresolved payout for the same professional.
 * `tests/db/payout-run.test.ts` reads the index definition and compares, the
 * arrangement `LOGGABLE_REASONS` and `CRON_JOBS` already use: the two would
 * otherwise drift, and the drift is silent in the worst direction — a status added
 * here but not to the index lets a second payout through for the money the first one
 * already claims.
 *
 * DERIVED FROM THE MACHINE rather than typed out, so a sixth status cannot be
 * forgotten: anything with somewhere left to go is unresolved, and `confirmed` and
 * `failed` are exactly the two that do not.
 */
export const UNRESOLVED_PAYOUT_STATUSES = PAYOUT_STATUSES.filter(
  (status) => PAYOUT_TRANSITIONS[status].length > 0,
);
