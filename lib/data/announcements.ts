import "server-only";

import { unstable_cache } from "next/cache";

import type { Announcement } from "@/lib/config/announcements";
import {
  describeError,
  markDataSource,
  rethrowFrameworkSignal,
} from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The banner read. One query, cached across visitors, on every page.
 *
 * THE COOKIE-FREE CLIENT, DELIBERATELY. `announcements` grants `select` to
 * `anon` and its policy is `using (true)`, because the banner is on the landing
 * page and a visitor has no session — the rows hold published copy and nothing
 * else, no person, no amount, no id of anything private. Reading it as `anon`
 * is also what keeps that policy a door the product actually walks through:
 * `provider_applications`' write policies were a door nobody used, and nobody
 * noticed for months that they granted nothing anybody needed.
 *
 * WHICH rows are SHOWN is `showingNow`'s rule and not the query's. Everything
 * enabled and not yet over is read; the filter is applied in TypeScript because
 * it is the same rule `/admin/announcements` and the tests need, and a `now()`
 * in SQL would be a second copy of it that could disagree. The row count here
 * is a handful by construction.
 */

/** The tag a publish, an edit or a withdrawal revalidates. */
export const ANNOUNCEMENTS_TAG = "announcements";

/**
 * ONE MINUTE, NOT THE FIFTEEN `contentOverrides` AND `recentActivity` USE, and
 * the reason is the one thing a tag cannot cover. `updateTag` makes a publish
 * instant, so this window never delays a banner somebody just wrote. What it
 * bounds is the two changes no action fires: a banner SCHEDULED for 09:00,
 * whose window opens with nobody touching anything, and a failed read — both
 * of which a fifteen-minute cache would carry a quarter of an hour past the
 * moment they mattered. One query a minute per instance is not a cost worth
 * weighing against a banner being right on time.
 */
const CACHE_SECONDS = 60;

/**
 * What the cached layer holds.
 *
 * THE FAILURE IS CARRIED OUT RATHER THAN LOGGED INSIDE, because
 * `markDataSource` writes into a `cache()`d per-request store and this function
 * only runs on a cache MISS. Called in here, the `?debug=data` badge would
 * report `unread` on every one of the hits that follow — a reading that is a
 * lie in the quieter direction, which is rule 6's own shape for a diagnostic.
 */
type AnnouncementRead = {
  rows: Announcement[];
  /** Null when the query answered. A string is why it did not. */
  failed: string | null;
};

const COLUMNS =
  "id, body_en, body_ne, audience, tone, starts_at, ends_at, enabled";

/** Exactly the columns `COLUMNS` names. Exported so the admin read, whose
    select is a superset, can reuse the one mapper rather than writing a second. */
export type AnnouncementRow = {
  id: string;
  body_en: string;
  body_ne: string;
  audience: string;
  tone: string;
  starts_at: string;
  ends_at: string | null;
  enabled: boolean;
};

export function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    bodyEn: row.body_en,
    bodyNe: row.body_ne,
    audience: row.audience as Announcement["audience"],
    tone: row.tone as Announcement["tone"],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    enabled: row.enabled,
  };
}

async function readAnnouncements(): Promise<AnnouncementRead> {
  if (!hasSupabaseConfig()) return { rows: [], failed: "no supabase config" };

  try {
    const { data, error } = await createPublicClient()
      .from("announcements")
      .select(COLUMNS)
      .eq("enabled", true);

    if (error) return { rows: [], failed: describeError(error) };
    return {
      rows: (data ?? []).map((row) =>
        toAnnouncement(row as unknown as AnnouncementRow),
      ),
      failed: null,
    };
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    return { rows: [], failed: describeError(thrown) };
  }
}

const cachedAnnouncements = unstable_cache(
  readAnnouncements,
  ["announcements"],
  { revalidate: CACHE_SECONDS, tags: [ANNOUNCEMENTS_TAG] },
);

/**
 * Every banner that could be showing. The caller asks `bannerFor` which one is.
 *
 * A FAILED READ RETURNS NOTHING AND RENDERS NOTHING, which is the one place in
 * this product where that is the honest answer rather than rule 6's mistake.
 * `/services` can say "we can't load professionals right now — this is us, not
 * you" because the reader came for professionals. Nobody came for a banner:
 * the absence of one is the common case on every page, and a sentence in its
 * place would be an error message at the top of the whole product whenever a
 * query hiccupped. `?debug=data` is where the two are told apart — hence
 * `announcements` on that badge — and `/admin/announcements` is where a failed
 * read is a sentence, because there somebody IS asking.
 */
export async function liveAnnouncements(): Promise<Announcement[]> {
  const read = await cachedAnnouncements();

  markDataSource(
    "announcements",
    read.failed === null ? "database" : "failed",
    read.failed ?? undefined,
  );

  return read.rows;
}
