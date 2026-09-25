import "server-only";

import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Taking a redo debt off the payouts that follow it.
 *
 * WHY THIS FILE EXISTS AT ALL, WHICH IS NOT A FLATTERING STORY.
 * `applyRedoRecovery` was written in Phase 6, tested, documented in three
 * places — and never called. No `recovery` row was ever written, no
 * `write_off` either, and there is no payout run in this product. So
 * `provider_outstanding` only ever went up and every refund agreed on
 * /admin/guarantee-claims was money gone.
 *
 * It was also already PROMISED. /providers/standards has told professionals
 * since Phase 6 that the debt "comes off your next earnings, at most a quarter
 * of any one payout" and shows "as a balance you can watch going down". The
 * balance could not go down. This is not a new feature; it is a published
 * sentence becoming true.
 *
 * WHAT A PAYOUT IS HERE, BECAUSE THE CAP HAS TO BE MEASURED AGAINST SOMETHING.
 * There is no payout table and no payout run: `payoutDueAt` stamps
 * `payout_due_at` on the booking when it settles and that is the whole of the
 * mechanism. So the unit is **one settled booking whose payout has come due**,
 * and at most a quarter of its `provider_earning` comes off the debt. That
 * reading matches the published sentence, invents no batch, and makes a payout
 * mean a job — which here it does.
 *
 * NOTHING IS CHASED BACKWARD. This only ever reduces a payout that has not
 * been made. There is no card on file, no direct debit and no wage to garnish,
 * and CLAUDE.md is explicit that backward recovery selects against the honest:
 * they feel robbed and leave, the rest keep the money and stop taking our
 * jobs. A professional who never works again keeps their balance and it is
 * written off — that write-off is still unimplemented and is named in the
 * report rather than quietly built here.
 */

/** What one sweep did. Counted, because a cron that says nothing proves nothing. */
export type RecoverySweep = {
  /** Due payouts looked at, including ones that recovered nothing. */
  considered: number;
  /** Bookings that produced a recovery row. */
  recovered: number;
  /** Rupees taken off outstanding debt across the whole sweep. */
  rupees: number;
};

const EMPTY: RecoverySweep = { considered: 0, recovered: 0, rupees: 0 };

/**
 * Bounded per run, so a backlog is worked through over several sweeps rather
 * than in one request that times out. The cron is daily and idempotent, so
 * the only cost of a low ceiling is that a large backlog takes a few days —
 * and a backlog this large means something else has gone wrong anyway.
 */
const SWEEP_LIMIT = 200;

/**
 * Recover what is due, once per booking.
 *
 * IDEMPOTENT BY CONSTRUCTION AND NOT BY THE FILTER BELOW. The filter skips
 * bookings already recovered against, but a second sweep overlapping the first
 * would pass that filter with stale data and insert again. What actually stops
 * it is `provider_ledger_recovery_once_idx` — a partial unique index the
 * second insert violates. The filter is an optimisation; the index is the
 * rule. This is the same arrangement `our_reference` has on `payments`, for
 * the same reason.
 */
