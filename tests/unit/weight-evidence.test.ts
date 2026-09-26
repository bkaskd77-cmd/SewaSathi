import { describe, expect, it } from "vitest";

import type { Provider } from "@/lib/data/providers";
import {
  EMERGENCY_WEIGHTS,
  RELEVANCE_WEIGHTS,
  scoreParts,
  weightEvidence,
} from "@/lib/data/ranking";

/**
 * Which weights are separating anybody, and which are resting on a prior.
 *
 * WHY THIS EXISTS. `rating` carries 0.30 — the largest term in the blend — and
 * `bayesianRating(0, 0)` returns the prior for every listing nobody has rated.
 * On the live data that is 29 of 30, so the biggest weight in the product adds
 * the same number to everybody and separates nobody. That is not a bug; it is
 * what honest degradation looks like. What was wrong is that it was invisible —
 * the only way to know was to read the ranking and then go and count rows.
 *
 * THE FAILURE THIS FILE GUARDS is a report that disagrees with the scorer. If
 * `weightEvidence` says "measured" about a term `scoreParts` is defaulting, the
 * number is worse than none: somebody retunes a weight believing it carries
 * evidence it does not. So the two are run over the SAME fixtures and compared,
 * rather than the two implementations being matched by eye — which is exactly
 * how the catalogue card and `scoreParts` came to gate the response time on
 * different columns and answer differently about the same person.
 */

function provider(over: Partial<Provider["stats"]> = {}): Provider {
  return {
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    serviceAreas: ["lalitpur-4"],
    availability: "now",
    isVerified: false,
    baseRate: 1000,
    stats: {
      ratingAvg: 0,
      ratingCount: 0,
      jobsCompleted: 0,
      completionRate: 0,
      avgResponseMinutes: 120,
      responseSamples: 0,
      lastActiveMinutesAgo: 10,
      jobsAccepted: 0,
      withdrawals: 0,
      overbookOffers: 0,
      overbookMisses: 0,
      offersMade: 0,
      offersAnswered: 0,
      ...over,
    },
  } as unknown as Provider;
}

/** Nobody has rated, booked or timed them. The live majority. */
const UNMEASURED = provider();
/**
 * WORKED, NEVER TIMED — and this fixture is the whole point of the comparison.
 *
 * Jobs completed but zero `responseSamples`. `hasResponse` says no; a check
 * written as `jobsCompleted > 0` says yes. Without somebody in this state the
 * two predicates agree on every fixture and a divergence between the report and
 * the scorer is invisible — which is exactly how the catalogue card and
 * `scoreParts` came to gate the response time on different columns and nobody
 * noticed. The first version of this file had no such fixture and did not
 * catch the bug when it was reintroduced on purpose.
 */
const WORKED_NEVER_TIMED = provider({
  ratingAvg: 4.4,
  ratingCount: 9,
  jobsCompleted: 12,
  jobsAccepted: 12,
  completionRate: 100,
  responseSamples: 0,
});

/** Every term has something behind it. */
const MEASURED = provider({
  ratingAvg: 4.6,
  ratingCount: 40,
  jobsCompleted: 38,
  jobsAccepted: 40,
  completionRate: 95,
  avgResponseMinutes: 15,
  responseSamples: 30,
});

