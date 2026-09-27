import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import ne from "@/messages/ne.json";
import { isSurveyPriced, SERVICE_CATEGORIES } from "@/lib/config/services";

/**
 * The homepage may not tell a visitor something untrue.
 *
 * WHAT WAS THERE. `<ActivityTicker />` cycled six invented bookings — "Priya in
 * Baneshwor booked a cleaning 3 minutes ago", with `minutesAgo` a hardcoded
 * constant so it said "3 minutes ago" permanently — and every category card
 * read "312 booked this week" against 14 real bookings across all ten trades.
 * Both were live above the fold.
 *
 * They contradicted the product underneath them, which refuses to print `0.0`
 * for an unrated professional and gates all 36 sub-band durations because they
 * are guesses. This file is what stops that class coming back.
 */

describe("nothing on the homepage claims a number nobody measured", () => {
  it("has no invented-activity namespace left in either catalogue", () => {
    expect(en).not.toHaveProperty("activity");
    expect(ne).not.toHaveProperty("activity");
  });

  it("has no booking-count string left in either catalogue", () => {
    expect(en.home).not.toHaveProperty("bookedThisWeek");
    expect(ne.home).not.toHaveProperty("bookedThisWeek");
  });

  /*
   * THE PROMISES ARE CLAIMS TOO, so they are pinned rather than trusted. Each
   * one is enforced somewhere in code; if a line here is reworded into a
   * promise the product does not keep, that is the same failure in a nicer
   * font.
   */
  it("carries three promises, in both languages", () => {
    for (const key of ["payAfter", "emergency", "freeToUse"] as const) {
      expect(en.home.promise[key]).toBeTruthy();
      expect(ne.home.promise[key]).toBeTruthy();
      // Nepali written rather than left as the English.
      expect(ne.home.promise[key]).not.toBe(en.home.promise[key]);
    }
  });
});

describe("the category card's price line", () => {
  /*
   * RULE 6, IN THE SHAPE IT TAKES FOR A PRICE. Movers publishes no band
   * anywhere — no Nepali operator quotes a move without seeing it — so a floor
   * read straight off the column would render "From Rs 0" or "From Rs null".
   * `isSurveyPriced` is what every other surface asks, and the homepage asks it
   * too rather than forming a second opinion.
   */
  it("never has a priceable category without a floor to show", () => {
    for (const category of SERVICE_CATEGORIES) {
      if (isSurveyPriced(category)) continue;
      expect(
        category.basePriceMin,
        `${category.slug} is band-priced with no floor`,
      ).toBeGreaterThan(0);
    }
  });

  it("has at least one survey-priced category, so the branch is reachable", () => {
    const survey = SERVICE_CATEGORIES.filter(isSurveyPriced);
    expect(survey.map((c) => c.slug)).toContain("movers-packers");
  });

  /*
   * ONE SENTENCE, NOT TWO. The survey line is taken from the key `/services`
   * already uses, so the two surfaces cannot drift into describing the same
   * policy differently.
   */
  it("uses the same survey sentence as /services", () => {
    expect(en.home.surveyPriced).toBe(en.services.surveyPriced);
    expect(ne.home.surveyPriced).toBe(ne.services.surveyPriced);
  });

  it("interpolates the price as a pre-formatted string", () => {
    // `formatNpr` swaps Rs for रु and leaves the digits alone, so the message
    // takes {price} rather than a number next-intl would localise to Devanagari.
    expect(en.home.fromPrice).toContain("{price}");
    expect(ne.home.fromPrice).toContain("{price}");
  });
});