export async function sweepRedoRecovery(
  options: { limit?: number } = {},
): Promise<RecoverySweep> {
  if (!hasSupabaseConfig()) return EMPTY;
  const limit = options.limit ?? SWEEP_LIMIT;

  try {
    const admin = createAdminClient();

    /*
     * Every payout that has come due and could carry a recovery. Ordered
     * oldest first so a backlog is worked through in the order the money was
     * owed, which is also the order a professional would expect to see it.
     */
    const { data: dueRows, error } = await admin
      .from("bookings")
      .select("id, reference, provider_id, provider_earning, payout_due_at")
      .eq("payment_status", "paid")
      .not("provider_id", "is", null)
      .gt("provider_earning", 0)
      .lte("payout_due_at", new Date().toISOString())
      .order("payout_due_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error(`[recovery] due read failed — ${describeError(error)}`);
      return EMPTY;
    }

    const due = (dueRows ?? []) as Record<string, unknown>[];
    if (due.length === 0) return EMPTY;

    /*
     * Which of these have already been recovered against. Read in one query
     * rather than per booking: this is a cron on a database a Pacific away
     * from nothing, but a round trip per row is still a round trip per row.
     */
    const { data: doneRows } = await admin
      .from("provider_ledger")
      .select("booking_id")
      .eq("kind", "recovery")
      .in(
        "booking_id",
        due.map((b) => b.id as string),
      );

    const alreadyDone = new Set(
      ((doneRows ?? []) as { booking_id: string | null }[])
        .map((r) => r.booking_id)
        .filter((id): id is string => Boolean(id)),
    );

    const pending = due.filter((b) => !alreadyDone.has(b.id as string));
    if (pending.length === 0) return { ...EMPTY, considered: due.length };

    /*
     * GROUPED BY PROFESSIONAL, AND THE BALANCE IS CARRIED ACROSS THE GROUP.
     *
     * This is the one thing in this file that is easy to get wrong and quiet
     * when it is. Two due payouts for the same person must not each take a
     * quarter of the SAME outstanding figure: read once and applied twice,
     * that recovers half a debt that may only have had a quarter left in it,
     * and the professional is short by the difference with a ledger that
     * balances. So the balance is read once per professional and decremented
     * as each booking takes its share.
     */
    const byProvider = new Map<string, Record<string, unknown>[]>();
    for (const booking of pending) {
      const id = booking.provider_id as string;
      const list = byProvider.get(id);
      if (list) list.push(booking);
      else byProvider.set(id, [booking]);
    }

    const { applyRedoRecovery } = await import("@/lib/payments/payout");

    let recovered = 0;
    let rupees = 0;

    for (const [providerId, bookings] of Array.from(byProvider)) {
      const { data: balance, error: balanceError } = await admin.rpc(
        "provider_outstanding",
        { target: providerId },
      );

      if (balanceError) {
        // One professional's balance being unreadable must not abandon the
        // rest of the sweep. Logged, skipped, retried tomorrow.
        console.error(
          `[recovery] balance unreadable for ${providerId} — ${describeError(balanceError)}`,
        );
        continue;
      }

      let outstanding = Number(balance ?? 0);
      // Nothing owed is the common case by far, and it costs one read to find
      // out. No rows are written and nothing is logged for it.
      if (!Number.isFinite(outstanding) || outstanding <= 0) continue;

      for (const booking of bookings) {
        // THE DEBT CLEARING MID-SWEEP. Once the balance is gone the remaining
        // payouts of this professional are untouched — no zero-rupee rows, and
        // the `amount_rupees > 0` check would refuse them anyway.
        if (outstanding <= 0) break;

        const earning = Number(booking.provider_earning ?? 0);
        const step = applyRedoRecovery({ earning, outstanding });
        if (step.recovered <= 0) continue;

        const { error: insertError } = await admin
          .from("provider_ledger")
          .insert({
            provider_id: providerId,
            booking_id: booking.id as string,
            kind: "recovery",
            amount_rupees: step.recovered,
            // A sentence they can read. An unexplained row is money off
            // somebody's earnings with no account of why.
            note: `Recovered from the payout on ${
              (booking.reference as string | null) ?? "a job"
            } — a quarter of it, against what is owed`,
          });

        if (insertError) {
          /*
           * A UNIQUE VIOLATION HERE IS THE INDEX DOING ITS JOB, not a fault.
           * Another sweep got there first. The balance is left alone, because
           * that sweep already took it off.
           */
          if (/duplicate key|unique constraint/i.test(describeError(insertError))) {
            continue;
          }
          console.error(
            `[recovery] insert failed on ${booking.id as string} — ${describeError(insertError)}`,
          );
          continue;
        }

        outstanding = step.remaining;
        recovered += 1;
        rupees += step.recovered;
      }
    }

    return { considered: due.length, recovered, rupees };
  } catch (thrown) {
    console.error(`[recovery] sweep threw — ${describeError(thrown)}`);
    return EMPTY;
  }
}
