import { describe, expect, it } from "vitest";

import type { Provider } from "@/lib/data/providers";
import providerSeed from "@/lib/data/seed/providers.json";
import reviewSeed from "@/lib/data/seed/reviews.json";
import {
  OVERBOOK_RANKING_PENALTY_MAX,
  overbookRankingPenalty,
  scoreParts,
} from "@/lib/data/ranking";
import {
  OFFER_MIN_SAMPLE,
  OVERBOOK_MIN_OFFERS,
  bayesianRating,
  displayRating,
  hasAnsweredRecord,
  hasCompletion,
  hasOverbookRecord,
  hasRating,
  hasResponse,
  type StatEvidence,
} from "@/lib/provider";

/**
 * A default is never a measurement.
 *
 * Three times a column default has been presented as a fact, and each time it
 * moved somebody up or down a list they had not earned. This file is the
 * memory: every stat with a numeric default gets a case here proving that an
 * unmeasured listing is scored as an unknown rather than as an extreme.
 *
 * The direction of the harm alternates, which is exactly why "it looks fine"
 * is not a test. `avg_response_minutes` defaults to the scoring ceiling and
 * punished the new; `completion_rate` defaults to 100 and flattered them.
 */

let seq = 0;

function provider(stats: Partial<Provider["stats"]> = {}): Provider {
  seq += 1;
  return {
    id: `p${seq}`,
    displayName: `Provider ${seq}`,
    bio: "",
    photoUrl: null,
    categories: ["plumbing"],
    serviceAreas: ["lalitpur-4"],
    yearsExperience: 5,
    isVerified: true,
    idDocumentStatus: "verified",
    checks: ["id"],
    availability: "now",
    busyUntil: null,
    baseRate: 900,
    stats: {
      // The column defaults, exactly as a brand-new row carries them.
      ratingAvg: 0,
      ratingCount: 0,
      jobsCompleted: 0,
      completionRate: 100,
      avgResponseMinutes: 120,
      responseSamples: 0,
      lastActiveMinutesAgo: 5,
      jobsAccepted: 0,
      withdrawals: 0,
      overbookOffers: 0,
      overbookMisses: 0,
      offersMade: 0,
      offersAnswered: 0,
      ...stats,
    },
  };
}

describe("evidence is asked about in one place", () => {
  it("reads a fresh row as having measured nothing", () => {
    const fresh = provider().stats;
    expect(hasRating(fresh)).toBe(false);
    expect(hasResponse(fresh)).toBe(false);
    expect(hasCompletion(fresh)).toBe(false);
  });

  it("counts a timed reply rather than a finished job as response evidence", () => {
    /*
     * The catalogue card used to gate the response time on `jobsCompleted > 0`
     * while the ranking gated it on `responseSamples > 0`, so a screen and the
     * ranking behind it could answer differently about the same person.
     * Finishing work is not being timed answering an offer.
     */
    expect(hasResponse({ responseSamples: 0 })).toBe(false);
    expect(hasResponse({ responseSamples: 1 })).toBe(true);
  });

  it("counts jobs accepted, not completed, as completion evidence", () => {
    // Completion is finished-over-accepted. With nothing accepted there is no
    // rate, whatever the stored 100 says.
    expect(hasCompletion({ jobsAccepted: 0 })).toBe(false);
    expect(hasCompletion({ jobsAccepted: 3 })).toBe(true);
  });
});

describe("an unmeasured stat never scores as an extreme", () => {
  it("does not score a perfect completion rate for somebody with no record", () => {
    /*
     * THE FOURTH INSTANCE, and the one the audit found. `completion_rate`
     * defaults to 100, so an untouched listing scored 1.0 — the maximum — and
     * beat a real professional at 96% on that axis.
     */
    const unmeasured = scoreParts(provider());
    const real = scoreParts(
      provider({ completionRate: 96, jobsAccepted: 50, jobsCompleted: 48 }),
    );

    expect(unmeasured.completion).toBeLessThan(real.completion);
    expect(unmeasured.completion).toBeGreaterThan(0);
    expect(unmeasured.completion).toBeLessThan(1);
  });

  it("does not score zero response for somebody nobody has timed", () => {
    // 120 is exactly RESPONSE_CEILING_MINUTES, so the default landed on zero.
    const unmeasured = scoreParts(provider());
    expect(unmeasured.response).toBeGreaterThan(0);
    expect(unmeasured.response).toBeLessThan(1);
  });

  it("does not score zero rating for somebody nobody has rated", () => {
    // Handled by the Bayesian prior rather than a branch, but the property is
    // the same one and worth pinning beside the others.
    const unmeasured = scoreParts(provider());
    expect(unmeasured.rating).toBeGreaterThan(0);
  });

  it("still lets a measured bad record score worse than an unknown", () => {
    // The point is not to protect anybody — it is to stop a default deciding.
    const unknown = scoreParts(provider());
    const bad = scoreParts(
      provider({ completionRate: 40, jobsAccepted: 30, jobsCompleted: 12 }),
    );

    expect(bad.completion).toBeLessThan(unknown.completion);
  });

  it("still lets a measured fast reply beat an unknown", () => {
    const unknown = scoreParts(provider());
    const fast = scoreParts(
      provider({ avgResponseMinutes: 10, responseSamples: 25 }),
    );

    expect(fast.response).toBeGreaterThan(unknown.response);
  });
});

