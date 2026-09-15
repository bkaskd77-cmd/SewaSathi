import { describe, expect, it } from "vitest";

import { CATEGORY_SEED, SUB_BAND_SEED } from "@/lib/config/services";

/**
 * The sub-bands are the real promise.
 *
 * A category band spanning 10-13x cannot carry "no surprises" — AC servicing
 * runs 500 to 12,000 because a routine service, a gas refill and an
 * installation are three products, not one. What a customer actually reads is
 * the figure the triage narrows to, so that figure has to be researched,
 * sourced and dated like any other published price. It was prompt text until
 * 2026-09-15, which meant it could not be measured, could not be revised by
 * evidence, and had no provenance at all.
 */

const byCategory = (slug: string) =>
  SUB_BAND_SEED.filter((band) => band.categorySlug === slug);

describe("the category band is the union of its sub-bands", () => {
  /*
   * THE INVARIANT THAT MATTERS. A sub-band reaching outside the category range
   * would quote a customer a figure `quoteFloor` then clamps away — the triage
   * would say one number and the booking would show another.
   */
  it("matches exactly on every banded trade", () => {
    for (const category of CATEGORY_SEED) {
      if (category.pricingModel !== "band") continue;

      const subs = byCategory(category.slug);
      expect(subs.length, `${category.slug} has no sub-bands`).toBeGreaterThan(0);

      expect(
        { low: Math.min(...subs.map((s) => s.low)), high: Math.max(...subs.map((s) => s.high)) },
        `${category.slug} sub-bands do not span its published band`,
      ).toEqual({ low: category.basePriceMin, high: category.basePriceMax });
    }
  });

  it("never lets a sub-band escape its category", () => {
    for (const band of SUB_BAND_SEED) {
      const category = CATEGORY_SEED.find((c) => c.slug === band.categorySlug)!;
      expect(band.low).toBeGreaterThanOrEqual(category.basePriceMin);
      expect(band.high).toBeLessThanOrEqual(category.basePriceMax);
      expect(band.high).toBeGreaterThanOrEqual(band.low);
    }
  });

  it("gives a survey trade no sub-bands at all", () => {
    // Movers has no price until somebody has looked, so it has nothing to
    // narrow to either. Sub-bands here would be the same invention twice.
    for (const category of CATEGORY_SEED) {
      if (category.pricingModel !== "survey") continue;
      expect(byCategory(category.slug)).toHaveLength(0);
    }
  });
});

describe("AC servicing is the proof case", () => {
  it("separates routine service, gas refill and installation", () => {
    const ac = byCategory("ac-servicing");
    const bySlug = Object.fromEntries(ac.map((b) => [b.slug, b]));

    expect(bySlug.service.low).toBeGreaterThanOrEqual(1200);
    expect(bySlug.service.high).toBeLessThanOrEqual(2000);
    expect(bySlug.gas.low).toBeGreaterThanOrEqual(3500);
    expect(bySlug.install.high).toBe(12000);

    // Three products that do not overlap in the middle: a routine service can
    // never quote a gas-refill figure, which is the whole point.
    expect(bySlug.service.high).toBeLessThan(bySlug.gas.low);
  });

  it("would be a 24x range as one band and is four products instead", () => {
    const ac = CATEGORY_SEED.find((c) => c.slug === "ac-servicing")!;
    expect(ac.basePriceMax / ac.basePriceMin).toBeGreaterThan(10);
    expect(byCategory("ac-servicing").length).toBeGreaterThan(1);
  });
});

describe("a sub-band carries its own provenance", () => {
  it("records source, date and confidence on every row", () => {
    for (const band of SUB_BAND_SEED) {
      expect(["invented", "researched", "observed"]).toContain(band.pricingSource);
      expect(["high", "medium", "low"]).toContain(band.pricingConfidence);
      if (band.pricingSource === "researched") {
        expect(band.pricingCheckedAt).toBe("2026-09-15");
        // Inference is labelled as such in the note rather than passed off as
        // a citation — carpentry and pest control are mostly inferred.
        expect(band.pricingNote).toBeTruthy();
      }
    }
  });

  it("never lets a trade claim more confidence than any product in it", () => {
    /*
     * The relationship runs this way and not the other. A well-evidenced
     * sub-band inside a shakier trade is legitimate and common — home cleaning
     * is `medium` overall because flat size drives the price and almost every
     * source quotes "from", yet the single-room visit is published directly at
     * 800-1500 and is genuinely `high`. That is the reason sub-bands are more
     * informative than the band above them.
     *
     * What would be dishonest is the reverse: a trade calling itself `high`
     * while every product inside it was guessed.
     */
    const rank = { low: 0, medium: 1, high: 2 } as const;

    for (const category of CATEGORY_SEED) {
      const subs = byCategory(category.slug);
      if (subs.length === 0) continue;

      const best = Math.max(...subs.map((b) => rank[b.pricingConfidence]));
      expect(
        rank[category.pricingConfidence],
        `${category.slug} claims more confidence than any of its products`,
      ).toBeLessThanOrEqual(best);
    }
  });

  it("carries a Nepali label for every product", () => {
    // The narrowed figure is what a customer reads, so it has to read in both
    // languages — a sub-band with an English-only label is half shipped.
    for (const band of SUB_BAND_SEED) {
      expect(band.labelEn.length).toBeGreaterThan(2);
      expect(band.labelNe.length).toBeGreaterThan(1);
      expect(band.labelNe).not.toBe(band.labelEn);
    }
  });
});
