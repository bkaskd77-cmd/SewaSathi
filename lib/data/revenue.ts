import "server-only";

import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What this platform earned, by week and by trade, with every line naming its source.
 *
 * NOTHING HERE CALCULATES A FEE. Each figure is a column somebody else froze or a
 * ledger row somebody else wrote; this module groups them. That is the whole design
 * rule, and it is not fussiness: `settleSplit` is the one implementation of the
 * split, and a revenue screen that re-derived 15% of something would be a second
 * opinion that drifts the first time a rate changes — then the owner's number and
 * the professional's statement disagree and neither is obviously wrong.
 *
 * COMMISSION EARNED READS `bookings.platform_fee`, NOT THE LEDGER, and that is a
 * correction to the brief rather than a shortcut. `provider_ledger` has no kind for
 * our fee on a digital job: `commission_due` is cash only — what the professional
 * owes us because they hold the notes — and on digital the fee is simply the part of
 * the gateway money we kept, visible in the booking as `platform_fee` and nowhere
 * else. "Revenue from the ledger only" would therefore have reported our cash fees
 * and silently omitted every digital one, which on a 13%-vs-15% product is the
 * difference between a number and a wrong number. The fee is frozen at settlement,
 * so reading it is reading the record.
 *
 * THE RETURNED COMMISSION IS ITS OWN LINE AND IS NEVER NETTED SILENTLY. A refund
 * hands back our fee in proportion, so a week with a large refund earned less than
 * its settlements suggest — and a single net figure would hide the one event an
 * owner most needs to see. It is computed by `refundFunding`, the same pure function
 * `agreeRefund` runs, over the same two frozen columns: a preview of the record
 * rather than a second opinion about it.
 *
 * WEEKS ARE ISO WEEKS STARTING MONDAY 00:00 UTC, the same convention
 * `payoutPeriod` uses. Two different week definitions in one product is how a
 * figure becomes unreconcilable against the payout run beside it.
 *
 * TWO THINGS ARE REPORTED RATHER THAN DROPPED, because a quiet exclusion is a
 * silent zero wearing a filter: a settled payment carrying no frozen fee
 * (`unattributedSettlements`) and a refund agreed but never dated
 * (`undatedReturns`). Both should be zero; if either is not, the weekly columns do
 * not account for everything and the screen says so instead of quietly adding up.
 */

/** One week's flows. Every field is a sum of things other code wrote. */
export type RevenueWeek = {
  /** Monday 00:00 UTC. */
  weekStart: Date;
  /** `bookings.platform_fee`, frozen at settlement. */
  commissionEarned: number;
  /** `refundFunding().platformReturns` on refunds agreed that week. Positive. */
  commissionReturned: number;
  /** `provider_ledger.commission_due` — what we billed on cash jobs. */
  cashCommissionBilled: number;
  /** `provider_ledger.redo_debt` — somebody else's visit, funded by us first. */
  redoCost: number;
  /** `provider_ledger.write_off` — a debt we gave up on. The real cost of the guarantee. */
  redoWrittenOff: number;
  /** `payout` less `payout_reversal`. Money that left for professionals. */
  payoutsSent: number;
  /** Settlements behind `commissionEarned`, so the fee is never a bare figure. */
  jobs: number;
};

/** The same lines per trade, over the whole period rather than per week. */
export type RevenueCategory = {
  slug: string;
  commissionEarned: number;
  commissionReturned: number;
  jobs: number;
};

export type Revenue = {
  weeks: RevenueWeek[];
  categories: RevenueCategory[];
  /**
   * What cash professionals still owe us, as a position rather than a flow.
   *
   * THERE IS NO "WE WERE PAID" LEDGER KIND, because a cash commission is settled by
   * being netted off a future payout — the payout is simply smaller. So the amount
   * outstanding is the sum of the negative balances: per professional, everything
   * they owe us less everything we owe them, counted only where the sign is against
   * them. Netting the positives in would answer a different question.
   */
  cashCommissionOutstanding: number;
  /** Settled payments whose booking carries no frozen fee. Should be 0. */
  unattributedSettlements: number;
  /** Refunds agreed but with no date, so in no week. Should be 0. */
  undatedReturns: number;
};