describe("the report and the scorer cannot disagree", () => {
  /*
   * THE CENTRAL ASSERTION. For each term that can rest on a prior, the report's
   * verdict has to match whether `scoreParts` actually used the sentinel — run
   * on the same fixture, not compared by reading both functions.
   */
  it("calls a term measured exactly when scoreParts did not default it", () => {
    const unmeasuredParts = scoreParts(UNMEASURED);
    const measuredParts = scoreParts(MEASURED);

    // The sentinels, as `scoreParts` defines them.
    expect(unmeasuredParts.completion).toBe(0.5);
    expect(unmeasuredParts.response).toBe(0.5);
    // And the measured fixture reaches neither.
    expect(measuredParts.completion).not.toBe(0.5);
    expect(measuredParts.response).not.toBe(0.5);

    const alone = (p: Provider) =>
      Object.fromEntries(
        weightEvidence([p]).map((row) => [row.term, row.measured === 1]),
      );

    expect(alone(UNMEASURED)).toMatchObject({
      rating: false,
      completion: false,
      response: false,
    });
    expect(alone(MEASURED)).toMatchObject({
      rating: true,
      completion: true,
      response: true,
    });

    /*
     * THE CASE THAT CATCHES A DIVERGENCE. Somebody who has finished work and
     * has never been timed answering an offer: `scoreParts` uses the sentinel,
     * so the report must say unmeasured. A check on `jobsCompleted` instead of
     * `responseSamples` passes every other assertion in this file and fails
     * only here.
     */
    expect(scoreParts(WORKED_NEVER_TIMED).response).toBe(0.5);
    expect(alone(WORKED_NEVER_TIMED)).toMatchObject({
      response: false,
      // While the terms that DO have evidence still read as measured, so this
      // is pinning the one disagreement rather than a blanket "all false".
      rating: true,
      completion: true,
    });
  });

  /*
   * RATING IS THE ONE WORTH PINNING SEPARATELY, because its sentinel is not a
   * constant but a prior — `bayesianRating` pulls an unrated listing to the
   * mean rather than to a fixed 0.5. Two unrated professionals therefore score
   * IDENTICALLY on the largest term in the blend, which is the finding this
   * whole screen exists to surface.
   */
  it("shows the largest weight separating nobody when nobody is rated", () => {
    const a = scoreParts(provider());
    const b = scoreParts(provider({ jobsCompleted: 12, jobsAccepted: 12 }));
    expect(a.rating).toBe(b.rating);

    const rating = weightEvidence([UNMEASURED, provider()]).find(
      (row) => row.term === "rating",
    )!;
    expect(rating.measured).toBe(0);
    expect(rating.total).toBe(2);
  });
});

/**
 * Not every low number is an absence.
 */
describe("a true zero is a measurement", () => {
  /*
   * `volume` AT ZERO JOBS IS A FACT — they have completed none — and
   * `scoreParts` computes it straight from the count with no sentinel. Calling
   * it "no evidence" would be reading a true zero as an unknown, which is rule
   * 6 upside down: the rule exists to stop a DEFAULT being read as a fact, not
   * to stop a fact being read as a fact.
   */
  it("reports volume as measured even with no jobs", () => {
    expect(scoreParts(UNMEASURED).volume).toBe(0);

    const volume = weightEvidence([UNMEASURED]).find(
      (row) => row.term === "volume",
    )!;
    expect(volume.measured).toBe(1);
    expect(volume.canBeUnmeasured).toBe(false);
  });

  it("reports availability and proximity as facts, never unmeasured", () => {
    for (const term of ["availability", "proximity"] as const) {
      const row = weightEvidence([UNMEASURED]).find((r) => r.term === term)!;
      expect(row.measured).toBe(1);
      expect(row.canBeUnmeasured).toBe(false);
    }
  });

  it("marks exactly the three terms that have a sentinel", () => {
    const flagged = weightEvidence([UNMEASURED])
      .filter((row) => row.canBeUnmeasured)
      .map((row) => row.term)
      .sort();
    expect(flagged).toEqual(["completion", "rating", "response"]);
  });
});

describe("the shape a screen can read", () => {
  it("carries every term's weight and its denominator", () => {
    const rows = weightEvidence([UNMEASURED, MEASURED]);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.total).toBe(2);
      expect(row.measured).toBeLessThanOrEqual(row.total);
      expect(row.weight).toBe(RELEVANCE_WEIGHTS[row.term]);
    }
  });

  it("puts the heaviest weight first, because that is the question", () => {
    const rows = weightEvidence([MEASURED]);
    expect(rows[0].term).toBe("rating");
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].weight).toBeGreaterThanOrEqual(rows[i].weight);
    }
  });

  it("can report the emergency blend, where the weights differ", () => {
    const rows = weightEvidence([MEASURED], EMERGENCY_WEIGHTS);
    expect(rows[0].term).toBe("availability");
    expect(rows.find((r) => r.term === "rating")!.weight).toBe(0.12);
  });

  /*
   * NO LISTINGS IS NOT ZERO EVIDENCE. An empty set reports 0 of 0, which a
   * screen renders as "nothing to read" rather than as a term separating
   * nobody — the same distinction every other count in this product carries.
   */
  it("reports zero out of zero on an empty set", () => {
    const rows = weightEvidence([]);
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.total === 0 && row.measured === 0)).toBe(true);
  });
});
