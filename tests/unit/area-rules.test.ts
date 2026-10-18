import { describe, expect, it } from "vitest";

import {
  AREA_KEY_SHAPE,
  AREA_SEED,
  areaShortLabel,
  areasByCity,
  findAreaIn,
  type Area,
} from "@/lib/config/areas";

/**
 * The pure half of service areas — the shape, and the helpers that read a list.
 *
 * THE REFACTOR THESE PIN IS THE WHOLE RISK OF MAKING AREAS A TABLE. The old
 * `findArea(key)` and `areaLabel(key)` closed over the seed file, so fifteen
 * callers asked a constant while believing they were asking the product. Once a
 * person can RETIRE a ward, that is `/providers/join` going on offering
 * somewhere we withdrew, with nothing failing anywhere. Every helper takes the
 * list the caller read, and the cases below are written so that a helper which
 * quietly reached for `AREA_SEED` again would go red rather than pass on the
 * strength of the seed happening to contain the key.
 */

const LALITPUR: Area = {
  key: "lalitpur-4",
  city: "Lalitpur",
  cityNe: "ललितपुर",
  wardNumber: 4,
  name: "Jhamsikhel",
  nameNe: "झम्सिखेल",
};

const KATHMANDU: Area = {
  key: "kathmandu-4",
  city: "Kathmandu",
  cityNe: "काठमाडौँ",
  wardNumber: 4,
  name: "Baluwatar",
  nameNe: "बालुवाटार",
};

describe("a helper answers from the list it was handed, never from the seed", () => {
  it("does not find a real seeded ward that the given list leaves out", () => {
    /*
     * THE CASE THAT CATCHES THE REGRESSION. `kathmandu-4` is genuinely in
     * `AREA_SEED`, so a helper reading the file would return it here and look
     * correct. Handed a list without it — which is what `bookableAreas()`
     * returns the day somebody retires it — the honest answer is null.
     */
    expect(AREA_SEED.some((area) => area.key === "kathmandu-4")).toBe(true);
    expect(findAreaIn([LALITPUR], "kathmandu-4")).toBeNull();
  });

  it("finds one that is there, and treats a missing key as no answer", () => {
    expect(findAreaIn([LALITPUR, KATHMANDU], "lalitpur-4")).toBe(LALITPUR);
    expect(findAreaIn([LALITPUR], null)).toBeNull();
    expect(findAreaIn([LALITPUR], undefined)).toBeNull();
    expect(findAreaIn([LALITPUR], "")).toBeNull();
  });

  it("labels an unresolvable ward with the key the row actually holds", () => {
    /* Rule 6's shape for a label: a card that cannot resolve a ward says
       `lalitpur-9` rather than nothing, because the string is at least the
       thing stored on the row. A retired ward resolves normally — it is still
       in the LABEL list — so this is only reached for a key nothing knows. */
    expect(areaShortLabel([LALITPUR], "lalitpur-9")).toBe("lalitpur-9");
    expect(areaShortLabel([], "kathmandu-4")).toBe("kathmandu-4");
  });

  it("writes the short label in the reader's language", () => {
    expect(areaShortLabel([LALITPUR], "lalitpur-4")).toBe(
      "Jhamsikhel, Lalitpur",
    );
    expect(areaShortLabel([LALITPUR], "lalitpur-4", "ne")).toBe(
      "झम्सिखेल, ललितपुर",
    );
  });
});

describe("the picker groups by city, in the order the list arrived", () => {
  it("keeps one group per city and every ward inside it", () => {
    const groups = areasByCity([KATHMANDU, LALITPUR, { ...KATHMANDU, key: "kathmandu-7" }]);
    expect(groups.map((g) => g.city)).toEqual(["Kathmandu", "Lalitpur"]);
    expect(groups[0].areas.map((a) => a.key)).toEqual([
      "kathmandu-4",
      "kathmandu-7",
    ]);
    expect(groups[1].areas.map((a) => a.key)).toEqual(["lalitpur-4"]);
  });

  it("names the group in the reader's language and groups on the English city", () => {
    /* The grouping key is `area.city` and only the LABEL is localised: two
       spellings of one city must not become two <optgroup>s on a Nepali page. */
    const groups = areasByCity([KATHMANDU, { ...KATHMANDU, key: "kathmandu-7" }], "ne");
    expect(groups).toHaveLength(1);
    expect(groups[0].city).toBe("काठमाडौँ");
  });

  it("answers an empty list with no groups", () => {
    expect(areasByCity([])).toEqual([]);
  });
});

describe("the key shape", () => {
  it("accepts a city slug and a ward number, hyphenated names included", () => {
    for (const key of ["kathmandu-4", "kathmandu-10", "bhaktapur-9", "new-baneshwor-31"]) {
      expect(AREA_KEY_SHAPE.test(key), key).toBe(true);
    }
  });

  it("refuses the spellings that would match nothing downstream", () => {
    /* A key is `addresses.area_key`, every entry of `providers.service_areas`
       and every key in `seed/area-centroids.json`, with no foreign key behind
       any of them — so a near-miss renders perfectly and matches nobody. */
    for (const key of [
      "Kathmandu 4",
      "KATHMANDU-4",
      "ktm_4",
      "kathmandu",
      "kathmandu-",
      "-4",
      "kathmandu-4a",
      "kathmandu 4",
      " kathmandu-4",
    ]) {
      expect(AREA_KEY_SHAPE.test(key), key).toBe(false);
    }
  });

  it("is the shape every authored ward is already in", () => {
    for (const area of AREA_SEED) {
      expect(AREA_KEY_SHAPE.test(area.key), area.key).toBe(true);
      /* And the key agrees with the ward number beside it. These are two
         fields saying one thing, and the seed is what the table was built
         from — a mismatch here is a centroid lookup finding the wrong ward. */
      expect(area.key.endsWith(`-${area.wardNumber}`), area.key).toBe(true);
    }
  });
});

describe("every authored ward is complete in both languages", () => {
  it("has all six fields, with Devanagari where Devanagari belongs", () => {
    /*
     * THE OTHER HALF OF THE INVENTED-NAMES INCIDENT. The db suite compares the
     * table against this file; nothing checked the file itself. A blank
     * `nameNe` is the one gap that is invisible at a glance and renders Latin
     * script into a Nepali page — which reads as a place name somebody chose
     * not to translate rather than as a missing field.
     */
    expect(AREA_SEED.length).toBeGreaterThan(0);
    const devanagari = /[ऀ-ॿ]/;
    for (const area of AREA_SEED) {
      expect(area.city.trim().length, `${area.key}.city`).toBeGreaterThan(0);
      expect(area.name.trim().length, `${area.key}.name`).toBeGreaterThan(0);
      expect(Number.isInteger(area.wardNumber), `${area.key}.wardNumber`).toBe(
        true,
      );
      expect(area.wardNumber, `${area.key}.wardNumber`).toBeGreaterThan(0);
      expect(devanagari.test(area.cityNe), `${area.key}.cityNe`).toBe(true);
      expect(devanagari.test(area.nameNe), `${area.key}.nameNe`).toBe(true);
    }
  });

  it("has no duplicate key", () => {
    const keys = AREA_SEED.map((area) => area.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
