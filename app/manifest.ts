import type { MetadataRoute } from "next";

import { site } from "@/lib/config/site";

/**
 * The web app manifest — what a phone reads when somebody installs this.
 *
 * ONE MANIFEST, NOT ONE PER LANGUAGE, AND `start_url` IS `/`. A manifest is
 * fetched once at install and frozen into the launcher, so a Nepali manifest
 * would have to be chosen before we know who is installing. `/` is the right
 * answer because `localeDetection` is on: the installed app opens `/`, next-intl
 * reads the phone's own language and the `sajilokaam-locale` cookie, and a
 * Nepali reader lands on `/ne` exactly as they do from a browser. Hard-coding
 * `/ne` for a Nepali installer would do the opposite — it would pin the app to
 * a language and ignore a later change of mind.
 *
 * `name` AND `short_name` STAY IN LATIN SCRIPT, which is the one place this
 * product does not localise a brand string. The launcher label sits under a
 * 192px icon with room for about twelve characters, and `सजिलो काम` renders at
 * that size on a cheap Android launcher as something between illegible and
 * clipped. The wordmark is Latin everywhere else in the product for the same
 * reason; this is consistency, not an English default.
 *
 * `display: "standalone"` RATHER THAN `"fullscreen"`. The status bar carries
 * the clock, the battery and — the one that matters here — the signal
 * indicator. This is an app whose users are professionals standing in streets
 * and customers waiting for one; hiding whether the phone has a bar of signal
 * to save 24 pixels would be a poor trade.
 *
 * NO `screenshots` AND NO `shortcuts` YET, deliberately. Both are real Play
 * Store surfaces and both would have to be invented today: there are no
 * screenshots of a launched product and no evidence about which two tasks
 * deserve a long-press shortcut. `docs/TWA.md` records them as the step before
 * the store listing, where the decision has something to read.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: site.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    /*
     * Deep Emerald and Ivory, from styles/globals.css. `background_color` is
     * the splash screen behind the icon while the app starts, so it is the
     * light surface rather than the brand field: a dark splash followed by an
     * ivory page is a flash on every cold start.
     */
    theme_color: "#0F6B5B",
    background_color: "#FFF8E7",
    lang: "en",
    dir: "ltr",
    categories: ["business", "lifestyle", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /*
       * SEPARATE FILE, NOT THE SAME ONE RELABELLED. `purpose: "maskable"` tells
       * Android it may crop to any launcher shape, and the guaranteed-visible
       * region is the middle 80%. The `any` icons fill their canvas, so
       * declaring one maskable would have the launcher cut the gold dot off.
       */
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
