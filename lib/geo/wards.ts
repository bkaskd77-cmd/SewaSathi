import centroidSeed from "@/lib/data/seed/area-centroids.json";

import { haversineKm, isPoint, type Point } from "./distance";

/**
 * Where a ward is, roughly, and how far the nearest one somebody serves is.
 *
 * WHY WARDS AND NOT PROFESSIONALS. `providers` has no coordinates at all — only
 * `service_areas`, a list of ward keys. Giving each professional a base point would
 * mean collecting their home or shop location, a migration, a new onboarding step, and
 * six existing professionals unmeasured until each came back to set one. A ward
 * centroid costs nothing, is already implied by the data we hold, and resolves to
 * within a kilometre or two — which is the right resolution for "who is nearest in the
 * Valley" and already far better than today's single flat score for everybody outside
 * the chosen ward.
 *
 * THE FIGURES ARE APPROXIMATE AND THE FILE SAYS SO. `area-centroids.json` carries its
 * own `source`, `fetchedAt` and `precision`, because a coordinate with no provenance is
 * a number somebody will later treat as surveyed. They are derived from OpenStreetMap
 * ward boundaries by `scripts/fetch-ward-centroids.mjs` rather than estimated by hand.
 *
 * AN EMPTY SEED IS A WORKING STATE, NOT A BROKEN ONE. Until that script has run,
 * `wardCentre` returns null for every ward, `nearestServedKm` returns null for
 * everybody, and `scoreParts` falls back to ward membership — byte-for-byte the
 * behaviour before this module existed. That is deliberate: the sandbox this was built
 * in cannot reach OpenStreetMap, and shipping a hand-guessed table to avoid an empty
 * file would have put unsourced coordinates into a ranking input.
 */

type CentroidSeed = {
  source: string;
  fetchedAt: string | null;
  precision: string;
  wards: Record<string, { lat: number; lng: number }>;
};

const seed = centroidSeed as CentroidSeed;

/** What the seed says about itself, for `/admin/signals` to print. */
export const CENTROID_PROVENANCE = {
  source: seed.source,
  fetchedAt: seed.fetchedAt,
  precision: seed.precision,
  /** How many of the wards we sell in have a centre. */
  known: Object.keys(seed.wards).length,
};

/**
 * The approximate centre of a ward, or null when we do not have one.
 *
 * NULL FOR AN UNKNOWN KEY AND FOR AN UNFETCHED SEED ALIKE, because the caller's
 * correct behaviour is the same in both cases and inventing a difference would invite
 * one of them to be handled as "nearly zero".
 */
export function wardCentre(areaKey: string | null | undefined): Point | null {
  if (!areaKey) return null;
  const found = seed.wards[areaKey];
  return isPoint(found) ? found : null;
}

/**
 * How far the nearest ward this professional serves is from a point.
 *
 * THE NEAREST, NOT THE AVERAGE. Somebody who serves four wards travels from whichever
 * is closest to the job — an average would punish a professional for covering a wide
 * area, which is the opposite of what we want to encourage.
 *
 * NULL WHEN EITHER END IS UNKNOWN: no pin on the address, no centroid for any ward they
 * serve, or no service areas at all. The caller must not read that as a large distance,
 * which is why it is null rather than `Infinity` — a number would survive arithmetic
 * and quietly rank somebody last.
 */
export function nearestServedKm(
  serviceAreas: readonly string[] | null | undefined,
  to: Point | null,
): number | null {
  if (!to || !isPoint(to) || !serviceAreas || serviceAreas.length === 0) {
    return null;
  }

  let nearest: number | null = null;
  for (const key of serviceAreas) {
    const centre = wardCentre(key);
    if (!centre) continue;
    const km = haversineKm(centre, to);
    if (km === null) continue;
    if (nearest === null || km < nearest) nearest = km;
  }
  return nearest;
}
