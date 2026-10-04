"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Crosshair, Loader2, MapPin, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isPoint, type Point } from "@/lib/geo";

/* TYPE-ONLY, so it is erased at build and adds nothing to this chunk — the module
   itself is still reached only through the dynamic import below. */
import type { LeafletMap } from "./leaflet-map";

/**
 * An optional pin for the address, and nothing about the booking depends on it.
 *
 * WHAT IT IS FOR. `proximity` carries 0.18 of the relevance blend and was ward
 * membership — three values, so somebody two streets away across a ward line scored
 * the same as somebody across the Valley. A pin makes that term a real distance. It is
 * a ranking signal, not an address: ward, tole and landmark remain what a professional
 * navigates by, because Nepal addressing is landmark-based and no coordinate replaces
 * "the red gate past the school".
 *
 * TWO CONTROLS, AND THE CHEAP ONE IS THE DEFAULT. "Use my location" is the browser
 * geolocation API: no map, no third-party request, nothing added to the page's
 * bundle. "Adjust on map" is the precise version and it `await import()`s Leaflet and
 * its stylesheet only when tapped — so a customer who never taps it pays nothing, and
 * `/book`'s initial bundle is unchanged. That ordering is the point: the common case
 * is somebody standing at the address, for whom one tap is both faster and more
 * accurate than panning a map.
 *
 * TILES ARE THIRD-PARTY AND THAT IS WHY THE MAP IS OPT-IN. Every tile request carries
 * the viewport in its URL, so whoever serves them learns roughly where this customer
 * lives. `lib/geo/tiles.ts` is the one file naming the host, the attribution renders
 * with the map, and nothing is fetched until somebody asks for the map.
 *
 * REFUSAL IS A FIRST-CLASS OUTCOME. A declined permission, a timeout, a browser with
 * no geolocation, a desktop with a wildly wrong IP-derived guess — every one of them
 * leaves the pin null, says so plainly, and the booking proceeds. Nothing here can
 * block the step, which is why there is no required state and no validation error.
 */
export function AddressPin({
  at,
  onChange,
}: {
  at: Point | null;
  onChange: (point: Point | null) => void;
}) {
  const t = useTranslations("booking.flow.address");

  const [asking, setAsking] = React.useState(false);
  const [refused, setRefused] = React.useState(false);
  const [mapOpen, setMapOpen] = React.useState(false);

  async function requestLocation() {
    if (asking) return;
    setAsking(true);
    setRefused(false);

    const point = await browserPosition();
    setAsking(false);
    /*
     * A REFUSAL AND A NONSENSE READING ARE THE SAME OUTCOME HERE. `isPoint` rejects a
     * zeroed sensor at (0, 0) and an out-of-range latitude, so a browser that answers
     * with junk is treated as a browser that declined — the alternative is storing a
     * coordinate in the Gulf of Guinea and ranking against it.
     */
    if (isPoint(point)) onChange(point);
    else setRefused(true);
  }

  return (
    <div>
      <p className="text-body-sm font-semibold">{t("pinTitle")}</p>
      <p className="mt-1 text-caption text-muted-foreground">{t("pinHelp")}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="btn-tactile h-12"
          onClick={() => void requestLocation()}
          disabled={asking}
        >
          {asking ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Crosshair aria-hidden="true" />
          )}
          {at ? t("pinAgain") : t("pinUseLocation")}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="btn-tactile h-12"
          onClick={() => setMapOpen((open) => !open)}
        >
          <MapPin aria-hidden="true" />
          {mapOpen ? t("pinHideMap") : t("pinAdjustOnMap")}
        </Button>

        {/* Removing it is one tap, and it has to be: somebody who pinned the wrong
            place must be able to leave us with nothing rather than with a wrong
            answer, which is worse than no answer for exactly the rule-6 reason. */}
        {at ? (
          <Button
            type="button"
            variant="ghost"
            className="btn-tactile h-12"
            onClick={() => {
              onChange(null);
              setRefused(false);
            }}
          >
            <X aria-hidden="true" />
            {t("pinClear")}
          </Button>
        ) : null}
      </div>

      {/* Said plainly and never as an error — the booking is unaffected. */}
      {refused ? (
        <p className="mt-2 text-caption text-muted-foreground" role="status">
          {t("pinRefused")}
        </p>
      ) : null}

      {at && !mapOpen ? (
        <p className="mt-2 text-caption text-muted-foreground">{t("pinSet")}</p>
      ) : null}

      {mapOpen ? <LazyMap at={at} onChange={onChange} /> : null}
    </div>
  );
}

/** Ask once, briefly, and treat every failure the same. */
function browserPosition(): Promise<Point | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      () => resolve(null),
      /*
       * HIGH ACCURACY HERE, UNLIKE THE ARRIVAL PANEL. That one rounds to a kilometre
       * and wants to spare a cheap phone's battery; this is somebody's front door and
       * the whole value is in the hundreds of metres. 12 seconds because a cold GPS fix
       * on a cheap handset genuinely takes that long, and a timeout is a refusal.
       */
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  });
}

/**
 * The map, fetched on tap and not before.
 *
 * A DYNAMIC IMPORT INSIDE AN EFFECT, which is the shape `use-booking-channel.ts`
 * settled on for supabase-js and for the same arithmetic: this is tens of kilobytes of
 * JavaScript plus a stylesheet, on a form that works perfectly without it, served to
 * customers on connections that may never finish fetching it. The page is correct
 * before it arrives and correct if it never does.
 *
 * THE WEIGHT LIVES IN `./leaflet-map`, which statically imports Leaflet and its CSS.
 * Reached only from here, both land in an async chunk — so `/book`'s initial bundle and
 * stylesheet are unchanged for everybody who does not tap.
 */
function LazyMap({
  at,
  onChange,
}: {
  at: Point | null;
  onChange: (point: Point | null) => void;
}) {
  const t = useTranslations("booking.flow.address");
  const [Map, setMap] = React.useState<null | typeof LeafletMap>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void import("./leaflet-map")
      .then((module) => {
        if (!cancelled) setMap(() => module.LeafletMap);
      })
      .catch(() => {
        // A dead connection, a blocked asset, a browser refusing the module. The
        // location button still works and the booking is unaffected.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p className="mt-3 text-caption text-muted-foreground">{t("pinMapFailed")}</p>
    );
  }

  /* A skeleton rather than a blank gap or a spinner — the standing motion rule. */
  if (!Map) {
    return (
      <div className="mt-3 h-64 w-full animate-pulse rounded-xl border border-border bg-muted/40" />
    );
  }

  return (
    <div className="mt-3">
      <Map
        at={at}
        onPick={onChange}
        className="h-64 w-full overflow-hidden rounded-xl border border-border bg-muted/40"
      />
      <p className="mt-1 text-caption text-muted-foreground">{t("pinMapHelp")}</p>
    </div>
  );
}
