import "server-only";

import { cache } from "react";

/**
 * Where the data on this page actually came from, and why.
 *
 * Every read in lib/data falls back to the seed JSON when Supabase is
 * unconfigured or a query fails — which is what keeps the product up, and also
 * what makes a broken query invisible: the seed and the tables hold the same
 * rows, so the page looks perfect either way.
 *
 * So each read records which path it took, and `?debug=data` shows it. Same
 * reasoning as the triage badge: a silent fallback is indistinguishable from a
 * working system, and the only honest fix is to make it say so.
 *
 * The `detail` is the second half of that lesson. "providers: seed" told us a
 * query had failed and nothing else — the Postgres error was caught and
 * dropped, so diagnosing it meant guessing at RLS, at missing columns, at
 * keys. It now carries the error code and message through to the badge and to
 * the server log, because the whole point of this thing is to end the guessing.
 *
 * `cache` gives one object per request, so two visitors cannot see each
 * other's readings.
 */

export type DataSource = "database" | "seed" | "unread";

export type DataReading = {
  source: DataSource;
  /** Why it fell back — a Postgres code and message, or a short reason. */
  detail?: string;
};

export type DataSourceKey =
  | "areas"
  | "categories"
  | "subBands"
  | "providers"
  | "reviews"
  /**
   * The banner, and it is the one key here with no seed behind it.
   *
   * Every other read in `lib/data` can fall back to the seed JSON, which is
   * what makes this badge necessary: the two hold the same rows, so a broken
   * query renders a perfect-looking page. `liveAnnouncements` has no fallback
   * at all — it returns nothing and the banner renders nothing — and that is
   * exactly why it belongs here. "No banner today" and "we could not read the
   * banners" are byte-identical on every page of the product, and this is the
   * only place they are told apart. So it reads `database` or `unread`, never
   * `seed`.
   */
  | "announcements";

export type DataSources = Record<DataSourceKey, DataReading>;

const store = cache((): DataSources => ({
  areas: { source: "unread" },
  categories: { source: "unread" },
  subBands: { source: "unread" },
  providers: { source: "unread" },
  reviews: { source: "unread" },
  announcements: { source: "unread" },
}));

export function markDataSource(
  key: DataSourceKey,
  source: DataSource,
  detail?: string,
) {
  store()[key] = { source, detail };

  // Vercel's runtime logs are the other place someone will look, and they are
  // the only place a production visitor's failure is visible at all.
  if (source === "seed" && detail) {
    console.error(`[data] ${key} fell back to seed — ${detail}`);
  }
}

export function readDataSources(): DataSources {
  const current = store();
  return {
    areas: { ...current.areas },
    categories: { ...current.categories },
    subBands: { ...current.subBands },
    providers: { ...current.providers },
    reviews: { ...current.reviews },
    announcements: { ...current.announcements },
  };
}

/**
 * Next signals control flow by throwing, and those throws must reach it.
 *
 * `cookies()` inside a statically-prerendered route throws DYNAMIC_SERVER_USAGE
 * to say "render me dynamically"; `notFound()` and `redirect()` throw too.
 * Catching those as if they were failed queries logged four alarming lines per
 * build and, worse, would have let a swallowed bailout confuse Next about
 * whether a route is static. Call this first in every catch block here.
 */
export function rethrowFrameworkSignal(error: unknown): void {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (
    typeof digest === "string" &&
    /^(NEXT_|DYNAMIC_SERVER_USAGE)/.test(digest)
  ) {
    throw error;
  }
}

/** A Supabase/Postgres error, flattened to one short line. */
export function describeError(error: unknown): string {
  if (!error) return "query returned no rows and no error";
  const e = error as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  const parts = [
    e.code ? `[${e.code}]` : null,
    e.message ?? String(error),
    e.hint ? `hint: ${e.hint}` : null,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 300);
}
