import "server-only";

import { unstable_cache } from "next/cache";

import { CATEGORY_COUNT_FLOOR } from "@/lib/config/platform";
import { describeError, rethrowFrameworkSignal } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Real counts for the homepage, cached across visitors.
 *
 * WHAT THIS REPLACES. `lib/mock/categoryStats.ts` held "312 booked this week"
 * for plumbing against 14 real bookings across all ten trades. The number is
 * real now, and the floor is what stops a real number being just as misleading:
 * "2 booked this week" invites a conclusion about demand that a sample of two
 * cannot support.
 *
 * CACHED ACROSS VISITORS, NOT PER REQUEST, and the distinction is the whole
 * reason this is not `cache()` from React. `platformStats` uses that, which
 * dedupes within one render and hits the database again for the next visitor —
 * fine for three counted reads, wrong for a read that exists only to decorate a
 * card. `unstable_cache` holds one result for every visitor for the window
 * below. CLAUDE.md's latency list names exactly this: "caching the catalogue
 * reads so a filtered /services does not re-query per visitor."
 *
 * A WEEK'S COUNT DOES NOT NEED TO BE FRESH TO THE MINUTE. Fifteen minutes is
 * far inside the noise of a rolling seven-day window, and it turns a per-visitor
 * query into at most four an hour.
 */

/** Long enough to be worth caching, short enough that nobody notices. */
const REVALIDATE_SECONDS = 15 * 60;

/** The window the card describes. Seven days, as the copy says. */
const WINDOW_DAYS = 7;

/**
 * Bookings per category in the last seven days, or null where there are too
 * few to print.
 *
 * NULL IS "NOT WORTH SHOWING", AND THE CARD RENDERS NOTHING FOR IT — never a
 * zero, never "fewer than twenty". Rule 6 in the shape it takes for a
 * marketing surface: an absence is honest, a small number presented as
 * evidence is not.
 *
 * A FAILED READ RETURNS AN EMPTY MAP, so every card falls back to the price
 * line it already carries. A partial count would be a smaller version of the
 * lie this replaced.
 */
export type CategoryCounts = ReadonlyMap<string, number>;

async function readCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!hasSupabaseConfig()) return counts;

  try {
    const since = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    /*
     * THE SERVICE ROLE, DELIBERATELY, AND IT READS NOTHING PERSONAL. This is an
     * aggregate over `category_slug` and nothing else — no customer, no
     * address, no amount. The anon client would be subject to the bookings RLS
     * policies, which correctly show a visitor none of this, and the resulting
     * count would be zero for everybody rather than wrong in an interesting
     * way. The narrow select is what keeps that safe: add a column here and
     * this stops being an aggregate.
     */
    const { data, error } = await createAdminClient()
      .from("bookings")
      .select("category_slug")
      .gte("created_at", since)
      .neq("status", "cancelled")
      .limit(10_000);

    if (error) {
      console.error(`[activity] category counts failed — ${describeError(error)}`);
      return new Map();
    }

    for (const row of (data ?? []) as { category_slug: string | null }[]) {
      if (!row.category_slug) continue;
      counts.set(row.category_slug, (counts.get(row.category_slug) ?? 0) + 1);
    }

    // The floor is applied here rather than at the card, so no surface can
    // render a figure this module decided was not worth printing.
    for (const [slug, n] of Array.from(counts)) {
      if (n < CATEGORY_COUNT_FLOOR) counts.delete(slug);
    }

    return counts;
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    console.error(`[activity] category counts threw — ${describeError(thrown)}`);
    return new Map();
  }
}

/**
 * `unstable_cache` cannot serialise a Map, so the cached layer holds entries
 * and the Map is rebuilt outside it. Returning the Map directly from the cached
 * function silently hands back an empty one on a cache hit.
 */
const cachedEntries = unstable_cache(
  async (): Promise<[string, number][]> => Array.from(await readCounts()),
  ["category-booking-counts"],
  { revalidate: REVALIDATE_SECONDS, tags: ["category-counts"] },
);

export async function categoryBookingCounts(): Promise<CategoryCounts> {
  return new Map(await cachedEntries());
}
