/**
 * The geo module's public surface.
 *
 * Isomorphic and dependency-free. The booking form needs to validate a coordinate in
 * the browser and the ranking needs to measure one on the server, so nothing here may
 * reach `server-only` — the same constraint `lib/abuse` carries and for the same
 * reason.
 *
 * `./tiles` is deliberately NOT re-exported. It is the one adapter naming a tile host
 * and only the map component should reach it; a barrel export would make it one
 * autocomplete away from any file that wanted a URL.
 */
export {
  haversineKm,
  isPoint,
  type Point,
} from "./distance";

export {
  CENTROID_PROVENANCE,
  nearestServedKm,
  wardCentre,
} from "./wards";
