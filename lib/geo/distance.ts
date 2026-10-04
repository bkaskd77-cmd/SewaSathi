/**
 * Distance, and the honest absence of it.
 *
 * NOTHING IN THIS REPOSITORY DID DISTANCE MATHS BEFORE. `proximity` in
 * `lib/data/ranking.ts` was ward membership — 1.0 inside the chosen ward, 0.6
 * elsewhere in the city, 0.25 otherwise — so somebody two streets away across a ward
 * line scored identically to somebody in Bhaktapur. Thirty lines of trigonometry
 * rather than a dependency, for the same reason `readJpeg` is hand-written: it is
 * short, it is pure, and a package here would be a supply chain for one formula.
 *
 * EVERY FUNCTION HERE RETURNS NULL RATHER THAN A NUMBER IT CANNOT JUSTIFY. That is
 * rule 6 in the shape it takes for geography, and it is the whole reason this module
 * is separate from the ranking that uses it: a missing coordinate must be impossible
 * to confuse with a large distance. One is "we do not know where this is", the other
 * is "this is far away", and a product that collapses them tells a customer their
 * nearest professional is their furthest.
 */

/** A point on the earth. Both halves required — a lone latitude is not a place. */
export type Point = { lat: number; lng: number };

/** Mean earth radius in kilometres. */
const EARTH_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres.
 *
 * HAVERSINE RATHER THAN ANYTHING BETTER, deliberately. Vincenty and friends model the
 * earth as an ellipsoid and win centimetres over tens of kilometres; the inputs here
 * are ward centroids accurate to a kilometre or two by construction, so a more precise
 * formula would be precision theatre on top of approximate data.
 *
 * Returns null on anything that is not a finite coordinate pair, including the
 * out-of-range values a broken geolocation reading produces — a latitude of 200 is not
 * a point and should not come back as a plausible number of kilometres.
 */
export function haversineKm(a: Point, b: Point): number | null {
  if (!isPoint(a) || !isPoint(b)) return null;

  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether this is a coordinate pair we will do arithmetic on.
 *
 * EXPORTED BECAUSE THE WRITE PATH NEEDS THE SAME TEST AS THE READ PATH. A browser
 * geolocation reading, a hand-typed value and a stored row all have to pass one
 * definition of "is this a point", or the catalogue ends up ranking against something
 * the form was happy to save.
 */
export function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // (0, 0) is in the Gulf of Guinea and is what a zeroed sensor reports. Nothing in
    // Nepal is within two thousand kilometres of it, so it is a failure, not a place.
    !(lat === 0 && lng === 0)
  );
}
