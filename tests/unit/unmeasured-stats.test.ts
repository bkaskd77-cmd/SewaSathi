import { describe, expect, it } from "vitest";

import type { Provider } from "@/lib/data/providers";
import {
  OVERBOOK_RANKING_PENALTY_MAX,
  overbookRankingPenalty,
  scoreParts,
} from "@/lib/data/ranking";
import {
  OVERBOOK_MIN_OFFERS,
  hasCompletion,
  hasOverbookRecord,
  hasRating,
  hasResponse,
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
