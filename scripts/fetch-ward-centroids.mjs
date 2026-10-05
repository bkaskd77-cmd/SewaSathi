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
 * Two endpoints, tried in order. The main instance is a volunteer service that refuses or
 * times out under load; a mirror costs nothing and separates "this does not work" from
 * "that instance did not want it".
 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * Overpass's usage policy asks callers to identify themselves, and Node sends no
 * User-Agent by default. Its absence is what produced this script's first failure: a bare
 * `406` with no explanation, on every request.
 */
const AGENT =
  "SajiloKaam ward-centroid fetcher (one-off, https://github.com/bkaskd77-cmd/SewaSathi)";

const AREAS = JSON.parse(readFileSync("lib/data/seed/areas.json", "utf8"));
const OUT = "lib/data/seed/area-centroids.json";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Overpass query, with everything that can go wrong told apart.
 *
 * `remark` IS THE ONE THAT MATTERS AND THE ONE THAT WAS MISSED. Overpass answers a
 * server-side timeout or an out-of-memory with **HTTP 200** and a `remark` field, not with
 * an error status — so a query that was too expensive comes back as a perfectly successful
 * response holding no elements. The first version of this script read that as "the ward is
 * not in OpenStreetMap" and said so, which sent a person looking at ward tagging for a
 * problem that was server load. A 200 is not an answer; a 200 with no remark is.
 */
async function run(endpoint, data, method = "POST") {
  const url =
    method === "GET"
      ? `${endpoint}?data=${encodeURIComponent(data)}`
      : endpoint;

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
  }).catch((error) => ({
    ok: false,
    status: 0,
    text: async () => error.message,
  }));

  const where = `${method} ${new URL(endpoint).host}`;

  if (!response.ok) {
    const text = (await response.text().catch(() => ""))
      .trim()
      .replace(/\s+/g, " ");
    /* Overpass's error pages are full HTML. The first line is the useful part. */
    return {
      ok: false,
      busy: [429, 503, 504, 0].includes(response.status),
      why: `${where} → ${response.status}: ${text.slice(0, 120)}`,
    };
  }

  const json = await response.json().catch(() => null);
  if (!json)
    return { ok: false, busy: false, why: `${where} → unreadable JSON` };

  if (json.remark) {
    return {
      ok: false,
      busy: true,
      why: `${where} → 200 but the server gave up: ${json.remark}`,
    };
  }

  return { ok: true, elements: json.elements ?? [] };
}

/**
 * Every endpoint and method, waiting only when the server said it was busy.
 *
 * A 429, 503, 504 or a `remark` means the instance is loaded and the same request may
 * work shortly. Anything else means the request is wrong, and retrying a wrong request is
 * only slower. Every attempt is kept so a final failure can list what was tried — a bare
 * status code is not a reason, which this script has now demonstrated twice.
 */
async function overpass(data, label) {
  const tried = [];

  for (const endpoint of ENDPOINTS) {
    for (const method of ["POST", "GET"]) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await run(endpoint, data, method);
        if (result.ok) return result.elements;
        tried.push(result.why);
        if (!result.busy) break;
        await sleep(attempt * 5000);
      }
    }
  }

  throw new Error(
    `Overpass would not answer for ${label}. Everything tried:\n    ${tried.join("\n    ")}`,
  );
}

/**
 * The valley, as a bounding box.
 *
 * Every area this product serves is in it — `areas.json` is Kathmandu, Lalitpur and
 * Bhaktapur and nothing else — and the box is what keeps the city lookup cheap: a regex
 * over every administrative boundary on the planet is the kind of query Overpass answers
 * with a timeout, which this script has already mistaken for an answer once. If the
 * product ever serves a city outside the valley, this is the line that has to move, and it
 * will fail loudly rather than quietly pick the wrong city.
 */
const VALLEY = "27.55,85.15,27.85,85.60";

/**
 * The city's area id, looked up ONCE per city rather than rebuilt per ward.
 *
 * `area["name"=…]` makes Overpass construct an area from scratch every time it is used,
 * and this script ran fifteen of them across three cities — fifteen area builds where
 * three would do. An area id is the relation id plus 3600000000, which is Overpass's own
 * convention.
 *
 * THE NAME IS A SUBSTRING, NOT AN EXACT MATCH, AND THAT WAS THE WHOLE BUG. OpenStreetMap
 * does not hold a city called "Kathmandu": the relation carries the Nepali on `name` and
 * **"Kathmandu Metropolitan City"** on `name:en`, so an anchored `^Kathmandu$` matched
 * neither and the script reported the city as absent. Lalitpur and Bhaktapur carry
 * "Metropolitan City" and "Municipality" the same way. Matching a substring on either tag,
 * case-insensitively, is what a human reading the map would do.
 *
 * SEVERAL MATCHES IS A REFUSAL, NOT A FIRST-ONE-WINS. Relaxing an exact match is exactly
 * how a script quietly starts measuring the wrong thing — "Kathmandu District" is a real
 * administrative area at a different level, and a centroid taken from it would be wrong by
 * kilometres with nothing on screen to say so. The constraint on `admin_level=8` already
 * excludes the district; this is the backstop for whatever it does not.
 */
