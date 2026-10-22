import { cache } from "react";

import { AREA_SEED, type Area } from "@/lib/config/areas";
import {
  describeError,
  markDataSource,
  readDataSources,
  rethrowFrameworkSignal,
} from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Service areas, from the table.
 *
 * TWO READS, BECAUSE THEY ARE TWO QUESTIONS WITH DIFFERENT COSTS WHEN THEY FAIL.
 * That split is the whole design here and it is the thing to keep:
 *
 *   `allAreas()`      — EVERY area ever, retired included. Used to turn a key
 *                       already stored on a row into words: an old booking, a
 *                       provider card, an application. A retired ward must still
 *                       render, or a page cannot say where the job was. The seed
 *                       is a fine fallback, because a place name does not go
 *                       stale and the key is already frozen on the row.
 *
 *   `bookableAreas()` — LIVE ones only, for a choice somebody is about to make:
 *                       a customer adding an address, a professional naming
 *                       where they work. **It returns null on a failed read**
 *                       rather than the seed, because the seed cannot know what
 *                       somebody retired last week, and offering a withdrawn
 *                       ward takes a booking nobody will travel to.
 *
 * It is the `categoryQuote` lesson one table over: a failed read must not be
 * served as a measured answer. The difference is that here it depends on what
 * the answer is FOR — the same row is safe to label with and unsafe to offer.
 *
 * AN UNCONFIGURED CLONE GETS THE SEED ON BOTH, deliberately and for the reason
 * `getCategories` gives: with no keys the seed IS the data, there is nothing it
 * can be stale against, and withholding it would break a fresh checkout to
 * guard against nothing.
 */

/** An area as the admin screen needs it — the words plus its standing. */
export type AreaRow = Area & {
  sortOrder: number;
  /**
   * When we stopped taking NEW work here, with why and who.
   *
   * NULL IS "WE STILL SERVE IT", never "unknown" — `areas_retired_shape`
   * refuses a partial triple, so these three are null together or set together.
   */
  retiredAt: string | null;
  retiredReason: string | null;
  retiredBy: string | null;
};

type Row = {
  key: string;
  city: string;
  city_ne: string;
  ward_number: number;
  name: string;
  name_ne: string;
  sort_order: number;
  retired_at: string | null;
  retired_reason: string | null;
  retired_by: string | null;
};

function fromRow(row: Row): AreaRow {
  return {
    key: row.key,
    city: row.city,
    cityNe: row.city_ne,
    wardNumber: row.ward_number,
    name: row.name,
    nameNe: row.name_ne,
    sortOrder: row.sort_order,
    retiredAt: row.retired_at,
    retiredReason: row.retired_reason,
    retiredBy: row.retired_by,
  };
}

const SELECT =
  "key, city, city_ne, ward_number, name, name_ne, sort_order, retired_at, retired_reason, retired_by";

/** The seed as `AreaRow`s — nothing retired, because the file records no retirement. */
function seedRows(): AreaRow[] {
  return AREA_SEED.map((area, index) => ({
    ...area,
    sortOrder: index * 10,
    retiredAt: null,
    retiredReason: null,
    retiredBy: null,
  }));
}

/**
 * Every area, in display order, retired ones last within their city.
 *
 * `null` ONLY WHEN THERE IS NOTHING TO FALL BACK ON, which cannot happen today:
 * the seed always has the fifteen. The signature says `AreaRow[]` for that
 * reason — a label read has an honest answer in every case, and giving it a
 * nullable return would push a "we could not read it" branch onto a dozen
 * surfaces that are only printing a place name.
 */
export const allAreas = cache(async (): Promise<AreaRow[]> => {
  if (!hasSupabaseConfig()) {
    markDataSource("areas", "seed", "no Supabase URL or anon key");
    return seedRows();
  }

  try {
    const { data, error } = await createPublicClient()
      .from("areas")
      .select(SELECT)
      .order("sort_order");

    if (error || !data || data.length === 0) {
      markDataSource(
        "areas",
        "seed",
        error ? describeError(error) : "query returned 0 rows",
      );
      return seedRows();
    }

    markDataSource("areas", "database");
    return (data as Row[]).map(fromRow);
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    markDataSource("areas", "seed", describeError(thrown));
    return seedRows();
  }
});

/**
 * The areas somebody may CHOOSE right now, or null if we could not read them.
 *
 * NULL IS THE POINT OF THIS FUNCTION. `allAreas` above falls back to the seed
 * and is right to; this one must not, because a retirement is a decision the
 * file cannot know about. Offering a ward we withdrew last week takes a booking
 * no professional will travel to and tells a customer we serve somewhere we do
 * not — so the caller says "we could not load the areas" instead, the way
 * `/book` does for an unreadable price band.
 *
 * It composes `allAreas` rather than running a second query: one round trip per
 * request (the standing latency rule), one `markDataSource` reading, and no way
 * for the two to disagree about which areas exist.
 */
export async function bookableAreas(): Promise<AreaRow[] | null> {
  /*
   * THE UNCONFIGURED CASE IS NOT A FAILURE and must not refuse. With no keys the
   * seed is the data; `allAreas` has already marked it, and `seedRows()` carries
   * no retirement, so filtering below is a no-op rather than a lie.
   */
  const rows = await allAreas();

  if (hasSupabaseConfig()) {
    /*
     * A READ THAT FELL BACK IS A READ THAT FAILED, here. `allAreas` cannot tell
     * the caller which path it took through its return value — by design, since
     * a label read does not care — so this asks `markDataSource`'s own record,
     * which is the one place that knows. Reading the flag rather than
     * re-querying is what keeps this to a single round trip.
     */
    if (readDataSources().areas.source === "seed") return null;
  }

  return rows.filter((area) => area.retiredAt === null);
}

