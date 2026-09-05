/**
 * What the platform takes, in one place.
 *
 * Payouts are a later phase. This exists now because the landing page already
 * promises weekly payouts, and reconstructing months of owed money later —
 * from category prices that will have changed in the meantime — is far more
 * expensive than recording it from the first booking.
 *
 * 15% is the rate. It sits between what an established marketplace charges
 * (20-30%, which a platform with no supply cannot ask for) and what does not
 * cover verification, support and payment fees. It is one number here and
 * frozen onto each booking at completion, so changing it never restates what a
 * professional was already told they had earned.
 *
 * Basis points, not a float: 15% is 1500, the arithmetic is integer, and there
 * is no rounding drift to argue about six months later.
 */

/**
 * 15%, IN BASIS POINTS, CHARGED TO THE PROFESSIONAL.
 *
 * It comes out of what they are paid; it is never added to what the customer
 * is quoted or billed. The customer's price is the band on the booking and the
 * final amount agreed on site, and no constant in this module or in `payout.ts`
 * can move either of them.
 */
export const COMMISSION_BPS = 1500;

export type Split = {
  /** What the customer pays. */
  total: number;
  /** What SajiloKaam keeps. */
  platformFee: number;
  /** What the professional is owed. */
  providerEarning: number;
  /** The rate applied, frozen onto the booking alongside the amounts. */
  commissionBps: number;
  /** The figure the fee was actually charged on. See `commissionBasis`. */
  basis: number;
  /** True when the floor lifted the basis above what was collected. */
  floorApplied: boolean;
};

/**
 * WHAT THE FEE IS CHARGED ON — the floor, and why it is the whole answer to
 * under-reporting.
 *
 * A professional takes Rs 2,000 in cash and types 1,000. Every validation in
 * this product can be satisfied by that: the amount is inside the band, the
 * customer is standing there and may even have agreed to it, and no server
 * anywhere saw the notes change hands. Policing it by checking the number is
 * chasing the symptom.
 *
 * So the fee is charged on `max(final_amount, quoted_min)`. The band is ours —
 * published before the booking, frozen onto the row, not editable from any
 * browser — so under-reporting DOWN TO the floor earns the professional
 * nothing at all, and under-reporting below it costs them the same fee on a
 * smaller job. The motive is removed rather than the report policed.
 *
 * IT MUST NOT PUNISH AN HONEST SMALL JOB, and sometimes a job genuinely lands
 * under the band: the tap only needed a washer. Two things answer that. Per
 * job, the professional appeals and support waives the floor (`floorWaived`),
 * which is why this takes it as an argument rather than reading a rule. Across
 * a category, `category_pricing_signals` counts how often jobs land under the
 * floor — and if they bunch there, the band is wrong and OUR price needs
 * correcting. That is a pricing bug on our side, not a provider penalty, and
 * it is the reason the frequency is tracked per category rather than per
 * person.
 */
export function commissionBasis(
  finalAmount: number,
  quotedMin: number,
  floorWaived = false,
): number {
  if (floorWaived) return finalAmount;
  return Math.max(finalAmount, quotedMin);
}

/**
 * Split a settled amount.
 *
 * The fee is rounded and the professional gets the remainder, rather than both
 * being rounded independently — otherwise the two can fail to sum to what the
 * customer actually paid, and a payout report that does not reconcile to the
 * penny is a payout report nobody trusts.
 */
export function splitAmount(
  total: number,
  commissionBps: number = COMMISSION_BPS,
): Split {
  return settleSplit({ amount: total, quotedMin: 0, commissionBps });
}

/**
 * The split as it is actually frozen onto a booking.
 *
 * The fee comes off the basis; the professional keeps what is left OF WHAT WAS
 * COLLECTED, which is the one invariant that matters when the two differ. The
 * fee is capped at the amount collected so an earning can never go negative —
 * a professional who reports Rs 200 on a job with a Rs 900 floor keeps nothing
 * that time, and is told why and how to appeal, but is never handed a bill.
 *
 * The fee is rounded and the earning is the remainder, so the two always sum
 * to the amount charged. A payout report that does not reconcile to the rupee
 * is a payout report nobody trusts.
 */
export function settleSplit(input: {
  /** What the customer actually paid. */
  amount: number;
  /** The booking's frozen lower band. */
  quotedMin: number;
  commissionBps?: number;
  /** Set by support when an appeal is upheld. */
  floorWaived?: boolean;
}): Split {
  const commissionBps = input.commissionBps ?? COMMISSION_BPS;
  const basis = commissionBasis(
    input.amount,
    input.quotedMin,
    input.floorWaived,
  );
  const platformFee = Math.min(
    Math.round((basis * commissionBps) / 10_000),
    input.amount,
  );

  return {
    total: input.amount,
    platformFee,
    providerEarning: input.amount - platformFee,
    commissionBps,
    basis,
    floorApplied: basis > input.amount,
  };
}
