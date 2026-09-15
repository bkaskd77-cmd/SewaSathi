import { describe, expect, it } from "vitest";

import type { Provider } from "@/lib/data/providers";
import { scoreParts } from "@/lib/data/ranking";
import { hasCompletion, hasRating, hasResponse } from "@/lib/provider";

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
