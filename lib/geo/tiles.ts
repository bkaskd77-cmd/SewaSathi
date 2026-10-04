/**
 * Where map tiles come from. The only file in this product that names a tile host.
 *
 * ONE ADAPTER PER EXTERNAL DEPENDENCY, which is the standing architecture rule and
 * earns its keep here more than usual: a tile request carries the viewport in its URL,
 * so whoever serves tiles learns roughly where the person looking at the map lives.
 * That is a decision about customers' privacy and it should be changeable in one edit
 * rather than hunted through a component.
 *
 * OPENSTREETMAP, AND ITS ATTRIBUTION IS NOT OPTIONAL. The ODbL requires the credit,
 * so `TILE_ATTRIBUTION` is rendered wherever `TILE_URL` is used and the map component
 * has no path that draws one without the other.
 *
 * THE PUBLIC TILE SERVER HAS A USAGE POLICY and this product is well inside it today —
 * a map that opens only when somebody taps "adjust on map", on a booking form, is a
 * handful of tiles per booking. If that stops being true, this file is where a paid
 * provider or a cache goes, and nothing else changes.
 */
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Rendered with every map. Required by the ODbL, not a courtesy. */
export const TILE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** Highest zoom the public tiles serve. Past this the map goes grey. */
export const TILE_MAX_ZOOM = 19;

/**
 * Where the map opens when there is no pin yet: the middle of the Kathmandu Valley.
 *
 * A STARTING VIEW IS NOT A GUESS AT THE ADDRESS. It is never written anywhere and
 * never read as a location — the pin stays null until somebody places one. A map that
 * opened on the whole world would make everybody pan and zoom before they could do
 * anything, and every customer this product has is in the Valley.
 */
export const VALLEY_VIEW = { lat: 27.7089, lng: 85.3206, zoom: 12 };
