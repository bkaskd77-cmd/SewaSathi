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
 * There is no payout table and no payout run: settlement stamps dates on the
 * booking and that is the whole of the mechanism. The unit used to be **one
 * settled booking whose payout had come due**, because a booking paid once.
 *
 * IT IS NOW A TRANCHE, and that is not a refinement — it is the unit changing.
 * Where the guarantee window runs long, `payoutPlan` holds a quarter back to
 * `payout_holdback_until`, so one booking has TWO payable dates. Each is a
 * payout, and the published sentence — never more than a quarter of any one
 * payout — is measured against each of them separately, on the money actually
 * arriving that day. A quarter of the whole earning taken out of the smaller
 * first tranche would be a third of what lands in their account, while the page
 * promised a quarter.
 *
 * NOTHING IS CHASED BACKWARD. This only ever reduces a payout that has not
 * been made. There is no card on file, no direct debit and no wage to garnish,
 * and CLAUDE.md is explicit that backward recovery selects against the honest:
 * they feel robbed and leave, the rest keep the money and stop taking our
 * jobs. A professional who never works again keeps their balance and it is
 * written off — that write-off is still unimplemented and is named in the
 * report rather than quietly built here.
 */

/**
 * One payable tranche of one booking.
 *
 * `earning` is the money actually arriving on that date, not the whole
 * settlement — which is the entire point: the published quarter is a quarter of
 * what lands, and on a held-back job the two tranches land a month apart.
 */
type Tranche = {
  bookingId: string;
  reference: string | null;
  providerId: string;
  tranche: "main" | "holdback";
  earning: number;
};

