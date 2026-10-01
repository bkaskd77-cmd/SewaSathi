/**
 * What counts as one payout, decided once.
 *
 * WHY THIS IS ITS OWN MODULE RATHER THAN A HELPER IN EITHER CALLER. Two things
 * need to agree about what a payout is: the redo recovery, which takes at most a
 * quarter of any one payout, and the payout run, which pays them. If each
 * selected its own tranches the published quarter would be a quarter of
 * something the other had never heard of — and the disagreement would be silent,
 * because both would be internally consistent and only the professional's bank
 * balance would show it. The `applicationMatchKeys` lesson: two callers building
 * the same shape is one list written twice with a failure at the end of it.
 *
 * ONE BOOKING IS ONE OR TWO PAYOUTS. `payoutPlan` holds a quarter of a
 * long-guarantee earning back for 30 days, so a booking has two payable dates
 * and each is a payout in its own right. The published sentence — never more
 * than a quarter of any one payout — is measured against each separately, on the
 * money actually arriving that day. A quarter of the whole earning taken out of
 * the smaller first tranche would be a third of what lands, against a page
 * promising a quarter.
 *
 * THE DATES ARE CHECKED HERE, NOT ONLY IN THE QUERY. Both callers filter on
 * `payout_due_at` before reading, and that filter is an optimisation; this is the
 * rule. Same arrangement as `provider_ledger_recovery_tranche_idx` being the real
 * guard with the caller's filter in front of it — a selection that is only
 * correct when the SQL is correct has two places to be wrong.
 *
 * Pure: no database, no `server-only`. It is the thing both server modules ask.
 */

/** One payable tranche of one booking. */
export type PayableTranche = {
  bookingId: string;
  reference: string | null;
  providerId: string;
  tranche: "main" | "holdback";
  /**
   * The money actually arriving on that date, not the whole settlement — which
   * is the entire point of splitting them.
   */
  earning: number;
};

/** A settled booking, as either caller reads it. */
export type SettledBooking = {
  id: string;
  reference: string | null;
  provider_id: string;
  provider_earning: number | null;
  payout_due_at: string | null;
  payout_holdback_rupees: number | null;
  payout_holdback_until: string | null;
};

/**
 * Every tranche of these bookings that is payable by `now`.
 *
 * A booking with no `payout_due_at` yields nothing: the date is stamped at
 * settlement, so its absence means the money is not due rather than that it is
 * due immediately. Rule 6 — an unset column is not a measurement of zero.
 */
export function payableTranches(
  bookings: readonly SettledBooking[],
  now: Date,
): PayableTranche[] {
  const at = now.toISOString();
  const tranches: PayableTranche[] = [];

  for (const booking of bookings) {
    if (!booking.payout_due_at || booking.payout_due_at > at) continue;

    const earning = Number(booking.provider_earning ?? 0);
    if (!Number.isFinite(earning) || earning <= 0) continue;

    const heldRaw = Number(booking.payout_holdback_rupees ?? 0);
    const held = Number.isFinite(heldRaw) ? heldRaw : 0;
    const until = booking.payout_holdback_until;

    const main = earning - held;
    if (main > 0) {
      tranches.push({
        bookingId: booking.id,
        reference: booking.reference,
        providerId: booking.provider_id,
        tranche: "main",
        earning: main,
      });
    }

    /*
     * Held money is not a payout until its own date passes. Recovering against
     * it early — or paying it early — takes a quarter of something nobody has
     * been paid.
     */
    if (held > 0 && until && until <= at) {
      tranches.push({
        bookingId: booking.id,
        reference: booking.reference,
        providerId: booking.provider_id,
        tranche: "holdback",
        earning: held,
      });
    }
  }

  return tranches;
}
