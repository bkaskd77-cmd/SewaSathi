import "server-only";

import { unstable_cache } from "next/cache";

import {
  ACTIVITY_DELAY_MINUTES,
  ACTIVITY_FLOOR,
  ACTIVITY_MAX,
  CATEGORY_COUNT_FLOOR,
} from "@/lib/config/platform";
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


/* ------------------------------------------------------------------ *
 * The activity strip
 * ------------------------------------------------------------------ */

/**
 * One finished job, stripped to what a stranger may see.
 *
 * FIRST NAME, TRADE, CITY. Never a surname, never a ward, never a street, never
 * an amount, never an id. The ward is the one people ask for and it is the one
 * that must not be here: "Priya in Baneshwor" narrows a person to a few hundred
 * households; "Priya in Kathmandu" does not. The predecessor to this strip
 * named wards, and it could do that because none of the people were real.
 */
export type ActivityEntry = {
  /** First token of the customer's name. Nothing else from it. */
  name: string;
  /** City, and only city — `area_key` and `ward_number` are never selected. */
  city: string;
  categorySlug: string;
  /** Rounded to the hour. A precise minute is a timestamp; this is a rhythm. */
  hoursAgo: number;
};

/**
 * Finished jobs eligible to be shown, or an empty list.
 *
 * FIVE FILTERS, AND EACH ONE EXISTS BECAUSE THE ALTERNATIVE IS A REAL HARM:
 *
 *   1. **Completed only**, and completed at least `ACTIVITY_DELAY_MINUTES` ago.
 *      Nothing live while a professional is at the door.
 *   2. **The customer has not opted out** — `profiles.hide_from_activity`.
 *   3. **No guarantee claim on the booking.** Somebody in the middle of a
 *      complaint about the work must not find that work advertised.
 *   4. **No amount dispute** — `amount_mismatch_at` unset. Same reason.
 *   5. **Above the floor or nothing at all.** One entry reads as "this is all
 *      that has ever happened here".
 *
 * THE FLOOR IS APPLIED TO THE WHOLE LIST, not per category, and the empty array
 * is returned rather than a short one — the component renders nothing for it, so
 * there is no arrangement in which a single booking is the feed.
 */
export async function recentActivity(): Promise<ActivityEntry[]> {
  return cachedActivity();
}

async function readActivity(): Promise<ActivityEntry[]> {
  if (!hasSupabaseConfig()) return [];

  try {
    const cutoff = new Date(
      Date.now() - ACTIVITY_DELAY_MINUTES * 60 * 1000,
    ).toISOString();

    /*
     * THE SELECT IS THE PRIVACY BOUNDARY, so it is written narrowly and on
     * purpose. `addresses` gives up `city` and nothing else; `profiles` gives up
     * `full_name` and the opt-out flag. No ward, no tole, no landmark, no
     * amount, no id. Widening this list is a privacy change, not a refactor.
     */
    const { data, error } = await createAdminClient()
      .from("bookings")
      // ONE STRING AND NO COMMENT INSIDE THE CALL, which is not a style choice.
      // `scripts/column-manifest.mjs` reads these selects out of the source to
      // check every column exists, and it reads the literal that follows
      // `.select(`. A `+` between two halves left the whole list unverified, and
      // a comment in there was read as the list — on the one select in this
      // product where a stray column is a privacy incident. Both were caught by
      // `tests/db/column-manifest.test.ts`, which printed what it could see.
      .select(
        "category_slug, completed_at, amount_mismatch_at, profiles!bookings_customer_id_fkey(full_name, hide_from_activity), addresses(city), guarantee_claims(id)",
      )
      .eq("status", "completed")
      .lte("completed_at", cutoff)
      .is("amount_mismatch_at", null)
      .order("completed_at", { ascending: false })
      .limit(60);

    if (error) {
      console.error(`[activity] strip read failed — ${describeError(error)}`);
      return [];
    }

    const now = Date.now();
    const entries: ActivityEntry[] = [];

    /*
     * THROUGH `unknown`, because `types/supabase.ts` is hand-written and does
     * not model these embedded relationships — supabase-js therefore infers an
     * error shape for the row rather than the join. The narrow field reads
     * below are what actually validate it.
     */
    for (const row of ((data ?? []) as unknown) as Record<string, unknown>[]) {
      const profile = one(row.profiles) as
        | { full_name?: string | null; hide_from_activity?: boolean | null }
        | null;
      const address = one(row.addresses) as { city?: string | null } | null;
      const claims = row.guarantee_claims;

      // Opted out, or a claim is open on this job.
      if (profile?.hide_from_activity) continue;
      if (Array.isArray(claims) ? claims.length > 0 : Boolean(claims)) continue;

      const first = String(profile?.full_name ?? "").trim().split(/\s+/)[0];
      const city = String(address?.city ?? "").trim();
      const slug = row.category_slug ? String(row.category_slug) : "";
      const completedAt = row.completed_at ? Date.parse(String(row.completed_at)) : NaN;

      // A row missing any of the three cannot be rendered into a sentence, and
      // inventing a substitute is exactly what this strip replaced.
      if (!first || !city || !slug || Number.isNaN(completedAt)) continue;

      entries.push({
        name: first,
        city,
        categorySlug: slug,
        hoursAgo: Math.max(1, Math.round((now - completedAt) / 3_600_000)),
      });
    }

    // All of it, or none of it.
    if (entries.length < ACTIVITY_FLOOR) return [];
    return entries.slice(0, ACTIVITY_MAX);
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    console.error(`[activity] strip threw — ${describeError(thrown)}`);
    return [];
  }
}

/** supabase-js gives an embedded row as an object or a one-element array. */
function one(value: unknown): unknown {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const cachedActivity = unstable_cache(readActivity, ["homepage-activity"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["activity"],
});
