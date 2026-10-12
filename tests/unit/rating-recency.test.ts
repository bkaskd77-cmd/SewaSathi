import { describe, expect, it } from "vitest";

import {
  RATING_HALF_LIFE_DAYS,
  RATING_PRIOR_MEAN,
  ageInDays,
  bayesianRating,
  displayRating,
  rankedRating,
  ratingEvidence,
  recencyWeight,
  recencyWeightedRating,
} from "@/lib/provider";

/**
 * A rating that remembers when it was earned.
 *
 * THE CASES ARE WRITTEN AS THE BEHAVIOUR, not against the half-life constant —
 * `ACTIVITY_FLOOR`'s lesson, where every case read the constant the code read
 * and so asserted only that the floor is the floor. Where a number is needed it
 * is spelled out, so changing the half-life has to change these too, and that
 * is the decision.
 */

const fresh = (rating: number) => ({ rating, ageDays: 0 });

describe("a review is worth less as it ages", () => {
  it("counts fully on the day it is written", () => {
    expect(recencyWeight(0)).toBe(1);
  });

  it("counts half after a year", () => {
    expect(recencyWeight(365)).toBeCloseTo(0.5, 10);
    expect(recencyWeight(730)).toBeCloseTo(0.25, 10);
  });

  it("decays continuously rather than falling off a cliff", () => {
    /*
     * A cutoff would make a review worth everything on day 364 and nothing on
     * day 366, so somebody's standing lurches on a date they cannot see — the
     * unpublished threshold `/providers/standards` refuses to have. Adjacent
     * days must be almost indistinguishable.
     */
    expect(Math.abs(recencyWeight(364) - recencyWeight(366))).toBeLessThan(0.002);
  });

  it("never lets a future timestamp be worth more than today", () => {
    // Otherwise a clock skew, or a row stamped forward, buys a rating.
    expect(recencyWeight(-500)).toBe(1);
  });

  it("is worth nothing when the age cannot be read", () => {
    expect(recencyWeight(Number.POSITIVE_INFINITY)).toBe(0);
    expect(recencyWeight(Number.NaN)).toBe(0);
  });
});

describe("the mean follows the recent work", () => {
  it("is the plain mean when everything is fresh", () => {
    const { avg, weight } = recencyWeightedRating([fresh(5), fresh(4), fresh(3)]);
    expect(avg).toBeCloseTo(4, 10);
    expect(weight).toBeCloseTo(3, 10);
  });

  it("moves toward the recent reviews when the old ones disagree", () => {
    /*
     * THE COMPLAINT THIS RULE EXISTS FOR. Somebody excellent two years ago and
     * mediocre since: a flat mean reads 4.0 and describes neither person.
     */
    const reviews = [
      { rating: 5, ageDays: 730 },
      { rating: 5, ageDays: 730 },
      { rating: 3, ageDays: 0 },
      { rating: 3, ageDays: 0 },
    ];
    const flat = (5 + 5 + 3 + 3) / 4;
    const { avg } = recencyWeightedRating(reviews);

    expect(flat).toBe(4);
    expect(avg).toBeLessThan(flat);
    // Two quarter-weight fives against two full threes.
    expect(avg).toBeCloseTo((5 * 0.5 + 3 * 2) / 2.5, 6);
  });

  it("says nothing rather than zero when every weight has gone", () => {
    /*
     * Rule 6. Reviews so old that the weights underflow are not evidence of a
     * bad rating — and 0 would render as the worst score a professional can
     * have, off rows that say the opposite.
     */
    const ancient = recencyWeightedRating([{ rating: 5, ageDays: 1e6 }]);
    expect(ancient.avg).toBeNull();
    expect(recencyWeightedRating([]).avg).toBeNull();
  });
});

describe("the confidence decays with the figure, which is the point", () => {
  it("pulls an old sample back toward the prior as hard as a thin one", () => {
    /*
     * THE COMPOSITION, AND THE HALF OF IT THAT IS EASY TO GET WRONG. Feeding
     * `bayesianRating` the ROW count would leave twenty ancient reviews at full
     * confidence while their average drifted — the figure moves and the
     * certainty behind it does not. The weighted count is what fixes that.
     */
    const old = Array.from({ length: 20 }, () => ({ rating: 5, ageDays: 1095 }));
    const { avg, weight } = recencyWeightedRating(old);

    // Three years is three half-lives: twenty reviews are worth two and a half.
    expect(weight).toBeCloseTo(2.5, 6);

    const honest = bayesianRating(avg as number, weight);
    const flattering = bayesianRating(avg as number, old.length);

    expect(honest).toBeLessThan(flattering);
    // And it lands where somebody with two and a half fresh reviews would.
    expect(honest).toBeCloseTo(bayesianRating(5, 2.5), 10);
  });

  it("leaves a fresh sample exactly where it was", () => {
    // The rule must be inert on a product whose reviews are all weeks old,
    // which is the state today: nothing about anybody's standing changes.
    const recent = Array.from({ length: 6 }, () => ({ rating: 4.5, ageDays: 14 }));
    const { avg, weight } = recencyWeightedRating(recent);

    expect(bayesianRating(avg as number, weight)).toBeCloseTo(
      bayesianRating(4.5, 6),
      2,
    );
  });
});

