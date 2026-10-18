import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Which of the two category reads each screen asks, and why it matters.
 *
 * THE WIRING IS THE TEST, which is the lesson #18 cost. A function written,
 * commented and tested with nothing calling it is this repo's most-repeated
 * sin — and `labelCategory` is exactly that shape: it exists so a withdrawn
 * trade can still be named, and if the screens go on calling `getCategory` it
 * changes nothing at all while reading as done from the data layer.
 *
 * TWO DIRECTIONS, AND THE SECOND IS THE EASY MISTAKE. A LABEL read on a
 * catalogue screen is worse than the bug being fixed: `/services/[slug]` would
 * render a page for a trade we have withdrawn, and `createBooking` would take a
 * booking in it — so each file is pinned to the read it should be making rather
 * than just to "not the wrong one".
 */

/** The source with comments stripped, so naming a function in prose to warn
 *  about it is documentation rather than a call. `provider-money-one-source`
 *  does the same, for the same reason. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * A booking already names its trade, so the words have to resolve whatever we
 * sell today. Both of these fall back to printing the bare slug when the
 * lookup misses — which is how withdrawing a trade would have put
 * `water-tank-cleaning` on a customer's own booking page.
 */
const LABELS = [
  "app/[locale]/(app)/bookings/[id]/page.tsx",
  "app/[locale]/(work)/provider/jobs/page.tsx",
  "app/[locale]/(app)/bookings/[id]/actions.ts",
];

/**
 * These decide whether a trade may be SOLD. A withdrawn one must 404 on its
 * catalogue page and must be refused at the booking, so the label read here
 * would be the inverse bug.
 */
const CATALOGUE = [
  "app/[locale]/(app)/services/[slug]/page.tsx",
  "app/[locale]/(app)/services/[slug]/[providerId]/page.tsx",
  "lib/data/bookings.ts",
];

describe("a screen that labels a booking asks the label read", () => {
  for (const path of LABELS) {
    it(`${path} resolves the trade with labelCategory`, () => {
      const source = code(path);
      expect(source, "calls labelCategory").toMatch(/labelCategory\(/);
      expect(
        /\bgetCategory\(/.test(source),
        "calls getCategory, which misses a withdrawn trade and leaves the " +
          "screen printing the bare slug",
      ).toBe(false);
    });
  }
});

describe("a screen that decides whether we sell it asks the catalogue read", () => {
  for (const path of CATALOGUE) {
    it(`${path} resolves the trade with getCategory`, () => {
      const source = code(path);
      expect(source, "calls getCategory").toMatch(/\bgetCategory\(/);
      expect(
        /labelCategory\(/.test(source),
        "calls labelCategory, which returns a withdrawn trade — so this " +
          "screen would sell something we have stopped selling",
      ).toBe(false);
    });
  }
});

describe("the two reads are not the same function", () => {
  it("filters is_active in the catalogue read and not in the label one", () => {
    /*
     * THE ONE PROPERTY EVERYTHING ABOVE RESTS ON, asserted here so renaming or
     * rewriting either read cannot quietly make them identical. `getCategories`
     * must carry the filter and `allCategories` must not — if the second grew
     * one, every label would break again and all six cases above would still
     * pass.
     */
    const source = code("lib/data/categories.ts");
    const catalogue = source.slice(
      source.indexOf("export const getCategories"),
      source.indexOf("export async function getCategory("),
    );
    const label = source.slice(source.indexOf("export const allCategories"));

    expect(catalogue, "getCategories filters is_active").toMatch(
      /is_active/,
    );
    expect(
      /is_active/.test(label),
      "allCategories filters is_active — a withdrawn trade cannot be named",
    ).toBe(false);
  });
});
