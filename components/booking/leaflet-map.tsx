"use client";

import * as React from "react";
import L from "leaflet";

import "leaflet/dist/leaflet.css";

import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL, VALLEY_VIEW } from "@/lib/geo/tiles";
import type { Point } from "@/lib/geo";

/**
 * The map itself, in its own module so its weight is its own chunk.
 *
 * WHY A SEPARATE FILE RATHER THAN A FUNCTION IN `address-pin.tsx`. Leaflet's
 * stylesheet is a static `import` — that is the only way to get it through the CSS
 * pipeline rather than hand-injected from a hardcoded path — and a static import in the
 * pin component would put 15 kB of map CSS into `/book`'s stylesheet whether anybody
 * opened the map or not. Reached only through `await import("./leaflet-map")`, both the
 * JavaScript and the CSS land in an async chunk that a customer who never taps "adjust
 * on map" never fetches. That is the whole bundle argument, and it is the same shape as
 * `use-booking-channel.ts` importing supabase-js inside its effect.
 *
 * IT OWNS THE LEAFLET INSTANCE AND NOTHING ELSE. No translations, no state beyond the
 * map, no opinion about whether a pin is required — the parent holds all of that. This
 * file exists to be heavy somewhere a customer can decline.
 */
export function LeafletMap({
  at,
  onPick,
  className,
}: {
  /** Where to open. Null means the Valley view, which is never read as a location. */
  at: Point | null;
  onPick: (point: Point) => void;
  className?: string;
}) {
  const host = React.useRef<HTMLDivElement | null>(null);

  /*
   * Both held in refs so the effect runs once. A map rebuilt on every parent render
   * would tear itself down on each keystroke in the tole field and lose the pin
   * somebody had just placed.
   */
  const onPickRef = React.useRef(onPick);
  onPickRef.current = onPick;
  const initial = React.useRef(at);

  React.useEffect(() => {
    if (!host.current) return;

    const start = initial.current;
    const map = L.map(host.current, {
      center: start ? [start.lat, start.lng] : [VALLEY_VIEW.lat, VALLEY_VIEW.lng],
      // 17 is street level: close enough to pick a gate, which is the point of the map.
      zoom: start ? 17 : VALLEY_VIEW.zoom,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: TILE_MAX_ZOOM,
    }).addTo(map);

    /*
     * A VECTOR CIRCLE, NOT LEAFLET'S DEFAULT MARKER. The default icon is a PNG resolved
     * relative to the stylesheet, which a bundler rewrites and breaks unless the icon
     * paths are patched by hand — a well-known footgun that shows up as a missing image
     * on the one screen this feature exists for. A circle needs no asset.
     */
    let pin: L.CircleMarker | null = null;
    const place = (point: Point) => {
      if (pin) pin.setLatLng([point.lat, point.lng]);
      else {
        pin = L.circleMarker([point.lat, point.lng], {
          radius: 9,
          weight: 3,
          // Deep Emerald. Leaflet draws SVG and takes a colour string, so it cannot
          // read a CSS custom property — this is the one place a brand hex is passed
          // as a value rather than a token, and it is a canvas rather than a stylesheet.
          color: "#0F6B5B",
          fillColor: "#0F6B5B",
          fillOpacity: 0.35,
        }).addTo(map);
      }
      onPickRef.current(point);
    };

    if (start) place(start);
    map.on("click", (event: L.LeafletMouseEvent) => {
      place({ lat: event.latlng.lat, lng: event.latlng.lng });
    });

    /* Braced, so the cleanup returns nothing: `map.remove()` hands back the map and
       React's `EffectCallback` rejects a cleanup that returns a value. */
    return () => {
      map.remove();
    };
  }, []);

  return <div ref={host} className={className} />;
}
