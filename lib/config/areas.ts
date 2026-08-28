import areaSeed from "@/lib/data/seed/areas.json";

/**
 * Service areas, at ward level.
 *
 * Ward is the unit people actually use here — "Lalitpur ward 4" locates you in
 * a way a district does not, and it is what a provider thinks in when deciding
 * whether a job is worth the ride.
 *
 * A small fixed list for now, covering the three cities we launch in. When
 * this becomes a table (it will, with provider coverage maps), the shape below
 * is what it should return.
 */

export type Area = {
  /** "lalitpur-4" — city slug and ward number. */
  key: string;
  city: string;
  ward: string;
  /** The name people say out loud. */
  name: string;
};

export const AREAS = areaSeed as Area[];

export const AREA_KEYS = AREAS.map((area) => area.key);

export function findArea(key: string | null | undefined): Area | null {
  if (!key) return null;
  return AREAS.find((area) => area.key === key) ?? null;
}

/** "Lalitpur · Ward 4 (Jhamsikhel)" */
export function areaLabel(area: Area): string {
  return `${area.city} · ${area.ward} (${area.name})`;
}

/** "Jhamsikhel, Lalitpur" — the short form for a provider card. */
export function areaShortLabel(key: string): string {
  const area = findArea(key);
  return area ? `${area.name}, ${area.city}` : key;
}

/** Grouped for a <select>, so the three cities read as three groups. */
export function areasByCity(): Array<{ city: string; areas: Area[] }> {
  const cities: string[] = [];
  for (const area of AREAS) {
    if (!cities.includes(area.city)) cities.push(area.city);
  }
  return cities.map((city) => ({
    city,
    areas: AREAS.filter((area) => area.city === city),
  }));
}