describe("every surface asks the same question", () => {
  /*
   * THE REGRESSION THIS FILE EXISTS FOR. `lib/provider/measured.ts` was added
   * to settle a disagreement between the catalogue card and the ranking, and
   * the card was then not changed — so it went on gating the response time on
   * `jobsCompleted > 0` while `scoreParts` gated it on `responseSamples`, and a
   * seeded professional with finished jobs and no timings had "~120 min" on
   * their card and a neutral score behind it.
   *
   * The test cannot render the card, so it pins the property the card must
   * follow: these two facts are independent, and only one of them is evidence
   * about replies.
   */
  it("treats finished jobs and timed replies as different evidence", () => {
    const finishedButNeverTimed = provider({
      jobsCompleted: 60,
      jobsAccepted: 62,
      responseSamples: 0,
      avgResponseMinutes: 120,
    });

    expect(hasResponse(finishedButNeverTimed.stats)).toBe(false);
    expect(hasCompletion(finishedButNeverTimed.stats)).toBe(true);

    // And the ranking agrees, which is the half that was already right.
    expect(scoreParts(finishedButNeverTimed).response).toBeGreaterThan(0);
    expect(scoreParts(finishedButNeverTimed).response).toBeLessThan(1);
  });
});

describe("an unmeasured overbooking record is not a measurement either", () => {
  /*
   * Same rule, a counter with no default at all. `overbook_misses` over
   * `overbook_offers` is the right measure and a small denominator makes it
   * vicious: one miss out of two offers reads as a 50% failure rate and is
   * statistically nothing. Offers are RARE BY CONSTRUCTION — a professional
   * only generates one by choosing to fit somebody in — so the floor is ten,
   * not the thirty a freely-generated signal would deserve.
   */

  it("does not count a record below the floor as a record", () => {
    expect(hasOverbookRecord({ overbookOffers: OVERBOOK_MIN_OFFERS - 1 })).toBe(
      false,
    );
    expect(hasOverbookRecord({ overbookOffers: OVERBOOK_MIN_OFFERS })).toBe(true);
  });

  it("changes ranking by nothing at nine offers and three misses", () => {
    // A 33% miss rate on paper. Three misses is a real number and nine offers
    // is not a sample, so it moves them nowhere at all.
    expect(
      overbookRankingPenalty(
        provider({ overbookOffers: 9, overbookMisses: 3 }).stats,
      ),
    ).toBe(0);
  });

  it("changes it at ten", () => {
    const penalty = overbookRankingPenalty(
      provider({ overbookOffers: 10, overbookMisses: 3 }).stats,
    );
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThanOrEqual(OVERBOOK_RANKING_PENALTY_MAX);
  });

  it("crosses the floor softly rather than as a cliff", () => {
    // At exactly ten offers with one miss the prior makes the rate 1/15, so
    // qualifying costs a fraction of the ceiling rather than the whole of it.
    const penalty = overbookRankingPenalty(
      provider({ overbookOffers: 10, overbookMisses: 1 }).stats,
    );
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(OVERBOOK_RANKING_PENALTY_MAX / 2);
  });

  it("never exceeds the ceiling, however bad the record", () => {
    expect(
      overbookRankingPenalty(
        provider({ overbookOffers: 40, overbookMisses: 40 }).stats,
      ),
    ).toBeLessThanOrEqual(OVERBOOK_RANKING_PENALTY_MAX);
  });

  it("costs at most half of what pulling out of a job costs", () => {
    /*
     * They turned up and were trying to take MORE work; somebody who withdraws
     * accepted a job and left the customer with nobody. Scoring the two the
     * same would teach every professional that the safe move is never to
     * offer, and the offer is the only reason the second customer got a slot.
     */
    expect(OVERBOOK_RANKING_PENALTY_MAX).toBeLessThanOrEqual(0.12 / 2);
  });

  it("scores somebody with no offers exactly like a clean record, and keeps them apart in the data", () => {
    const untested = provider({ overbookOffers: 0, overbookMisses: 0 });
    const clean = provider({ overbookOffers: 20, overbookMisses: 0 });
    expect(overbookRankingPenalty(untested.stats)).toBe(
      overbookRankingPenalty(clean.stats),
    );
    // Identical in the score is fine; indistinguishable in the data is not —
    // that is how a default becomes a fact. The dashboard reads the counts.
    expect(hasOverbookRecord(untested.stats)).toBe(false);
    expect(hasOverbookRecord(clean.stats)).toBe(true);
  });
});

