import "server-only";

import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { uncounted, type Counted } from "@/lib/data/triage-accuracy";
import type { StatsOnly } from "@/lib/data/ranking";

/*
 * The share rule is pure, so it lives in `lib/config/exposure.ts` where a test
 * can reach it — this module is `server-only`. Re-exported so a caller has one
 * import for the whole measurement rather than having to know which half a
 * symbol lives in.
 */
export { topShare } from "@/lib/config/exposure";

/**
 * How concentrated is the work?
 *
 * THE QUESTION THIS ANSWERS. With a handful of real professionals, a score
 * ranking is winner-take-all: whoever is top gets the jobs, gets the ratings,
 * and the priors become self-confirming. `withNewcomerSlot` addresses the cold
 * start — one reserved position — and nothing addresses the steady state.
 *
 * MEASURED BEFORE ANY MECHANISM, DELIBERATELY. Rotation among near-ties is the
 * likely answer, and the margin it would need is a number nobody has. Picking
 * one now would be guessing at exactly the kind of threshold this product keeps
 * refusing to invent. So this counts, and stops.
 *
 * BOTH HALVES, BECAUSE OFFERS CONCENTRATING ONLY MATTERS IF THE WORK FOLLOWS.
 * One professional receiving most of the offers and completing few of them is a
 * dispatch problem; receiving most and completing most is the concentration
 * worth acting on. Reporting only the first would raise an alarm about the
 * wrong thing.
 *
 * NOTHING HERE IS A RANKING INPUT. Same posture as `category_pricing_signals`
 * and the payment mix: a number about the platform, never a number about a
 * person that follows them down a list.
 */

/**
 * What counts as an offer, stated here because a metric whose definition lives
 * only inside a query is one nobody can check.
 *
 * A booking that NAMED them: either `provider_id` (they hold it or held it) or
 * `first_choice_provider_id` (the customer picked them and dispatch later
 * widened away). The second is the half that would otherwise vanish — a
 * professional who is chosen and never answers has been offered work, and the
 * whole point of measuring concentration is to see who is being asked.
 *
 * An open job broadcast to everybody is deliberately NOT an offer to anybody in
 * particular. Counting those would make every professional look equally offered
 * and hide the concentration entirely.
 */
export type CategoryConcentration = {
  categorySlug: string;
  /** Bookings that named somebody. The denominator for the offer share. */
  offers: number;
  /** The most any one professional was named on. */
  topOffers: number;
  /** Completed bookings with a professional on them. */
  completions: number;
  /** The most any one professional completed. */
  topCompletions: number;
  /** Distinct professionals named at all in this category. */
  professionals: number;
};

type Row = {
  category_slug: string | null;
  provider_id: string | null;
  first_choice_provider_id: string | null;
  status: string | null;
};

/**
 * Concentration per category.
 *
 * ONE READ, COUNTED IN MEMORY. The alternative is a view or a grouped query per
 * category, and at this volume the round trip costs more than the loop. This is
 * an admin screen, read by one person occasionally, on a database in Singapore.
 */
export async function listConcentration(): Promise<
  Counted<CategoryConcentration[]>
> {
  if (!hasSupabaseConfig()) return uncounted();

  try {
    const { data, error } = await createAdminClient()
      .from("bookings")
      .select("category_slug, provider_id, first_choice_provider_id, status")
      .limit(5_000);

    if (error) {
      console.error(`[concentration] read failed — ${describeError(error)}`);
      return uncounted();
    }

    const rows = (data ?? []) as Row[];

    /** category -> provider -> { offered, completed } */
    const byCategory = new Map<
      string,
      Map<string, { offered: number; completed: number }>
    >();

    for (const row of rows) {
      const category = row.category_slug;
      if (!category) continue;

      /*
       * THE PROFESSIONAL THE BOOKING NAMED. `provider_id` first, because it is
       * who actually holds it; `first_choice_provider_id` when dispatch has
       * since cleared the assignment, which is exactly the case that would
       * otherwise disappear from the count.
       */
      const named = row.provider_id ?? row.first_choice_provider_id;
      if (!named) continue;

      let providers = byCategory.get(category);
      if (!providers) {
        providers = new Map();
        byCategory.set(category, providers);
      }
      const tally = providers.get(named) ?? { offered: 0, completed: 0 };
      tally.offered += 1;
      // Completion is counted against whoever actually holds it, so a widened
      // booking credits the person who did the work rather than the first choice.
      if (row.status === "completed" && row.provider_id === named) {
        tally.completed += 1;
      }
      providers.set(named, tally);
    }

    const value = Array.from(byCategory.entries())
      .map(([categorySlug, providers]) => {
        const tallies = Array.from(providers.values());
        const offers = tallies.reduce((sum, t) => sum + t.offered, 0);
        const completions = tallies.reduce((sum, t) => sum + t.completed, 0);
        return {
          categorySlug,
          offers,
          topOffers: Math.max(0, ...tallies.map((t) => t.offered)),
          completions,
          topCompletions: Math.max(0, ...tallies.map((t) => t.completed)),
          professionals: providers.size,
        };
      })
      // Busiest category first: that is where concentration would bite soonest.
      .sort((a, b) => b.offers - a.offers);

    return { ok: true, value };
  } catch (thrown) {
    console.error(`[concentration] threw — ${describeError(thrown)}`);
    return uncounted();
  }
}



