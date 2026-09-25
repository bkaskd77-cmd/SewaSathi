import "server-only";

import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What already exists about the two people on a guarantee claim.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE CLAIM QUEUE. These are signals, and a
 * signal that lives in the same function as the decision drifts into being an
 * input to it. Keeping the read apart makes it obvious that nothing here is
 * consulted by `agreeRefund`, `judgeRefund` or `enforce_claim_refund` — the
 * ceiling is arithmetic on one booking and nothing in this module can move it.
 *
 * REVIEW, NOT PUNISHMENT, AND THE CUSTOMER SIDE ESPECIALLY. A claim rate is
 * the same shape of number as `category_pricing_signals`, which is never
 * grouped by person for exactly this reason: read one way it is "this trade is
 * mispriced", read the other it becomes a list of people to punish. A customer
 * who claims often may be unlucky, may live somewhere with old pipes, or may
 * have had three bad jobs — none of which is a reason to refuse them money
 * they are owed. It triggers a person looking, never a ban and never a ranking.
 *
 * EVERY COUNT CARRIES ITS DENOMINATOR. "Two prior refunds" out of two jobs and
 * out of two hundred are different facts, and a bare count is exactly how they
 * come to look the same — the same rule `bayesianRating` follows, one screen
 * over. Rule 6: a professional with no finished jobs has no rate, and the type
 * says so with null rather than printing a 0% somebody would read as evidence.
 */

export type ClaimSignals = {
  /**
   * Refunds already agreed against this professional's own work, and how many
   * jobs they have finished. Null `jobs` means the count could not be read —
   * never 0, which would read as "they have never worked".
   */
  provider: {
    priorRefunds: number;
    priorRefundRupees: number;
    jobsCompleted: number | null;
    /**
     * Still owed on `provider_ledger`, via `provider_outstanding`.
     *
     * ALREADY EXISTED AND WAS UNUSED ON THIS SCREEN. It is the one number that
     * says whether a refund agreed here can realistically be recovered at all:
     * the debt nets forward at a quarter of each payout, and somebody already
     * carrying a large balance is somebody the netting is not reaching.
     */
    outstandingRupees: number | null;
  } | null;
  /**
   * How often this customer claims. A signal for a person, never a rule.
   */
  customer: {
    claims: number;
    /** Finished bookings. The denominator, without which the count lies. */
    completedBookings: number | null;
  } | null;
};

const EMPTY: ClaimSignals = { provider: null, customer: null };

/**
 * Read the signals behind one claim.
 *
 * Every read is counted with `head: true` so nothing personal crosses the
 * wire: the screen needs "how many", never "which". A failure returns null for
 * that half rather than zero — not looking must never render as measured, and
 * a reviewer shown "0 prior refunds" because a query failed is being misled on
 * the screen where it costs the most.
 */
export async function claimSignals(input: {
  providerId: string | null;
  customerId: string | null;
}): Promise<ClaimSignals> {
  if (!hasSupabaseConfig()) return EMPTY;

  try {
    const admin = createAdminClient();

    const [provider, customer] = await Promise.all([
      input.providerId ? providerSignals(admin, input.providerId) : null,
      input.customerId ? customerSignals(admin, input.customerId) : null,
    ]);

    return { provider, customer };
  } catch (thrown) {
    console.error(`[claims] signals threw — ${describeError(thrown)}`);
    return EMPTY;
  }
}

type Admin = ReturnType<typeof createAdminClient>;

async function providerSignals(
  admin: Admin,
  providerId: string,
): Promise<ClaimSignals["provider"]> {
  /*
   * REFUNDS AGAINST THEIR OWN WORK, not visits they attended for somebody
   * else. `provider_id` is whose job it was; `attending_provider_id` is who
   * went back. Counting the second would put a refund on the record of the
   * professional who turned up to fix it — punishing the one who helped.
   */
  const [{ data: refunded }, { count: jobs }, outstanding] = await Promise.all([
    admin
      .from("guarantee_claims")
      .select("refund_rupees")
      .eq("provider_id", providerId)
      .gt("refund_rupees", 0),
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId)
      .eq("status", "completed"),
    admin.rpc("provider_outstanding", { target: providerId }),
  ]);

  const rows = (refunded ?? []) as { refund_rupees: number | null }[];

  return {
    priorRefunds: rows.length,
    priorRefundRupees: rows.reduce((sum, r) => sum + Number(r.refund_rupees ?? 0), 0),
    jobsCompleted: typeof jobs === "number" ? jobs : null,
    outstandingRupees:
      outstanding.error || outstanding.data == null
        ? null
        : Number(outstanding.data),
  };
}

async function customerSignals(
  admin: Admin,
  customerId: string,
): Promise<ClaimSignals["customer"]> {
  const [{ count: claims }, { count: completed }] = await Promise.all([
    admin
      .from("guarantee_claims")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId),
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("status", "completed"),
  ]);

  if (typeof claims !== "number") return null;
  return {
    claims,
    completedBookings: typeof completed === "number" ? completed : null,
  };
}

/*
 * The pure rule lives in `lib/config/guarantee.ts` with the rest of the
 * guarantee's judgements — it is policy, it is testable without a database,
 * and keeping it out of this file is what lets a test reach it without
 * dragging the Supabase client in. Re-exported so the panel has one import.
 */
export {
  claimRateWorthReading,
  CLAIM_RATE_ATTENTION,
  CLAIM_RATE_MIN_JOBS,
} from "@/lib/config/guarantee";
