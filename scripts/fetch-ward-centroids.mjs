#!/usr/bin/env node
/**
 * Ward centroids, from OpenStreetMap, written with their provenance.
 *
 * WHY THIS IS A SCRIPT AND NOT A HARDCODED TABLE. `nearestServedKm` is a ranking
 * input, so the coordinates behind it decide list position — and a list position
 * resting on fifteen numbers somebody estimated from memory is a measurement that
 * isn't one. These come from ward boundaries in OpenStreetMap, and the file records
 * where and when so a reader five phases from now can tell a fetched figure from a
 * guessed one.
 *
 * WHY IT IS NOT RUN IN CI OR THE SANDBOX. The agent sandbox cannot reach
 * `overpass-api.de` — the egress proxy answers 403 at CONNECT — and Overpass is a
 * volunteer service with a usage policy that a build running on every push would
 * abuse. Wards change rarely; this is run by a person when the ward list changes, and
 * `area-centroids.json` is committed like any other seed.
 *
 * THE CENTROID IS THE BOUNDARY'S, NOT A PLACE NAME'S. Overpass gives the ward
 * relation's own geometry, so the point is the middle of the administrative area
 * rather than wherever a search engine thinks "Baluwatar" is. That distinction is the
 * reason for the Overpass query rather than a geocoder lookup: a geocoder returns the
 * centre of a named locality, which may sit well outside the ward that contains it.
 *
 * IT FAILS LOUDLY AND WRITES NOTHING ON A PARTIAL RESULT. A file with nine of fifteen
 * wards would silently rank six of them as unmeasured for ever, and nobody would know
 * which six without reading the JSON — so a ward that cannot be found is an error and
 * the previous file stays untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Two endpoints, tried in order.
 *
 * The main instance is a volunteer service and refuses requests for several reasons that
 * all arrive as a bare status code. A mirror costs nothing to try and turns "this does not
 * work" into "this instance did not want it".
 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * Overpass's usage policy asks callers to identify themselves, and some instances answer
 * a request with no User-Agent with a refusal rather than a reason. Node sends none by
 * default, which is the most likely cause of the 406 this script first produced.
 */
const AGENT = "SajiloKaam ward-centroid fetcher (one-off, https://github.com/bkaskd77-cmd/SewaSathi)";

const AREAS = JSON.parse(readFileSync("lib/data/seed/areas.json", "utf8"));
const OUT = "lib/data/seed/area-centroids.json";

/**
 * Nepal's municipal wards are `admin_level=10` relations inside a municipality at
 * `admin_level=8`, tagged with `ref` for the ward number. Matching the municipality by
 * name and the ward by `ref` is what makes this reproducible — a name search for the
 * ward alone collides across the three cities, all of which have a ward 4.
 *
 * THE NAME IS MATCHED ON `name` OR `name:en`, because Nepal's OSM data is substantially
 * in Devanagari: Kathmandu Metropolitan City may carry `name=काठमाडौं महानगरपालिका` with
 * the English only on `name:en`. Matching `name` alone would find no area and report it as
 * a missing ward, which is a confusing way to say "we looked in the wrong language".
 */
function query(city, ward) {
  return `[out:json][timeout:60];
area["admin_level"="8"][~"^name(:en)?$"~"^${city}$"]->.city;
relation(area.city)["admin_level"="10"]["ref"="${ward}"];
out center;`;
}

/**
 * One request, reporting what the server actually said.
 *
 * THE BODY IS PRINTED ON A REFUSAL, which the first version did not do — it threw
 * `Overpass answered 406` and nothing else, and a bare status code is not a reason.
 * Overpass returns an explanation in the body of nearly every error it gives, so throwing
 * the number away discarded the one thing that would have fixed this on the first run.
 */
async function ask(endpoint, city, ward, method) {
  const data = query(city, ward);
  const url = method === "GET" ? `${endpoint}?data=${encodeURIComponent(data)}` : endpoint;

  const response = await fetch(url, {
    method,
    headers: {
      "User-Agent": AGENT,
      Accept: "application/json",
      ...(method === "POST"
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    ...(method === "POST" ? { body: new URLSearchParams({ data }) } : {}),
  });

  if (response.ok) return { ok: true, body: await response.json() };

  const text = (await response.text().catch(() => "")).trim().slice(0, 300);
  return {
    ok: false,
    why: `${method} ${new URL(endpoint).host} → ${response.status}${text ? `: ${text}` : ""}`,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Every endpoint and both methods, then give up with everything that was tried.
 *
 * A 429 or a 504 is the instance being busy rather than the request being wrong, so those
 * wait and retry; everything else moves straight on to the next combination. The failure
 * message lists every attempt, because "it did not work" without the attempts is what sent
 * this back to a person once already.
 */
async function centreOf(city, ward) {
  const tried = [];

  for (const endpoint of ENDPOINTS) {
    for (const method of ["POST", "GET"]) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await ask(endpoint, city, ward, method);
        if (result.ok) {
          // `out center` puts the bounding-box centre on the element, which for a ward
          // polygon is within a few hundred metres of its centroid — comfortably inside
          // the "approximate, ward-level" precision this file claims.
          const element = (result.body.elements ?? []).find((e) => e.center);
          if (element) return { lat: element.center.lat, lng: element.center.lon };

          throw new Error(
            `No admin_level=10 relation with ref=${ward} inside ${city}.\n` +
              `  The server answered, so this is the QUERY rather than the connection:\n` +
              `  check the ward exists in OpenStreetMap and that areas.json spells the\n` +
              `  city as OSM does on name or name:en.`,
          );
        }

        tried.push(result.why);
        const busy = /→ (429|504|503)/.test(result.why);
        if (!busy) break;
        await sleep(attempt * 4000);
      }
    }
  }

  throw new Error(
    `Could not fetch ${city} ward ${ward}. Everything tried:\n    ${tried.join("\n    ")}`,
  );
}

const wards = {};
for (const area of AREAS) {
  // One at a time, with a pause: Overpass asks for it and a parallel burst from one IP
  // is how a volunteer service ends up rate-limiting this repository.
  process.stdout.write(`  ${area.key} (${area.name}) … `);
  const centre = await centreOf(area.city, area.wardNumber);
  wards[area.key] = {
    lat: Number(centre.lat.toFixed(5)),
    lng: Number(centre.lng.toFixed(5)),
  };
  console.log(`${wards[area.key].lat}, ${wards[area.key].lng}`);
  await sleep(1200);
}

if (Object.keys(wards).length !== AREAS.length) {
  throw new Error("Not every ward resolved — nothing written.");
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      source:
        "OpenStreetMap, admin_level=10 ward relations via the Overpass API. © OpenStreetMap contributors, ODbL.",
      fetchedAt: new Date().toISOString(),
      precision: "approximate, ward-level",
      note: "Generated by scripts/fetch-ward-centroids.mjs — do not edit by hand. Each point is the bounding-box centre of the ward's own boundary relation, so it is the middle of the administrative area rather than of a named locality inside it. Good to within a kilometre or two, which is what nearestServedKm assumes.",
      wards,
    },
    null,
    2,
  )}\n`,
);

console.log(`\nWrote ${Object.keys(wards).length} ward centres to ${OUT}.`);
