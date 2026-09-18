import { describe, expect, it } from "vitest";

import { applySafetyFloor, HAZARD_BANDS } from "@/lib/ai/safety";
import { SUB_BAND_SEED, CATEGORY_SEED } from "@/lib/config/services";
import type { TriageResult } from "@/lib/ai/mockTriage";
import type { SafetyCopy } from "@/lib/ai/copy";

/**
 * The one question the card asks when the triage could not name a product.
 *
 * A category band spans 10-13x, so the narrowed product is what actually
 * carries "no surprises" — and the keyword matcher names one for about a
 * sixth of requests, in all three scripts. A customer's statement is evidence;
 * our guess is not.
 *
 * This file covers the rules the ask rests on. The card itself is a few
 * buttons; what matters is that a stated band can only ever help, and that
 * the one hazard-shaped product raises urgency rather than sitting silently
 * in a list.
 */

const COPY: SafetyCopy = {
  gas: "Turn off the cylinder.",
  burning: "Switch off at the mains.",
  "live-wire": "Do not touch it.",
  unseenPhoto: "We could not look at your photo.",
};

function routine(category = "electrical"): TriageResult {
  return {
    category,
    urgency: "routine",
    priceRangeNPR: [500, 5000],
    explanation: "Somebody will take a look.",
    band: null,
  };
}

describe("a stated product can raise urgency, never lower it", () => {
  it("raises to emergency on the one hazard-shaped product", () => {
    /*
     * THE CASE THIS EXISTS FOR. The ask only appears when the description said
     * too little to name a product, so somebody tapping "short circuit,
     * sparking or burning smell" has told us something their words never did —
     * and the text guard reads only their words.
     */
    const out = applySafetyFloor("bijuli ko problem", routine(), {
      copy: COPY,
      statedHazard: HAZARD_BANDS["electrical/fault"],
    });

    expect(out.result.urgency).toBe("emergency");
    expect(out.result.explanation.startsWith(COPY.burning)).toBe(true);
    expect(out.via).toBe("stated");
  });

  it("leaves an emergency an emergency", () => {
    const already: TriageResult = { ...routine(), urgency: "emergency" };
    const out = applySafetyFloor("", already, {
      copy: COPY,
      statedHazard: "burning",
    });
    expect(out.result.urgency).toBe("emergency");
  });

  it("changes nothing at all when the product is ordinary", () => {
    // Most of them are. A burst pipe is urgent and not dangerous; an AC gas
    // refill is deliberately not a gas leak.
    const result = routine("plumbing");
    const out = applySafetyFloor("tap is dripping", result, {
      copy: COPY,
      statedHazard: null,
    });
    expect(out.result).toEqual(result);
    expect(out.via).toBeNull();
  });

  it("lets the deterministic text guard win when both fire", () => {
    /*
     * The text guard is a fixed list of stems and the statement is a tap that
     * could be a mis-tap, so the reading recorded is the text one. Both raise,
     * so the customer sees the same urgency either way — what differs is what
     * gets written down, which is what later tells us whether the stem lists
     * are working.
     */
    const out = applySafetyFloor("ग्यास गन्हायो", routine("plumbing"), {
      copy: COPY,
      statedHazard: "burning",
    });
    expect(out.via).toBe("text");
    expect(out.hazard).toBe("gas");
  });
});

describe("the hazard-band list stays honest", () => {
  it("names only products that exist", () => {
    // Keyed `category/slug` because `repair` and `fault` both live in more
    // than one trade. A key naming nothing would sit here looking like cover.
    const real = new Set(
      SUB_BAND_SEED.map((band) => `${band.categorySlug}/${band.slug}`),
    );
    for (const key of Object.keys(HAZARD_BANDS)) {
      expect(real.has(key), `${key} is not a sub-band`).toBe(true);
    }
  });

  it("stays short", () => {
    /*
     * A product earns a place only when there is no innocent reading of
     * choosing it. Widening this is how a hazard detector starts crying wolf,
     * and CLAUDE.md is explicit that a product which cries wolf is worth
     * nothing when it is real.
     */
    expect(Object.keys(HAZARD_BANDS).length).toBeLessThanOrEqual(3);
  });
});

describe("there is always something to ask, or nothing at all", () => {
  it("gives every banded trade at least two products", () => {
    // A question with one answer is not a question.
    for (const category of CATEGORY_SEED) {
      if (category.pricingModel === "survey") continue;
      const mine = SUB_BAND_SEED.filter(
        (band) => band.categorySlug === category.slug,
      );
      expect(mine.length, `${category.slug} has too few products`).toBeGreaterThan(1);
    }
  });

  it("gives a survey trade none, so it is never asked", () => {
    /*
     * Movers is the case: no Nepali operator publishes a price, so there is
     * nothing to narrow to and the honest answer is that a surveyor comes.
     * Offering products there would be inventing a price list.
     */
    const survey = CATEGORY_SEED.filter((c) => c.pricingModel === "survey");
    expect(survey.length).toBeGreaterThan(0);
    for (const category of survey) {
      expect(
        SUB_BAND_SEED.filter((band) => band.categorySlug === category.slug),
      ).toHaveLength(0);
    }
  });

  it("keeps every product's published range inside its category band", () => {
    /*
     * THE ASK NOW SHOWS THESE NUMBERS TO A CUSTOMER, which is new. A sub-band
     * reaching outside the category band would put a figure on the card that
     * the clamp then refuses on the booking — two prices for one job.
     */
    const bySlug = new Map(CATEGORY_SEED.map((c) => [c.slug, c]));
    for (const band of SUB_BAND_SEED) {
      const category = bySlug.get(band.categorySlug);
      expect(category, band.categorySlug).toBeDefined();
      expect(band.low, `${band.categorySlug}/${band.slug} low`).toBeGreaterThanOrEqual(
        category!.basePriceMin,
      );
      expect(band.high, `${band.categorySlug}/${band.slug} high`).toBeLessThanOrEqual(
        category!.basePriceMax,
      );
    }
  });

  it("gives every product a label in both languages", () => {
    // The ask is the first customer-visible use of `labelNe`, so an empty one
    // would render as a blank chip nobody can tap meaningfully.
    for (const band of SUB_BAND_SEED) {
      const id = `${band.categorySlug}/${band.slug}`;
      expect(band.labelEn.trim(), `${id} has no English label`).not.toBe("");
      expect(band.labelNe.trim(), `${id} has no Nepali label`).not.toBe("");
      expect(band.labelNe, `${id} Nepali label is the English one`).not.toBe(
        band.labelEn,
      );
    }
  });
});