async function cityAreaId(city) {
  const found = await overpass(
    `[out:json][timeout:90];
relation["admin_level"="8"][~"^name(:en)?$"~"${city}",i](${VALLEY});
out ids tags;`,
    `the city of ${city}`,
  );

  if (found.length === 0) {
    /* The server answered, so this is the name or the level. Widen once and print. */
    const near = await overpass(
      `[out:json][timeout:90];
relation["boundary"="administrative"][~"^name(:en)?$"~"${city}",i](${VALLEY});
out ids tags;`,
      `anything named like ${city}`,
    ).catch(() => []);

    const lines = near
      .slice(0, 12)
      .map(
        (r) =>
          `      level=${r.tags?.admin_level ?? "—"}  name=${r.tags?.name ?? "—"}` +
          `  name:en=${r.tags?.["name:en"] ?? "—"}`,
      );

    throw new Error(
      `No admin_level=8 relation matching "${city}" in the Kathmandu valley.\n` +
        (lines.length
          ? `  What IS named like it:\n${lines.join("\n")}\n` +
            `  Pick the municipality from that list and put its wording in areas.json.`
          : `  And nothing at any level is named like it either, which points at the\n` +
            `  bounding box rather than the name.`),
    );
  }

  if (found.length > 1) {
    const lines = found.map(
      (r) =>
        `      relation ${r.id}  level=${r.tags?.admin_level}  name=${r.tags?.name ?? "—"}` +
        `  name:en=${r.tags?.["name:en"] ?? "—"}`,
    );
    throw new Error(
      `"${city}" matches ${found.length} municipalities, so this script will not guess:\n` +
        `${lines.join("\n")}\n` +
        `  Make the name in areas.json specific enough to pick one.`,
    );
  }

  const city0 = found[0];
  console.log(
    `  ${city}: ${city0.tags?.name ?? "?"}` +
      `${city0.tags?.["name:en"] ? ` (${city0.tags["name:en"]})` : ""}, relation ${city0.id}`,
  );
  return 3600000000 + city0.id;
}

/** Every administrative boundary inside a city, printed so a miss explains itself. */
async function describeWards(areaId, city) {
  console.log("");
  console.log(`      What OpenStreetMap holds inside ${city}:`);
  try {
    const rows = await overpass(
      `[out:json][timeout:90];
relation(area:${areaId})["boundary"="administrative"];
out tags;`,
      `the boundaries inside ${city}`,
    );

    if (rows.length === 0) {
      console.log(
        `      none at all — its wards are not mapped in OpenStreetMap yet.`,
      );
      return;
    }

    const levels = [
      ...new Set(rows.map((r) => r.tags?.admin_level ?? "—")),
    ].sort();
    console.log(
      `      ${rows.length} boundaries, at admin_level ${levels.join(", ")}:`,
    );
    for (const row of rows.slice(0, 12)) {
      console.log(
        `        level=${row.tags?.admin_level ?? "—"}` +
          `  ref=${row.tags?.ref ?? row.tags?.["ref:ward"] ?? "—"}` +
          `  name=${row.tags?.name ?? row.tags?.["name:en"] ?? "—"}`,
      );
    }
    if (rows.length > 12)
      console.log(`        … and ${rows.length - 12} more.`);
  } catch (error) {
    console.log(`      could not list them — ${error.message}`);
  }
  console.log("");
}

/**
 * Nepal's municipal wards are `admin_level=10` relations tagged with `ref` for the ward
 * number. Matching inside the city's own area is what makes this reproducible: all three
 * cities have a ward 4.
 */
async function centreOf(areaId, city, ward) {
  const found = await overpass(
    `[out:json][timeout:90];
relation(area:${areaId})["admin_level"="10"]["ref"="${ward}"];
out center;`,
    `${city} ward ${ward}`,
  );

  // `out center` puts the bounding-box centre on the element, which for a ward polygon is
  // within a few hundred metres of its centroid — comfortably inside the "approximate,
  // ward-level" precision this file claims.
  const element = found.find((e) => e.center);
  if (element) return { lat: element.center.lat, lng: element.center.lon };

  await describeWards(areaId, city);
  throw new Error(
    `No admin_level=10 relation with ref=${ward} inside ${city}. ` +
      `What OpenStreetMap does hold is printed above.`,
  );
}

async function main() {
  const wards = {};
  const areaIds = new Map();

  console.log("Resolving the cities:");
  for (const city of [...new Set(AREAS.map((a) => a.city))]) {
    areaIds.set(city, await cityAreaId(city));
    await sleep(1200);
  }

  console.log("\nFetching the wards:");
  for (const area of AREAS) {
    // One at a time, with a pause: Overpass asks for it, and a parallel burst from one IP
    // is how a volunteer service ends up rate-limiting this repository.
    process.stdout.write(`  ${area.key} (${area.name}) … `);
    const centre = await centreOf(
      areaIds.get(area.city),
      area.city,
      area.wardNumber,
    );
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

  return wards;
}

/*
 * `process.exitCode` RATHER THAN `process.exit()`. Node 24 on Windows follows a hard exit
 * with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, which reads as a second
 * and worse problem and is not one — it is the process being torn down while a socket is
 * still closing. Setting the code and letting Node finish normally avoids it, and whoever
 * runs this is not reading libuv internals.
 */
let wards = null;
try {
  wards = await main();
} catch (error) {
  console.error(`\n${error.message}\n`);
  console.error("Nothing was written — the existing file is untouched.\n");
  process.exitCode = 1;
}

if (wards) {
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
}
