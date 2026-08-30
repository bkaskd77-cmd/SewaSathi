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
};

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
  const platformFee = Math.round((total * commissionBps) / 10_000);
  return {
    total,
    platformFee,
    providerEarning: total - platformFee,
    commissionBps,
  };
}
