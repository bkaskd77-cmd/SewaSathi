import { describe, expect, it } from "vitest";

import { CATEGORY_SEED } from "@/lib/config/services";
import { bandForTrades, clampRate, quoteFloor } from "@/lib/provider";

/**
 * The floor of a quote, which is the number a professional's own dashboard
 * price finally reaches.
 *
 * Before this, `createBooking` froze the category band whoever the customer
 * had picked, so the figure a professional set was visible on their card and
 * nowhere in the flow that decides what anybody pays.
 *
 * Two things these tests exist to hold. The ceiling is ours and never moves —
 * the 2x customer protection in `judgeFinalAmount` is measured off it. And the
 * floor can never cross it, which is not a hypothetical: a multi-trade
 * professional is clamped against the UNION of their bands, so a
 * plumber-and-painter legally sits above every plumbing job's maximum.
 */

const PLUMBING = { low: 900, high: 4500 };

describe("the professional's starting price becomes the floor", () => {
  it("takes their rate when it sits inside the band", () => {
    expect(quoteFloor({ providerRate: 2000, band: PLUMBING })).toBe(2000);
  });

  it("lifts a rate below the band to our floor", () => {
    // The band is published in advance and is ours. Somebody cheaper than it
    // does not make the quote cheaper than it.
    expect(quoteFloor({ providerRate: 500, band: PLUMBING })).toBe(900);
  });

  it("leaves the floor at ours when nobody is chosen", () => {
    expect(quoteFloor({ providerRate: null, band: PLUMBING })).toBe(900);
    expect(quoteFloor({ providerRate: undefined, band: PLUMBING })).toBe(900);
  });

  it("treats a nonsense rate as nobody chosen rather than as zero", () => {
    // A floor of 0 would fail the table's own `quoted_min > 0` check and turn
    // a bad row into a booking that cannot be made at all.
    expect(quoteFloor({ providerRate: Number.NaN, band: PLUMBING })).toBe(900);
  });
});

describe("the floor can never cross the ceiling", () => {
  it("caps a multi-trade rate at the booked category's maximum", () => {
    /*
     * A plumber-and-painter is clamped against the union of their bands
     * (plumbing 900-4500, painting 4000-25000), so Rs 12,000 is a legal rate
     * for them. Taken raw as the floor of a PLUMBING job it would write
     * quoted_min 12,000 against quoted_max 4,500 — a row the check constraint
     * refuses, which is a booking that simply fails to save.
     */
    const union = bandForTrades(
      ["plumbing", "painting"],
      [
        { slug: "plumbing", ...PLUMBING },
        { slug: "painting", low: 4000, high: 25000 },
      ],
    );
    expect(union).toEqual({ low: 900, high: 25000 });

    const legalForThem = clampRate({ rate: 12000, band: union! });
    expect(legalForThem.clampedTo).toBeNull();

    expect(quoteFloor({ providerRate: legalForThem.rate, band: PLUMBING }))
      .toBe(4500);
  });

  it("never returns more than the band's high, whatever the rate", () => {
    for (const rate of [0, 1, 900, 4499, 4500, 4501, 999_999]) {
      const floor = quoteFloor({ providerRate: rate, band: PLUMBING });
      expect(floor).toBeGreaterThanOrEqual(PLUMBING.low);
      expect(floor).toBeLessThanOrEqual(PLUMBING.high);
    }
  });

  it("survives a band stored the wrong way round", () => {
    // A data error is not something to enforce against a person: widen to the
    // pair rather than trapping every rate at an impossible value.
    const floor = quoteFloor({ providerRate: 2000, band: { low: 4500, high: 900 } });
    expect(floor).toBe(2000);
  });
});

describe("every published band says where it came from", () => {
  /*
   * The band is on every category card, in the triage answer, and is the floor
   * of every quote the fee is charged on. Nothing distinguished a guess from a
   * researched figure, so after the first trade was researched there would have
   * been no way to tell which nine were still made up.
   */
  it("carries a recognised provenance on all ten trades", () => {
    expect(CATEGORY_SEED.length).toBeGreaterThan(0);
    for (const category of CATEGORY_SEED) {
      expect(["invented", "researched", "observed"]).toContain(
        category.pricingSource,
      );
    }
  });

  it("never claims a band was checked without saying when and against what", () => {
    // "researched" with no date and no source is the same as invented, with a
    // label that stops anybody asking.
    for (const category of CATEGORY_SEED) {
      if (category.pricingSource === "invented") continue;
      expect(category.pricingCheckedAt).toBeTruthy();
      expect(category.pricingNote).toBeTruthy();
    }
  });

  it("has a floor below its ceiling on every trade", () => {
    for (const category of CATEGORY_SEED) {
      expect(category.basePriceMin).toBeGreaterThan(0);
      expect(category.basePriceMax).toBeGreaterThan(category.basePriceMin);
    }
  });
});
