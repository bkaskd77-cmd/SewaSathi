import areaSeed from "@/lib/data/seed/areas.json";

import type { Locale } from "@/i18n/routing";

/**
 * Service areas, at ward level — the SHAPE and the pure helpers.
 *
 * Ward is the unit people actually use here — "Lalitpur ward 4" locates you in
 * a way a district does not, and it is what a provider thinks in when deciding
 * whether a job is worth the ride.
 *
 * Place names live here rather than in the message catalogue: they are data,
 * not interface copy, and a translator adding a locale should not be handed
 * fifteen Kathmandu neighbourhoods to render into their own script. The one
 * genuinely translatable word — "Ward" — stays in the catalogue and is passed
 * in, so nothing here has to reach for a translator.
 *
 * **IT IS A TABLE NOW**, which is what the previous version of this comment said
 * would happen: "A small fixed list for now... When this becomes a table (it
 * will, with provider coverage maps), the shape below is what it should return."
 * `lib/data/areas.ts` is that read and this is still that shape.
 *
 * SO `AREA_SEED` IS NAMED FOR WHAT IT IS, and `AREAS` is gone. The old name
 * read as "the service areas" and was imported at module scope by fifteen
 * files, which made a list that can be retired by a person look like a
 * constant — `/providers/join` would have gone on offering a ward somebody
 * withdrew, and nothing would have failed. Anything that needs the live answer
 * asks `allAreas()` or `bookableAreas()`; this file keeps the seed as the
 * bootstrap and the label fallback, and the locale helpers, which are pure and
 * belong nowhere else.
 */

export type Area = {
  /** "lalitpur-4" — city slug and ward number. */
  key: string;
  city: string;
  cityNe: string;
  wardNumber: number;
  /** The name people say out loud. */
  name: string;
  nameNe: string;
};

/**
 * The fifteen launch wards as authored.
 *
 * NOT "the service areas" — the TABLE is that, and this is two other things:
 * what a clone with no Supabase keys renders, and what a LABEL read falls back
 * to when the query fails. A place name does not go stale, so that fallback is
 * honest; a RETIREMENT is not in here and cannot be, which is exactly why
 * `bookableAreas()` refuses to fall back on it.
 */
export const AREA_SEED = areaSeed as Area[];

/** Seed keys. For a bootstrap or a test fixture — never to validate a choice. */
export const AREA_SEED_KEYS = AREA_SEED.map((area) => area.key);

/**
 * What an area key has to look like: a city slug, a hyphen, a ward number.
 *
 * THIS STRING IS NOT COSMETIC. It is `addresses.area_key`,
 * `provider_leads.area_key`, every entry of `providers.service_areas` and every
 * key in `seed/area-centroids.json` — with no foreign key anywhere behind it.
 * So a ward opened as "Kathmandu 4" would render perfectly on the admin screen
 * and match nothing: no centroid, no coverage array, and `provider_serves`
 * quietly finding nobody in it.
 *
 * ONE PATTERN WRITTEN TWICE, which is this project's most-repeated sin, so it is
 * compared rather than trusted: `areas_key_shape` carries the same regex and
 * `tests/db/service-areas.test.ts` reads the constraint out of `pg_constraint`
 * and asserts the two texts are identical. It lives HERE, beside the pure
 * helpers, rather than in the `server-only` writer that enforces it — the
 * mistake this file's own history records — so a unit test can reach it too.
 *
 * The constraint is what makes a bad key impossible; this copy is what turns the
 * refusal into a sentence a person can act on instead of a Postgres error.
 */
export const AREA_KEY_SHAPE = /^[a-z]+(-[a-z]+)*-[0-9]+$/;

/**
 * Find an area in a list, by key.
 *
 * TAKES THE LIST RATHER THAN READING ONE, which is the change that matters:
 * the old `findArea(key)` closed over the seed, so every caller silently asked
 * the file. Callers now pass what they read — `await allAreas()` for a label,
 * `await bookableAreas()` for a choice — and the compiler names any that had
 * been relying on the file.
 */
export function findAreaIn<T extends { key: string }>(
  areas: readonly T[],
  key: string | null | undefined,
): T | null {
  if (!key) return null;
  return areas.find((area) => area.key === key) ?? null;
}

export function areaCity(area: Area, locale: Locale): string {
  return locale === "ne" ? area.cityNe : area.city;
}

export function areaName(area: Area, locale: Locale): string {
  return locale === "ne" ? area.nameNe : area.name;
}

/**
 * "Lalitpur · Ward 4 (Jhamsikhel)" — `ward` is the already-formatted word and
 * number, e.g. t("ward", {n: "4"}).
 */
export function areaLabel(area: Area, locale: Locale, ward: string): string {
  return `${areaCity(area, locale)} · ${ward} (${areaName(area, locale)})`;
}

/**
 * "Jhamsikhel, Lalitpur" — the short form for a provider card.
 *
 * FALLS BACK TO THE KEY and that is deliberate: a card naming a ward nobody can
 * resolve should say `lalitpur-4` rather than nothing, because the string is at
 * least the thing the row actually holds.
 */
export function areaShortLabel(
  areas: readonly Area[],
  key: string,
  locale: Locale = "en",
): string {
  const area = findAreaIn(areas, key);
  if (!area) return key;
  return `${areaName(area, locale)}, ${areaCity(area, locale)}`;
}

/** Grouped for a <select>, so the three cities read as three groups. */
export function areasByCity<T extends Area>(
  areas: readonly T[],
  locale: Locale = "en",
): Array<{ city: string; areas: T[] }> {
  const cities: string[] = [];
  for (const area of areas) {
    if (!cities.includes(area.city)) cities.push(area.city);
  }
  return cities.map((city) => ({
    city: areaCity(areas.find((a) => a.city === city)!, locale),
    areas: areas.filter((area) => area.city === city),
  }));
}
