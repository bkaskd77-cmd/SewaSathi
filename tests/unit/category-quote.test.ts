import { describe, expect, it } from "vitest";

import {
  CATEGORY_SEED,
  categoryQuote,
  isSurveyPriced,
  type Category,
} from "@/lib/config/services";

/**
 * What a category can honestly tell a customer about price.
 *
 * THE BUG THIS EXISTS FOR WAS REASSURANCE IN A COMMENT. `lib/data/categories.ts`
 * said a failed read "degrades to slightly stale prices rather than an error
 * page", which was the whole problem stated as a feature: `/admin/bands` moves a
 * published band in the TABLE and never in `seed/categories.json`, so the gap
 * between the two grows with every decision somebody takes — and a failed read
 * served the older figure on the landing grid, on `/services`, on every category
 * page, and into `createBooking`, where it is frozen as `quoted_max` and becomes
 * the ceiling `judgeFinalAmount` measures a 2x overcharge against. Not stale
 * decoration: a stale customer protection.
 *
 * THREE ANSWERS, NOT TWO, AND THE THIRD IS THE POINT. `unreadable` must never
 * collapse into `survey`: "priced after a free survey" is a promise about how
 * movers and packers works, true for ever, and printing it over plumbing because
 * a query timed out tells a customer something false about the product and sends
 * them looking for a surveyor.
 */

const PLUMBING = CATEGORY_SEED.find((c) => c.slug === "plumbing")!;
const MOVERS = CATEGORY_SEED.find((c) => c.slug === "movers-packers")!;

function blanked(category: Category): Category {
  return { ...category, basePriceMin: null, basePriceMax: null };
}

describe("the three answers a category can give about price", () => {
  it("finds the two fixtures it reasons about", () => {
    /* The check that stops every case below passing over an undefined row,
       which is how a renamed slug reads as a clean result. */
    expect(PLUMBING).toBeDefined();
    expect(MOVERS).toBeDefined();
    expect(isSurveyPriced(MOVERS)).toBe(true);
    expect(isSurveyPriced(PLUMBING)).toBe(false);
  });

  it("gives the published range when there is one", () => {
    const quote = categoryQuote(PLUMBING);
    expect(quote.kind).toBe("band");
    if (quote.kind !== "band") throw new Error("unreachable");
    expect(quote.low).toBe(PLUMBING.basePriceMin);
    expect(quote.high).toBe(PLUMBING.basePriceMax);
  });

  it("says survey for a trade that publishes no price, read or not", () => {
    /*
     * SURVEY IS ANSWERED FIRST AND THAT ORDERING IS DELIBERATE. Movers still
     * carries a stored 5,000-20,000 from before the research found nobody quotes
     * a move unseen; nothing reads it. The sentence a movers customer gets must
     * not depend on the health of a query, so it is `survey` either way.
     */
    expect(categoryQuote(MOVERS).kind).toBe("survey");
    expect(categoryQuote(blanked(MOVERS)).kind).toBe("survey");
  });

  it("says unreadable for a band we could not read — never survey", () => {
    const quote = categoryQuote(blanked(PLUMBING));
    expect(quote.kind).toBe("unreadable");
    /* The assertion that matters is the NEGATIVE one: collapsing these two is
       the mistake, and `kind === "unreadable"` alone would still pass if the
       function started returning survey for everything blanked. */
    expect(quote.kind).not.toBe("survey");
    expect(quote.kind).not.toBe("band");
  });

  it("refuses a half-read band rather than using the half it has", () => {
    /*
     * A row with one bound is not a band. It cannot arise from `withoutBand`,
     * which blanks both — but it can arise from a future read that selects one
     * column, and taking the survivor would publish a range with an invented
     * end. Both directions, because a missing floor and a missing ceiling fail
     * differently and only one of them is obvious.
     */
    expect(
      categoryQuote({ ...PLUMBING, basePriceMin: null }).kind,
    ).toBe("unreadable");
    expect(
      categoryQuote({ ...PLUMBING, basePriceMax: null }).kind,
    ).toBe("unreadable");
  });

  it("composes isSurveyPriced rather than re-deriving it", () => {
    /*
     * Asserted over the whole seed rather than on one row: the two must agree on
     * which trades publish no price, and a second copy of that test is the
     * divergence `lib/provider/measured.ts` exists to prevent. Checked blanked
     * as well as whole, because that is where a second opinion would show up.
     */
    for (const category of CATEGORY_SEED) {
      const survey = isSurveyPriced(category);
      expect(categoryQuote(category).kind === "survey", category.slug).toBe(
        survey,
      );
      expect(
        categoryQuote(blanked(category)).kind === "survey",
        category.slug,
      ).toBe(survey);
    }
  });

  it("never reports a band of zero for any seeded trade", () => {
    /*
     * Rule 6 on the output side. The failure mode being guarded is a `?? 0`
     * creeping in to satisfy the type: a floor of zero renders as "From Rs 0"
     * and a ceiling of zero makes the 2x overcharge ceiling zero, which would
     * refuse every honest overrun in the app.
     */
    for (const category of CATEGORY_SEED) {
      const quote = categoryQuote(category);
      if (quote.kind !== "band") continue;
      expect(quote.low, category.slug).toBeGreaterThan(0);
      expect(quote.high, category.slug).toBeGreaterThan(quote.low);
    }
  });
});
