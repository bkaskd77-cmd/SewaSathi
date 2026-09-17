import "server-only";

import { cache } from "react";

import { STAT_FLOORS } from "@/lib/config/platform";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/public";

export { STAT_FLOORS };

/**
 * The numbers on the front of the product.
 *
 * WHAT THESE REPLACE. "1,200+ ID-verified professionals" and "Average rating
 * 4.8 from 10,000+ households", against 28 fake providers and no completed
 * bookings. `LAUNCH-BLOCKERS.md` calls it the most serious entry in the file:
 * it is the first thing on the landing page and it is the specific claim the
 * product asks to be trusted on.
 *
 * A FLOOR IS NOT WHAT MAKES A NUMBER HONEST — the rows behind it are. Reading
 * the live database while designing this found 26 of the 28 "verified"
 * professionals were seeded fixtures. A floor of 25 would have PASSED and put
 * "28 ID-verified professionals" on the landing page: a smaller lie, arrived at
 * carefully. So the filter comes first and the floor second, and
 * `application_id is not null` is the filter — somebody who came through
 * `provider_applications` was onboarded by the real flow, and a fixture was not.
 */


export type PlatformStats = {
  /** Verified AND onboarded through the real flow. Null below the floor. */
  professionals: number | null;
  /** Distinct customers with a completed booking. Null below the floor. */
  households: number | null;
  /** Mean of measured ratings. Null below the floor. */
  rating: number | null;
};

/** Nothing to show — the honest answer on a product that has served one household. */
const NOTHING: PlatformStats = {
  professionals: null,
  households: null,
  rating: null,
};

/**
 * Cached per request: this is on every landing render and the numbers change
 * hourly at most.
 */
export const platformStats = cache(async (): Promise<PlatformStats> => {
  if (!hasSupabaseConfig()) return NOTHING;

  try {
    const db = createPublicClient();

    const [professionals, households, rated] = await Promise.all([
      db
        .from("providers")
        .select("id", { count: "exact", head: true })
        .eq("is_verified", true)
        .is("removed_at", null)
        // THE FILTER THAT MATTERS. Without it this counts 28 fixtures.
        .not("application_id", "is", null),
      db
        .from("bookings")
        .select("customer_id")
        .eq("status", "completed"),
      db
        .from("provider_stats")
        .select("rating_avg, rating_count")
        .gt("rating_count", 0),
    ]);

    /*
     * A FAILED READ SHOWS NOTHING RATHER THAN A STALE OR PARTIAL FIGURE. The
     * page is fine with no numbers — it is designed for that — and a count that
     * came back short because one query errored would be a smaller lie again.
     */
    if (professionals.error || households.error || rated.error) {
      console.error(
        `[platform] stats read failed — ${describeError(
          professionals.error ?? households.error ?? rated.error,
        )}`,
      );
      return NOTHING;
    }

    const proCount = professionals.count ?? 0;

    // Distinct customers, not bookings: one household booking twelve times is
    // one household, and counting jobs here would be the same overstatement in
    // a different column.
    const householdCount = new Set(
      (households.data ?? []).map((row) => row.customer_id as string),
    ).size;

    const ratedJobs = (rated.data ?? []).reduce(
      (total, row) => total + Number(row.rating_count ?? 0),
      0,
    );
    const ratingTotal = (rated.data ?? []).reduce(
      (total, row) =>
        total + Number(row.rating_avg ?? 0) * Number(row.rating_count ?? 0),
      0,
    );

    return {
      professionals:
        proCount >= STAT_FLOORS.professionals ? proCount : null,
      households:
        householdCount >= STAT_FLOORS.households ? householdCount : null,
      rating:
        ratedJobs >= STAT_FLOORS.ratedJobs && ratedJobs > 0
          ? Math.round((ratingTotal / ratedJobs) * 10) / 10
          : null,
    };
  } catch (thrown) {
    console.error(`[platform] stats threw — ${describeError(thrown)}`);
    return NOTHING;
  }
});
