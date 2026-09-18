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

/**
 * And how long it takes, which arrived with the job-duration phase.
 *
 * TWO NUMBERS, BECAUSE FOR PAINTING THEY DIVERGE. A room takes four days and a
 * painter a few hours of each — putty dries, primer cures, coats need hours
 * between them. `categories.max_concurrent_jobs` was a single number pretending
 * to model that, which is why painting's was 3 and why the column is gone.
 */
describe("a sub-band says how long the work takes", () => {
  it("gives every product a working time and a span", () => {
    for (const band of SUB_BAND_SEED) {
      const id = `${band.categorySlug}/${band.slug}`;
      expect(band.typicalWorkingMinutes, `${id} has no working time`).toBeGreaterThan(0);
      expect(band.typicalElapsedDays, `${id} has no span`).toBeGreaterThanOrEqual(1);
      expect(band.typicalElapsedDays, `${id} spans more than a month`).toBeLessThanOrEqual(30);
    }
  });

  /*
   * A SPAN THAT DOES NOT FIT ITS OWN WORKING TIME IS A TYPO, and it is the one
   * error in this data a reader would not spot: 480 minutes over 1 day is
   * eight hours and fine, 480 minutes over 10 days is 48 minutes a day and
   * means somebody moved one number without the other.
   */
  it("never claims more work in a day than a day holds", () => {
    const MINUTES_IN_A_WORKING_DAY = 12 * 60;
    for (const band of SUB_BAND_SEED) {
      expect(
        band.typicalWorkingMinutes / band.typicalElapsedDays,
        `${band.categorySlug}/${band.slug} works more hours a day than exist`,
      ).toBeLessThanOrEqual(MINUTES_IN_A_WORKING_DAY);
    }
  });

  /*
   * DURATION PROVENANCE IS SEPARATE FROM PRICE PROVENANCE, and this is the
   * test that keeps it separate. Merging them would let a researched price
   * carry a guessed duration under its confidence, which is rule 6's failure
   * with an extra step.
   */
  it("records its own source, never borrowing the price's", () => {
    for (const band of SUB_BAND_SEED) {
      const id = `${band.categorySlug}/${band.slug}`;
      expect(["invented", "researched", "observed"]).toContain(band.durationSource);
      expect(["high", "medium", "low"]).toContain(band.durationConfidence);
      expect(band.durationNote, `${id} says nothing about where its duration came from`)
        .toBeTruthy();

      if (band.durationSource === "invented") {
        expect(band.durationCheckedAt, `${id} is invented but claims a checked date`).toBeNull();
        expect(band.durationConfidence, `${id} is invented but claims confidence`).toBe("low");
      } else {
        expect(band.durationCheckedAt, `${id} claims research with no date`).toBeTruthy();
      }
    }
  });

  /*
   * THE STATE OF THE WORLD TODAY, asserted rather than assumed. Nobody in
   * Nepal publishes how long a tap leak takes, so all 36 are guesses and the
   * product prints none of them. When this test fails it is good news — it
   * means somebody did the research — and the failure points at the launch
   * blocker that has to be updated with it.
   */
  it("has nothing researched yet, which is why no screen shows a duration", () => {
    const publishable = SUB_BAND_SEED.filter((b) => b.durationSource !== "invented");
    expect(
      publishable,
      "a duration became publishable — update the sub-band-durations launch blocker",
    ).toEqual([]);
  });

  /*
   * PAINTING IS THE CASE THE MODEL EXISTS FOR, so it is pinned rather than
   * left to the general rules. A one-room supplied job occupies the room for
   * days and the painter for hours, and if those two ever collapse back into
   * one number the whole phase has been undone.
   */
  it("separates the painter's hours from the room's days", () => {
    const supplied = byCategory("painting").find((b) => b.slug === "room-supplied");
    expect(supplied).toBeDefined();
    expect(supplied!.typicalElapsedDays).toBeGreaterThan(1);
    expect(
      supplied!.typicalWorkingMinutes / supplied!.typicalElapsedDays,
      "a painter is not on the tools all day for the whole span — that is what drying is",
    ).toBeLessThan(8 * 60);

    const touchUp = byCategory("painting").find((b) => b.slug === "touch-up");
    expect(touchUp!.typicalElapsedDays, "one wall, one coat, one day").toBe(1);
  });

  /*
   * A cleaner cleans one flat and leaves; a plumber fixes the tap and leaves.
   * If one of these ever grows a span it is a data error, not a trade change —
   * and a spurious span would hold a customer's home for days for nothing.
   */
  it("keeps the same-day trades same-day", () => {
    for (const slug of ["home-cleaning", "plumbing", "ac-servicing", "water-tank-cleaning"]) {
      for (const band of byCategory(slug)) {
        expect(
          band.typicalElapsedDays,
          `${slug}/${band.slug} claims to occupy a home for more than a day`,
        ).toBe(1);
      }
    }
  });
});
