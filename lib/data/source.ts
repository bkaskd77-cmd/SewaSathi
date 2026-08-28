import "server-only";

import { cache } from "react";

/**
 * Where the data on this page actually came from.
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
 * `cache` gives one object per request, so two visitors cannot see each
 * other's readings.
 */

export type DataSource = "database" | "seed" | "unread";

export type DataSources = {
  categories: DataSource;
  providers: DataSource;
  reviews: DataSource;
};

const store = cache((): DataSources => ({
  categories: "unread",
  providers: "unread",
  reviews: "unread",
}));

export function markDataSource(key: keyof DataSources, source: DataSource) {
  store()[key] = source;
}

export function readDataSources(): DataSources {
  return { ...store() };
}