/** What one sweep did. Counted, because a cron that says nothing proves nothing. */
export type RecoverySweep = {
  /** Payable tranches looked at, including ones that recovered nothing. */
  considered: number;
  /** Tranches that produced a recovery row. */
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
 * Recover what is due, once per tranche.
 *
 * IDEMPOTENT BY CONSTRUCTION AND NOT BY THE FILTER BELOW. The filter skips
 * tranches already recovered against, but a second sweep overlapping the first
 * would pass that filter with stale data and insert again. What actually stops
 * it is `provider_ledger_recovery_tranche_idx` — a partial unique index on
 * `(booking_id, tranche)` that the second insert violates. The filter is an
 * optimisation; the index is the rule. Same arrangement `our_reference` has on
 * `payments`, for the same reason.
 *
 * THE FILTER IS ALSO WHY THE INDEX HAD TO CHANGE RATHER THAN JUST WIDEN. It
 * used to be unique on `booking_id` alone, and the filter below keyed on
 * booking id alone to match. A released holdback on a booking whose first
 * tranche had already been recovered would have been dropped by the filter
 * BEFORE any insert was attempted — paid in full, no row, no unique violation,
 * nothing logged. A guard that has quietly stopped guarding looks exactly like
 * one that is working.
 */
export async function sweepRedoRecovery(
  options: { limit?: number } = {},
): Promise<RecoverySweep> {
  if (!hasSupabaseConfig()) return EMPTY;
  const limit = options.limit ?? SWEEP_LIMIT;

  try {
    const admin = createAdminClient();

    const now = new Date().toISOString();

    /*
     * Every settled booking that has a payable tranche by now. One read rather
     * than two: a booking can have both its dates in the past, and asking twice
     * would fetch the same row twice on a database that is not local.
     */
    const { data: dueRows, error } = await admin
      .from("bookings")
      .select(
        "id, reference, provider_id, provider_earning, payout_due_at, payout_holdback_rupees, payout_holdback_until",
      )
      .eq("payment_status", "paid")
      .not("provider_id", "is", null)
      .gt("provider_earning", 0)
      .lte("payout_due_at", now)
      .order("payout_due_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error(`[recovery] due read failed — ${describeError(error)}`);
      return EMPTY;
    }

    const rows = (dueRows ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return EMPTY;

    /*
     * ONE BOOKING BECOMES ONE OR TWO PAYOUTS, and each carries its own earning
     * — the money actually reaching the professional on that date. The main
     * tranche is the earning LESS whatever is held back; the holdback tranche
     * is that held amount, once its own date has passed. They sum to the whole
     * earning, so a quarter of each is never more than a quarter of anything
     * that lands.
     */
    const candidates: Tranche[] = [];
    for (const row of rows) {
      const earning = Number(row.provider_earning ?? 0);
      const held = Number(row.payout_holdback_rupees ?? 0);
      const until = row.payout_holdback_until as string | null;

      const main = earning - (Number.isFinite(held) ? held : 0);
      if (main > 0) {
        candidates.push({
          bookingId: row.id as string,
          reference: (row.reference as string | null) ?? null,
          providerId: row.provider_id as string,
          tranche: "main",
          earning: main,
        });
      }

      // Held money is not a payout until its date passes — recovering against
      // it early takes a quarter of something nobody has been paid.
      if (held > 0 && until && until <= now) {
        candidates.push({
          bookingId: row.id as string,
          reference: (row.reference as string | null) ?? null,
          providerId: row.provider_id as string,
          tranche: "holdback",
          earning: held,
        });
      }
    }

    if (candidates.length === 0) return EMPTY;

    /*
     * Which of these have already been recovered against. Read in one query
     * rather than per booking: this is a cron on a database a Pacific away
     * from nothing, but a round trip per row is still a round trip per row.
     *
     * KEYED ON BOOKING **AND** TRANCHE. Keying on the booking alone is the
     * silent failure described above: a released holdback would be filtered out
     * by its own first tranche and never attempted.
     */
    const { data: doneRows } = await admin
      .from("provider_ledger")
      .select("booking_id, tranche")
      .eq("kind", "recovery")
      .in(
        "booking_id",
        Array.from(new Set(candidates.map((c) => c.bookingId))),
      );

    const alreadyDone = new Set(
      ((doneRows ?? []) as { booking_id: string | null; tranche: string | null }[])
        .filter((r) => Boolean(r.booking_id))
        .map((r) => `${r.booking_id}:${r.tranche ?? "main"}`),
    );

    const pending = candidates.filter(
      (c) => !alreadyDone.has(`${c.bookingId}:${c.tranche}`),
    );
    if (pending.length === 0) return { ...EMPTY, considered: candidates.length };

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
    const byProvider = new Map<string, Tranche[]>();
    for (const item of pending) {
      const list = byProvider.get(item.providerId);
      if (list) list.push(item);
      else byProvider.set(item.providerId, [item]);
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

      for (const item of bookings) {
        // THE DEBT CLEARING MID-SWEEP. Once the balance is gone the remaining
        // payouts of this professional are untouched — no zero-rupee rows, and
        // the `amount_rupees > 0` check would refuse them anyway.
        if (outstanding <= 0) break;

        /*
         * The SAME `applyRedoRecovery` for both tranches, deliberately. "A
         * quarter" is published, and two implementations of it would take
         * different amounts depending on which date the money arrived on.
         */
        const step = applyRedoRecovery({ earning: item.earning, outstanding });
        if (step.recovered <= 0) continue;

        const { error: insertError } = await admin
          .from("provider_ledger")
          .insert({
            provider_id: providerId,
            booking_id: item.bookingId,
            tranche: item.tranche,
            kind: "recovery",
            amount_rupees: step.recovered,
            // A sentence they can read. An unexplained row is money off
            // somebody's earnings with no account of why — and it says WHICH
            // payout, because two of them can come from one job.
            note:
              item.tranche === "holdback"
                ? `Recovered from the held part of ${
                    item.reference ?? "a job"
                  } — a quarter of it, against what is owed`
                : `Recovered from the payout on ${
                    item.reference ?? "a job"
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
            `[recovery] insert failed on ${item.bookingId}/${item.tranche} — ${describeError(insertError)}`,
          );
          continue;
        }

        outstanding = step.remaining;
        recovered += 1;
        rupees += step.recovered;
      }
    }

    return { considered: candidates.length, recovered, rupees };
  } catch (thrown) {
    console.error(`[recovery] sweep threw — ${describeError(thrown)}`);
    return EMPTY;
  }
}

/* ------------------------------------------------------------------ *
 * The end of a balance nobody can collect
 * ------------------------------------------------------------------ */

/** What one write-off sweep did. */
export type WriteOffSweep = {
  /** Listings closed, which is one per write-off. */
  closed: number;
  /** Rupees written off across the sweep. */
  rupees: number;
};

/**
 * Write off what is owed by somebody who has stopped working, and close the
 * listing.
 *
 * WHY A DEBT NEEDS AN END. Without one it is immortal: `provider_outstanding`
 * sums a ledger that only grows, so a professional who left two years ago
 * still owes us on a screen nobody will ever act on. We have no card on file,
 * no direct debit and no way to collect a rupee of it — `lib/payments/payout.ts`
 * refuses backward recovery for exactly that reason — so an open balance
 * against somebody who has gone is a number pretending to be an asset.
 *
 * THE CLOCK IS THE LAST COMPLETED JOB, not the last login or the last claim. A
 * balance only ever arises from a claim on a job somebody finished, so every
 * professional who owes anything has at least one completed booking and the
 * clock always has a real anchor.
 *
 * CLOSING IS NOT REMOVING, and the schema keeps them apart on purpose.
 * `closed_at` carries no finding against anybody and coming back means
 * re-applying, which is allowed. `removed_at` is step 5 of the enforcement
 * ladder. Writing one where the other belongs would put a professional who
 * simply stopped taking work into every future report as somebody removed for
 * cause.
 *
 * ONLY LISTINGS CARRYING A BALANCE ARE CLOSED HERE. Somebody who owes nothing
 * and takes a year off keeps their listing — the close exists to make the
 * write-off final, not to tidy up quiet accounts.
 */
export async function sweepWriteOffs(): Promise<WriteOffSweep> {
  if (!hasSupabaseConfig()) return { closed: 0, rupees: 0 };

  try {
    const admin = createAdminClient();
    const { PAYOUT_RULES } = await import("@/lib/payments/payout");

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - PAYOUT_RULES.writeOffAfterMonths);

    /*
     * Open listings only — and the predicate is NOT what makes this sweep
     * idempotent, which is worth saying because it looks as though it is.
     *
     * A second run skips a professional already written off because their
     * balance is zero, not because of the filter: removing `closed_at is null`
     * leaves every other case in `tests/db/write-off.test.ts` green.
     *
     * What it guards is a listing that is STILL closed and acquires a NEW
     * balance — a claim adjudicated on an old job weeks after the listing
     * shut. Without it the sweep would write that off and stamp `closed_at`
     * again, so the row would record a closure on a day it did not happen.
     * That case is pinned directly.
     */
    const { data: openRows, error } = await admin
      .from("providers")
      .select("id, display_name")
      .is("closed_at", null)
      .is("removed_at", null);

    if (error) {
      console.error(`[recovery] open listings read failed — ${describeError(error)}`);
      return { closed: 0, rupees: 0 };
    }

    let closed = 0;
    let rupees = 0;

    for (const provider of (openRows ?? []) as Record<string, unknown>[]) {
      const providerId = provider.id as string;

      const { data: balance, error: balanceError } = await admin.rpc(
        "provider_outstanding",
        { target: providerId },
      );
      if (balanceError) continue;

      const owed = Number(balance ?? 0);
      // Nothing owed is the overwhelmingly common case and costs one read.
      // A quiet listing with no balance is left entirely alone.
      if (!Number.isFinite(owed) || owed <= 0) continue;

      /*
       * Their most recent finished job. One row, ordered — asking "is there
       * anything since the cutoff?" would be the same round trip and would
       * not let the log say how long it has actually been.
       */
      const { data: lastRows } = await admin
        .from("bookings")
        .select("completed_at")
        .eq("provider_id", providerId)
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1);

      const last = (lastRows ?? [])[0] as { completed_at: string } | undefined;
      // No completed job at all cannot happen while a balance exists, since a
      // balance comes from a claim on a finished job. Treated as not-dormant
      // rather than as infinitely dormant: if the impossible happens, the safe
      // reading is to leave somebody's listing open and their debt standing.
      if (!last) continue;
      if (Date.parse(last.completed_at) > cutoff.getTime()) continue;

      const { error: writeError } = await admin.from("provider_ledger").insert({
        provider_id: providerId,
        kind: "write_off",
        amount_rupees: owed,
        note: `Written off after ${PAYOUT_RULES.writeOffAfterMonths} months with no completed job`,
      });

      if (writeError) {
        console.error(
          `[recovery] write-off failed for ${providerId} — ${describeError(writeError)}`,
        );
        continue;
      }

      /*
       * THE LEDGER ROW FIRST, THE CLOSE SECOND. If the close fails, the
       * balance is still zero and the listing is simply still open — the next
       * sweep skips it because nothing is owed, and a person can close it. The
       * other order would close somebody's listing while they still owed the
       * money, which is the failure worth avoiding.
       */
      const { error: closeError } = await admin
        .from("providers")
        .update({
          is_active: false,
          closed_at: new Date().toISOString(),
          closed_reason: "dormant",
        })
        .eq("id", providerId)
        .is("closed_at", null);

      if (closeError) {
        console.error(
          `[recovery] close failed for ${providerId} — ${describeError(closeError)}`,
        );
      }

      closed += 1;
      rupees += owed;
    }

    return { closed, rupees };
  } catch (thrown) {
    console.error(`[recovery] write-off sweep threw — ${describeError(thrown)}`);
    return { closed: 0, rupees: 0 };
  }
}
