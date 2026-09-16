import { describe, expect, it } from "vitest";

import { FALLBACK_PRICE_BANDS } from "@/lib/ai/price-bands";
import {
  CATEGORY_SEED,
  SUB_BAND_SEED,
  isSurveyPriced,
} from "@/lib/config/services";
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

describe("a trade with no published price does not pretend to have one", () => {
  /*
   * Movers and packers is the case. No Nepali operator publishes a figure —
   * every one quotes after a survey — so the honest model is to publish no band
   * rather than to invent the one number the market refuses to state before
   * looking at the job.
   */
  const survey = CATEGORY_SEED.filter((c) => c.pricingModel === "survey");

  it("marks the trade as survey-priced rather than guessing a band", () => {
    expect(survey.map((c) => c.slug)).toEqual(["movers-packers"]);
  });

  it("never claims a survey trade's band was researched", () => {
    // Stamping `researched` here would be exactly the dishonesty the
    // provenance column exists to prevent: the research found no price.
    for (const category of survey) {
      expect(category.pricingSource).toBe("invented");
    }
  });

  it("carries a confidence level on every trade, band or survey", () => {
    for (const category of CATEGORY_SEED) {
      expect(["high", "medium", "low"]).toContain(category.pricingConfidence);
    }
  });
});

describe("the researched floors err low on purpose", () => {
  it("never sits above the cheapest published job in the trade", () => {
    /*
     * Published prices come from firms that advertise; the independent mistri
     * is cheaper and publishes nothing. clampRate then moves a professional's
     * rate UP into the band, which takes money from customers and inflates the
     * commission basis — so a floor that drifted upward would compound a bias
     * we already know about. These are the cheapest figures the research found.
     */
    const cheapestFound: Record<string, number> = {
      plumbing: 350,
      electrical: 350,
      "home-cleaning": 800,
      "appliance-repair": 500,
      "ac-servicing": 500,
      "water-tank-cleaning": 1500,
    };

    for (const [slug, cheapest] of Object.entries(cheapestFound)) {
      const category = CATEGORY_SEED.find((c) => c.slug === slug)!;
      expect(category.basePriceMin).toBeLessThanOrEqual(cheapest);
    }
  });

  it("says where every researched band came from and when", () => {
    for (const category of CATEGORY_SEED) {
      if (category.pricingSource !== "researched") continue;
      expect(category.pricingCheckedAt).toBe("2026-09-15");
      // The sources and the err-low reasoning both live in the note, so a
      // future reader can re-derive the figure rather than inherit it.
      expect(category.pricingNote).toMatch(/bottom of the researched range/);
    }
  });
});

describe("a survey trade's numbers never reach a screen", () => {
  /*
   * THE FAILURE THIS EXISTS FOR. `pricing_model = 'survey'` was set, the triage
   * prompt dropped the range, and `check:blockers` named the right remedy —
   * and five screens went on rendering an invented Rs 5,000–20,000 anyway. The
   * data was honest and the product was not, which is the worse half to leave.
   *
   * It happened because each screen re-derived "should I show a range" as
   * "does this row have numbers", and the row does: movers still carries
   * leftovers from before the research found that nobody quotes one. So the
   * question is asked in ONE place and this pins that every surface asks it.
   */

  it("still has stored numbers, which is exactly why the flag is needed", () => {
    const movers = CATEGORY_SEED.find((c) => c.slug === "movers-packers")!;
    expect(movers.basePriceMin).toBeGreaterThan(0);
    expect(movers.basePriceMax).toBeGreaterThan(0);
    expect(isSurveyPriced(movers)).toBe(true);
  });

  it("is the only thing that decides, on every category", () => {
    for (const category of CATEGORY_SEED) {
      expect(isSurveyPriced(category)).toBe(category.pricingModel === "survey");
    }
  });

  it("carries no sub-bands, because a sub-band is a published price too", () => {
    // The sub-band table is the narrowed promise a customer actually reads.
    // One row for a survey trade would put a figure back on the category page
    // through the side door.
    const survey = CATEGORY_SEED.filter(isSurveyPriced).map((c) => c.slug);
    for (const band of SUB_BAND_SEED) {
      expect(survey).not.toContain(band.categorySlug);
    }
  });

  it("tells the model not to state a figure", () => {
    // `lib/ai/prompt.ts` is generated from this, so a triage answer cannot
    // quote a range the rest of the product has stopped publishing.
    const movers = FALLBACK_PRICE_BANDS.find(
      (band) => band.slug === "movers-packers",
    );
    expect(movers?.model).toBe("survey");
    expect(movers?.note).toMatch(/survey/i);
  });
});