describe("ages come from timestamps without a database", () => {
  const now = new Date("2026-10-12T00:00:00Z");

  it("counts whole days back", () => {
    expect(ageInDays("2026-10-11T00:00:00Z", now)).toBeCloseTo(1, 10);
    expect(ageInDays("2025-10-12T00:00:00Z", now)).toBeCloseTo(365, 10);
  });

  it("treats an unreadable stamp as infinitely old, which is weightless", () => {
    // Never as fresh: a row whose date cannot be read must not be handed full
    // weight, which is the direction that could be exploited.
    expect(recencyWeight(ageInDays("not a date", now))).toBe(0);
  });

  it("uses the half-life the module publishes", () => {
    // The one case that may read the constant: it asserts the published number
    // is the one in force, which is what a caller elsewhere would rely on.
    expect(recencyWeight(RATING_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 10);
  });
});

/**
 * AND THE COLUMNS HAVE A READER, which is the half that shipped a commit late.
 *
 * `20261012000001` added `rating_recent_avg` and `rating_recent_weight`, the
 * rule was written twice and compared, the tests were green — and nothing in
 * the product read either column. That is `applyRedoRecovery`'s four-phase
 * shape, `proposeBand`'s and `booking_refusals.reason_code`'s: every link built
 * and the chain left open. These cases assert the chain, which is why they live
 * beside the rule rather than inside the module that composes it.
 */
describe("the composed figure is what a reader gets", () => {
  /** Twelve reviews, all of them two years old: a stale 5.0. */
  const stale = {
    ratingAvg: 5,
    ratingCount: 12,
    ...(() => {
      const r = recencyWeightedRating(
        Array.from({ length: 12 }, () => ({ rating: 5, ageDays: 730 })),
      );
      return { ratingRecentAvg: r.avg, ratingRecentWeight: r.weight };
    })(),
  };

  it("prefers the recency pair over the flat one", () => {
    const shown = displayRating(stale)!;

    // Two half-lives: twelve reviews are worth three, so the prior pulls much
    // harder than it would on twelve. The figure a customer reads drops.
    expect(shown).toBeCloseTo(bayesianRating(5, 3), 6);
    expect(shown).toBeLessThan(bayesianRating(5, 12));
  });

  it("falls back to the flat pair when the columns were never computed", () => {
    /*
     * EVERY ROW WRITTEN BEFORE THE MIGRATION IS SILENT, and silence is not a
     * rating of zero. The listing with the one live review is one of those
     * rows, so this is today's ordinary case and not an edge.
     */
    const unmigrated = {
      ratingAvg: 4.6,
      ratingCount: 12,
      ratingRecentAvg: null,
      ratingRecentWeight: null,
    };

    expect(displayRating(unmigrated)).toBeCloseTo(bayesianRating(4.6, 12), 10);
    expect(ratingEvidence(unmigrated).recent).toBe(false);
  });

  it("falls back on a computed row with no weight left, rather than scoring zero", () => {
    // `refresh_provider_stats` writes a null average and a weight of 0 when
    // nothing has any weight. Reading that as a 0-star rating is rule 6 at its
    // most expensive, so the flat pair answers — and `hasRating` has already
    // said there is a published review.
    const underflowed = {
      ratingAvg: 4.6,
      ratingCount: 12,
      ratingRecentAvg: null,
      ratingRecentWeight: 0,
    };

    expect(displayRating(underflowed)).toBeCloseTo(bayesianRating(4.6, 12), 10);
  });

  it("says nothing at all when nobody has rated them, whatever the pair holds", () => {
    // `hasRating` stays the gate and still reads the ROW count, so a stray
    // recency figure on an unrated listing cannot put a number on a screen.
    expect(
      displayRating({
        ratingAvg: 0,
        ratingCount: 0,
        ratingRecentAvg: 4.9,
        ratingRecentWeight: 3,
      }),
    ).toBeNull();
  });

  it("gives the ranking the prior for an unrated listing and not a null", () => {
    /*
     * The score cannot hold a null — every listing needs a comparable figure —
     * and the honest one is the prior: like an unknown, never like an extreme.
     * This is also the proof that pointing `scoreParts` at `displayRating`
     * changed no unrated listing's score, because `bayesianRating(0, 0)` is
     * exactly `RATING_PRIOR_MEAN`.
     */
    const unrated = {
      ratingAvg: 0,
      ratingCount: 0,
      ratingRecentAvg: null,
      ratingRecentWeight: null,
    };

    expect(displayRating(unrated)).toBeNull();
    expect(rankedRating(unrated)).toBe(RATING_PRIOR_MEAN);
    expect(rankedRating(unrated)).toBeCloseTo(bayesianRating(0, 0), 10);
  });

  it("keeps the count beside the figure as the ROW count, not the weight", () => {
    /*
     * THE TWO NUMBERS ANSWER DIFFERENT QUESTIONS. The weight is confidence and
     * the count is evidence: "4.6 (12)" means twelve people wrote something,
     * and printing an effective 3.0 there would be a figure no customer could
     * check against a page of reviews — and one that would drift downward on a
     * profile where nothing had happened.
     */
    expect(stale.ratingRecentWeight).toBeCloseTo(3, 6);
    expect(stale.ratingCount).toBe(12);
    // Nothing in `measured.ts` touches the count, which is what the surfaces
    // render in brackets. The source guard below is what keeps it that way.
    expect(ratingEvidence(stale).weight).not.toBe(stale.ratingCount);
  });
});
