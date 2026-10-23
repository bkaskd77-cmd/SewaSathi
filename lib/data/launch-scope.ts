import "server-only";

import { unstable_cache } from "next/cache";

import { SCOPE_OFF, type LaunchScope } from "@/lib/config/launch-scope";
import {
  describeError,
  markDataSource,
  rethrowFrameworkSignal,
} from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The soft-launch scope: one row, cached across visitors, on every catalogue read.
 *
 * NULL IS "WE COULD NOT READ IT" AND THE CALLERS REFUSE ON IT. That is the only
 * interesting decision in this file, so it is argued rather than asserted.
 *
 * The tempting fallback is `SCOPE_OFF` — a failed read opens everything, the
 * product carries on exactly as it does today, nobody sees an error. It is also
 * the one that costs real money during the thing this feature exists for: with
 * the scope ON and narrowed to two wards, a query hiccup would put all fifteen
 * back on the address picker and take bookings in wards where we have nobody to
 * send. `bookableAreas()` settled this same question one table over and for the
 * same reason — it returns null rather than the seed, because "offering a
 * withdrawn ward takes a booking nobody will travel to".
 *
 * So the two unreadable states are deliberately different:
 *
 *   NO SUPABASE CONFIG  -> `SCOPE_OFF`. With no keys the seed IS the data,
 *                          there is no row this can be stale against, and
 *                          refusing would break a fresh checkout to guard
 *                          against nothing. `getCategories`' reasoning.
 *   READ FAILED         -> `null`. Keys are configured, so a row exists and
 *                          somebody may have narrowed it. We do not know what
 *                          it says, and guessing "open" is guessing in the
 *                          expensive direction.
 *
 * ZERO ROWS IS A FAILED READ, not "no scope". The migration seeds the row
 * precisely so the two cannot be confused — see its header.
 *
 * THE COOKIE-FREE CLIENT, because the catalogue and the booking flow are read
 * as `anon` and a visitor has no session. The row holds two lists of public
 * identifiers and a switch; `note` and `updated_by` are not granted to either
 * browser role and are read by the admin screen through the service role.
 */

/** The tag a scope change revalidates. */
export const LAUNCH_SCOPE_TAG = "launch-scope";

/**
 * ONE MINUTE, the `announcements` window and for the same reason. `updateTag`
 * makes a widening instant, so this never delays a change somebody just made;
 * what the window bounds is the one change no action fires — a failed read
 * recovering — so a hiccup narrows the catalogue for at most a minute rather
 * than until the next write.
 */
export const CACHE_SECONDS = 60;

const COLUMNS = "enabled, area_keys, category_slugs";

type ScopeRow = {
  enabled: boolean;
  area_keys: string[] | null;
  category_slugs: string[] | null;
};

type ScopeRead = { scope: LaunchScope | null; failed: string | null };

async function readScope(): Promise<ScopeRead> {
  if (!hasSupabaseConfig()) return { scope: SCOPE_OFF, failed: null };

  try {
    const { data, error } = await createPublicClient()
      .from("launch_scope")
      .select(COLUMNS)
      .limit(1);

    if (error) return { scope: null, failed: describeError(error) };

    const row = (data ?? [])[0] as ScopeRow | undefined;
    /*
     * NO ROW IS A FAILED READ. The migration seeds one, so an empty result
     * means the table is missing, the migration has not been applied to this
     * deployment, or the policy stopped answering — every one of which is a
     * thing to refuse on rather than to read as "no scope".
     */
    if (!row) return { scope: null, failed: "launch_scope has no row" };

    return {
      scope: {
        enabled: row.enabled,
        /* `?? []` on a NOT NULL column is belt and braces for a column the
           browser could in principle be denied; it cannot make an empty list
           mean "everything", because `enabled` is what decides that. */
        areaKeys: row.area_keys ?? [],
        categorySlugs: row.category_slugs ?? [],
      },
      failed: null,
    };
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    return { scope: null, failed: describeError(thrown) };
  }
}

const cachedScope = unstable_cache(readScope, ["launch-scope"], {
  revalidate: CACHE_SECONDS,
  tags: [LAUNCH_SCOPE_TAG],
});

/**
 * The scope in force, or null if we could not read it.
 *
 * `markDataSource` IS CALLED OUTSIDE THE CACHE, which is the mistake
 * `liveAnnouncements` records: inside `unstable_cache` it only runs on a miss,
 * so `?debug=data` would read `unread` on every hit afterwards and the badge
 * would describe a failure that had already recovered.
 */
export async function launchScope(): Promise<LaunchScope | null> {
  const read = await cachedScope();

  markDataSource(
    "launchScope",
    read.failed === null ? "database" : "failed",
    read.failed ?? undefined,
  );

  return read.scope;
}