/* ------------------------------------------------------------------ *
 * The evidence behind the ranking weights
 * ------------------------------------------------------------------ */

/**
 * Just enough of every listing's stats to say which weights rest on a prior.
 *
 * ONE READ RATHER THAN TEN. `listProviders` requires a category — it is an
 * inner join on `provider_categories` — so asking it for "everybody" means one
 * call per trade and a dedupe, which is ten round trips to a database a
 * continent away for a screen that needs one. This reads `provider_stats`
 * directly because the question is only ever about those columns.
 */
export async function listRankingEvidence(): Promise<Counted<StatsOnly[]>> {
  if (!hasSupabaseConfig()) return uncounted();

  try {
    const { data, error } = await createAdminClient()
      .from("provider_stats")
      .select("rating_count, jobs_accepted, response_samples")
      .limit(5_000);

    if (error) {
      console.error(`[concentration] stats read failed — ${describeError(error)}`);
      return uncounted();
    }

    const value = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      ratingCount: Number(row.rating_count ?? 0),
      jobsAccepted: Number(row.jobs_accepted ?? 0),
      responseSamples: Number(row.response_samples ?? 0),
    }));

    return { ok: true, value };
  } catch (thrown) {
    console.error(`[concentration] stats threw — ${describeError(thrown)}`);
    return uncounted();
  }
}

/**
 * How much of the proximity weight is actually distance.
 *
 * WHY THIS IS NOT PART OF `weightEvidence`. That function answers the evidence question
 * from `provider_stats` alone, and deliberately — a full `Provider` would mean a full
 * read for a screen that needs counts. Proximity is the one term whose evidence lives
 * somewhere else entirely: in the ward centroid seed and in `addresses.lat/lng`. So
 * `weightEvidence` reports it as "always a fact", which is true of the ward half and
 * silent about the half that was just added.
 *
 * THE SILENCE IS THE THING WORTH FIXING. `area-centroids.json` ships empty — the
 * sandbox this was built in cannot reach OpenStreetMap — and every address has no pin
 * until customers start using the button. Both are working states: ranking falls back
 * to ward membership. But a refinement that is inert and a refinement that is working
 * look identical from the ranking, which is the `applyRedoRecovery` shape, and the only
 * way to tell them apart would be reading two files and counting rows.
 *
 * MEASURES AND DOES NOT GRADE. No threshold, no colour, no proposal — there is no
 * number yet that says what share of pinned addresses makes distance worth retuning
 * around, and a constant here would freeze a guess into the codebase as a standard.
 */
export type ProximityEvidence = {
  /** Wards with a centre on record, out of the wards we sell in. */
  wardsWithCentre: number;
  wardsTotal: number;
  /** Where those centres came from, and when. Null before the fetch has run. */
  centroidSource: string;
  centroidFetchedAt: string | null;
  /** Addresses carrying a pin, out of all of them. Null total means the read failed. */
  pinnedAddresses: number;
  addressesTotal: number | null;
};

export async function proximityEvidence(): Promise<ProximityEvidence> {
  const { AREAS } = await import("@/lib/config/areas");
  const { CENTROID_PROVENANCE } = await import("@/lib/geo");

  const base = {
    wardsWithCentre: CENTROID_PROVENANCE.known,
    wardsTotal: AREAS.length,
    centroidSource: CENTROID_PROVENANCE.source,
    centroidFetchedAt: CENTROID_PROVENANCE.fetchedAt,
  };

  if (!hasSupabaseConfig()) {
    return { ...base, pinnedAddresses: 0, addressesTotal: null };
  }

  try {
    const db = createAdminClient();
    const [{ count: pinned }, { count: total, error }] = await Promise.all([
      db
        .from("addresses")
        .select("id", { count: "exact", head: true })
        .not("lat", "is", null)
        .not("lng", "is", null),
      db.from("addresses").select("id", { count: "exact", head: true }),
    ]);

    return {
      ...base,
      pinnedAddresses: pinned ?? 0,
      // A failed total is null, never 0 — the denominator rule. "3 of 0 pinned" is
      // worse than "we could not count them".
      addressesTotal: error ? null : (total ?? 0),
    };
  } catch (thrown) {
    console.error(`[concentration] address pins threw — ${describeError(thrown)}`);
    return { ...base, pinnedAddresses: 0, addressesTotal: null };
  }
}