describe("the card and the ranking read the same rating", () => {
  /*
   * A REGRESSION TEST FOR THE SPLIT THIS FILE EXISTS TO END, found again in
   * the place it started. Every card printed the raw `rating_avg` while
   * `scoreParts` ranked on the Bayesian one — so the two disagreed about the
   * same person in BOTH directions at once, and nobody could see it because
   * each surface was internally consistent.
   */

  it("does not destroy a short record with one bad job", () => {
    // Three jobs, one 1-star. Raw 3.67 reads as "avoid this person".
    const shown = displayRating({ ratingAvg: 11 / 3, ratingCount: 3 })!;
    expect(shown).toBeGreaterThan(4.3);
    expect(shown).toBeCloseTo(bayesianRating(11 / 3, 3), 10);
  });

  it("does not flatter a short record either", () => {
    // The prior pulls both ways, which is what makes it fair rather than kind.
    expect(displayRating({ ratingAvg: 5, ratingCount: 3 })!).toBeLessThan(4.7);
  });

  it("leaves a long record almost alone", () => {
    expect(displayRating({ ratingAvg: 4.88, ratingCount: 201 })!).toBeCloseTo(
      4.84,
      1,
    );
  });

  it("is exactly what scoreParts uses, on the same provider", () => {
    // The assertion that would have caught the original defect: one function,
    // asked by both, never two answers about one person.
    const p = provider({ ratingAvg: 4.9, ratingCount: 40 });
    expect(displayRating(p.stats)).toBe(
      bayesianRating(p.stats.ratingAvg, p.stats.ratingCount),
    );
  });

  it("says nothing at all when nobody has rated them", () => {
    // Not a prior printed as though it were earned — `hasRating` is the gate
    // and a screen with no evidence says so.
    expect(displayRating({ ratingAvg: 0, ratingCount: 0 })).toBeNull();
  });
});

describe("whether they answer an offer is measured, with a floor", () => {
  it("is not a record below the floor", () => {
    expect(hasAnsweredRecord({ offersMade: OFFER_MIN_SAMPLE - 1 })).toBe(false);
    expect(hasAnsweredRecord({ offersMade: OFFER_MIN_SAMPLE })).toBe(true);
  });

  it("has a floor because an offer is not something they generate", () => {
    /*
     * Unlike a withdrawal or an overbooking offer, a first-choice offer HAPPENS
     * TO a professional. In a thin market it happens rarely, and a rate over
     * two offers would take work away from somebody who has barely been
     * offered any — which would then reduce their offers further.
     */
    expect(OFFER_MIN_SAMPLE).toBeGreaterThanOrEqual(10);
  });
});

describe("the fallback carries no authored statistics", () => {
  /*
   * THE SEED IS ALSO THE FALLBACK. `lib/data/providers.ts` renders these rows
   * whenever Supabase is unconfigured or unreachable, which is what makes a
   * fresh clone work — and it is why deleting the 94 reviews from the database
   * was only half the job. Leaving the JSON alone would have meant an outage
   * serving every invented 4.8 and 231-jobs-completed straight back.
   *
   * The 28 provider rows themselves are still fiction and still an open
   * blocker (`seed-providers-and-reviews`). What this pins is that they carry
   * no MEASUREMENTS: every denominator is zero, so `hasRating`, `hasResponse`
   * and `hasCompletion` all answer no and every surface says so.
   */

  it("has no reviews at all", () => {
    expect(reviewSeed).toHaveLength(0);
  });

  it("gives every seeded provider an empty record rather than a good one", () => {
    for (const seeded of providerSeed as Array<{
      displayName: string;
      stats: Record<string, number>;
    }>) {
      expect(seeded.stats.ratingCount).toBe(0);
      expect(seeded.stats.ratingAvg).toBe(0);
      expect(seeded.stats.jobsCompleted).toBe(0);
      expect(seeded.stats.responseSamples).toBe(0);
    }
  });

  it("reads as unmeasured through the same gates every screen asks", () => {
    // Not a separate assertion about the JSON — the same functions the cards
    // call, so this cannot pass while a surface still prints something.
    for (const seeded of providerSeed as Array<{ stats: StatEvidence }>) {
      const stats = { ...seeded.stats, jobsAccepted: 0, responseSamples: 0 };
      expect(hasRating(stats)).toBe(false);
      expect(hasResponse(stats)).toBe(false);
      expect(hasCompletion(stats)).toBe(false);
      expect(displayRating({ ...stats, ratingAvg: 0 })).toBeNull();
    }
  });
});