/** Monday 00:00 UTC of the week containing `at`. */
function weekStartOf(at: Date): Date {
  const d = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  // getUTCDay: Sunday is 0, so Sunday belongs to the week that began six days ago.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

function emptyWeek(weekStart: Date): RevenueWeek {
  return {
    weekStart,
    commissionEarned: 0,
    commissionReturned: 0,
    cashCommissionBilled: 0,
    redoCost: 0,
    redoWrittenOff: 0,
    payoutsSent: 0,
    jobs: 0,
  };
}

/**
 * Every line, read once.
 *
 * FOUR QUERIES IN ONE WAVE. The region move made a round trip the unit of cost, so
 * reads that do not depend on each other go in one `Promise.all` — and all four of
 * these are independent. The ledger is read whole rather than aggregated per kind,
 * because one read filtered five ways is one round trip where five aggregates are
 * five, and the table is small; when it is not, this becomes a view.
 */
export type ReadableRevenue =
  | { ok: true; data: Revenue }
  /** The read failed. Never an empty week, which would render as a bad week. */
  | { ok: false; data: null };

export async function revenue(): Promise<ReadableRevenue> {
  if (!hasSupabaseConfig()) return { ok: false, data: null };

  try {
    const db = createAdminClient();
    /*
     * THROUGH THE FRONT DOOR, DYNAMICALLY, which is what `lib/data/claims.ts`
     * already does for the same function and for the reason `lib/payments/index.ts`
     * states: that module's registry reaches `node:crypto` through eSewa, and a
     * static import chain is what the module boundary exists to stop. The public
     * entry exports the refund *types* and not its values on purpose, so this is
     * the respectful route rather than a boundary evaded — the distinction the
     * `sessionAuthenticatedAt` fix turned on.
     */
    const { refundFunding } = await import("@/lib/payments/refund");

    const [settlements, claims, ledger] = await Promise.all([
      /*
       * The payment is what carries the moment money settled; the booking carries
       * the fee frozen against it. `payout_due_at` would have been the wrong stamp —
       * it is settlement plus a hold, so a Friday settlement would land in the next
       * week or the one after depending on the payment method.
       */
      db
        .from("payments")
        .select(
          "settled_at, bookings:booking_id (platform_fee, category_slug, payment_method)",
        )
        .eq("status", "paid")
        .not("settled_at", "is", null),
      db
        .from("guarantee_claims")
        .select(
          "refund_rupees, refund_decided_by, closed_at, category_slug, bookings:booking_id (platform_fee, provider_earning)",
        )
        .not("refund_decided_by", "is", null)
        .gt("refund_rupees", 0),
      db
        .from("provider_ledger")
        .select("provider_id, kind, amount_rupees, created_at"),
    ]);

    if (settlements.error || claims.error || ledger.error) {
      console.error(
        `[revenue] read failed — ${describeError(
          settlements.error ?? claims.error ?? ledger.error,
        )}`,
      );
      return { ok: false, data: null };
    }

    const weeks = new Map<number, RevenueWeek>();
    const week = (at: Date): RevenueWeek => {
      const start = weekStartOf(at);
      const key = start.getTime();
      const found = weeks.get(key) ?? emptyWeek(start);
      weeks.set(key, found);
      return found;
    };

    const categories = new Map<string, RevenueCategory>();
    const category = (slug: string): RevenueCategory => {
      const found =
        categories.get(slug) ??
        { slug, commissionEarned: 0, commissionReturned: 0, jobs: 0 };
      categories.set(slug, found);
      return found;
    };

    /* Commission earned — the frozen fee, per settled payment. */
    let unattributedSettlements = 0;
    type SettlementRow = {
      settled_at: string;
      bookings: {
        platform_fee: number | null;
        category_slug: string;
        payment_method: string;
      } | null;
    };

    for (const row of (settlements.data ?? []) as unknown as SettlementRow[]) {
      const fee = row.bookings?.platform_fee ?? null;
      if (fee === null) {
        // Counted rather than skipped: a settled payment with no frozen fee is a
        // settlement integrity problem, and a filter would hide it perfectly.
        unattributedSettlements += 1;
        continue;
      }
      const bucket = week(new Date(row.settled_at));
      bucket.commissionEarned += fee;
      bucket.jobs += 1;

      const trade = category(row.bookings!.category_slug);
      trade.commissionEarned += fee;
      trade.jobs += 1;
    }

    /* Commission returned — the same proportional rule the refund path applies. */
    let undatedReturns = 0;
    type ClaimRow = {
      refund_rupees: number;
      closed_at: string | null;
      category_slug: string;
      bookings: {
        platform_fee: number | null;
        provider_earning: number | null;
      } | null;
    };

    for (const row of (claims.data ?? []) as unknown as ClaimRow[]) {
      const { platformReturns } = refundFunding({
        refund: row.refund_rupees,
        platformFee: row.bookings?.platform_fee ?? 0,
        providerEarning: row.bookings?.provider_earning ?? 0,
      });
      if (platformReturns === 0) continue;

      category(row.category_slug).commissionReturned += platformReturns;

      /*
       * `closed_at` is the only date a decided refund has. Without it the amount is
       * real and its week is not, so it is reported on its own rather than guessed
       * into the current week — a date invented for a figure is how a report comes
       * to describe something that did not happen then.
       */
      if (row.closed_at === null) {
        undatedReturns += platformReturns;
        continue;
      }
      week(new Date(row.closed_at)).commissionReturned += platformReturns;
    }

    /* The ledger lines, from one read. */
    type LedgerRow = {
      provider_id: string;
      kind: string;
      amount_rupees: number;
      created_at: string;
    };

    const balances = new Map<string, number>();
    for (const row of (ledger.data ?? []) as LedgerRow[]) {
      const bucket = week(new Date(row.created_at));
      if (row.kind === "commission_due") {
        bucket.cashCommissionBilled += row.amount_rupees;
      } else if (row.kind === "redo_debt") {
        bucket.redoCost += row.amount_rupees;
      } else if (row.kind === "write_off") {
        bucket.redoWrittenOff += row.amount_rupees;
      } else if (row.kind === "payout") {
        bucket.payoutsSent += row.amount_rupees;
      } else if (row.kind === "payout_reversal") {
        bucket.payoutsSent -= row.amount_rupees;
      }

      /*
       * The two-way position, with the same signs `provider_balance` uses: what we
       * owe them counts up, what they owe us counts down.
       */
      const owedToThem =
        row.kind === "earning" || row.kind === "payout_reversal" ? 1 : 0;
      const owedToUs =
        row.kind === "commission_due" ||
        row.kind === "payout" ||
        row.kind === "tax_withheld"
          ? 1
          : 0;
      if (owedToThem || owedToUs) {
        balances.set(
          row.provider_id,
          (balances.get(row.provider_id) ?? 0) +
            (owedToThem ? row.amount_rupees : -row.amount_rupees),
        );
      }
    }

    let cashCommissionOutstanding = 0;
    balances.forEach((balance) => {
      if (balance < 0) cashCommissionOutstanding += -balance;
    });

    const ordered = Array.from(weeks.values()).sort(
      (a, b) => b.weekStart.getTime() - a.weekStart.getTime(),
    );

    return {
      ok: true,
      data: {
        weeks: ordered,
        categories: Array.from(categories.values()).sort(
          (a, b) => b.commissionEarned - a.commissionEarned,
        ),
        cashCommissionOutstanding,
        unattributedSettlements,
        undatedReturns,
      },
    };
  } catch (thrown) {
    console.error(`[revenue] read threw — ${describeError(thrown)}`);
    return { ok: false, data: null };
  }
}
