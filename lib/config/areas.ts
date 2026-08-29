import areaSeed from "@/lib/data/seed/areas.json";

import type { Locale } from "@/i18n/routing";

/**
 * Service areas, at ward level.
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
 * A small fixed list for now, covering the three cities we launch in. When
 * this becomes a table (it will, with provider coverage maps), the shape below
 * is what it should return.
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

export const AREAS = areaSeed as Area[];

export const AREA_KEYS = AREAS.map((area) => area.key);

export function findArea(key: string | null | undefined): Area | null {
  if (!key) return null;
  return AREAS.find((area) => area.key === key) ?? null;
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

/** "Jhamsikhel, Lalitpur" — the short form for a provider card. */
export function areaShortLabel(key: string, locale: Locale = "en"): string {
  const area = findArea(key);
  if (!area) return key;
  return `${areaName(area, locale)}, ${areaCity(area, locale)}`;
}

/** Grouped for a <select>, so the three cities read as three groups. */
export function areasByCity(
  locale: Locale = "en",
): Array<{ city: string; areas: Area[] }> {
  const cities: string[] = [];
  for (const area of AREAS) {
    if (!cities.includes(area.city)) cities.push(area.city);
  }
  return cities.map((city) => ({
    city: areaCity(
      AREAS.find((a) => a.city === city)!,
      locale,
    ),
    areas: AREAS.filter((area) => area.city === city),
  }));
}
