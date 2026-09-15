import { describe, expect, it } from "vitest";

import {
  MAX_REVISION_MOVE,
  MIN_PROPOSAL_SAMPLE,
  proposeBand,
} from "@/lib/data/band-proposal";

/**
 * What our own settled jobs suggest a band should be.
 *
 * The property that matters most is the one in the first block: a handful of
 * large jobs must not drag the proposal. Plain percentiles look robust and are
 * not at these sample sizes — with n = 30, p75 interpolates between the 22nd
 * and 23rd values — and in this product the unusual jobs are systematically
 * large, which is the direction that inflates a floor and therefore a
 * commission basis.
 */

/** A plausible plumbing month: mostly small call-outs. */
function ordinary(n = 40): number[] {
  return Array.from({ length: n }, (_, i) => 800 + (i % 20) * 120);
}

const CURRENT = { low: 900, high: 4500 };

describe("a few large jobs cannot drag the proposal", () => {
  it("barely moves when four whole-flat jobs land among forty call-outs", () => {
    const base = proposeBand({ amounts: ordinary(), current: CURRENT })!;
    const withWhales = proposeBand({
      amounts: [...ordinary(), 38_000, 41_000, 45_000, 52_000],
      current: CURRENT,
    })!;

    expect(base).not.toBeNull();
    // Without fencing, four jobs at 10x would haul p75 upward hard.
    expect(withWhales.high).toBeLessThanOrEqual(base.high * 1.25);
    expect(withWhales.winsorised).toBeGreaterThan(0);
  });

  it("counts what it capped rather than hiding it", () => {
    // The count is the tell that a category is two products, not one band.
    const result = proposeBand({
      amounts: [...ordinary(), 38_000, 41_000, 45_000, 52_000],
      current: CURRENT,
    })!;

    expect(result.winsorised).toBe(4);
    expect(result.sample).toBe(44);
  });

  it("keeps the outlier in the sample count", () => {
    // Capped, not dropped: the job happened, and it is evidence the ceiling is
    // not absurd even when it must not set the ceiling.
    const result = proposeBand({
      amounts: [...ordinary(30), 90_000],
      current: CURRENT,
    })!;

    expect(result.sample).toBe(31);
  });
});

describe("no proposal without enough evidence", () => {
  it("returns null below the minimum sample", () => {
    expect(
      proposeBand({
        amounts: ordinary(MIN_PROPOSAL_SAMPLE.high - 1),
        current: CURRENT,
      }),
    ).toBeNull();
  });

  it("proposes once the minimum is met", () => {
    expect(
      proposeBand({ amounts: ordinary(MIN_PROPOSAL_SAMPLE.high), current: CURRENT }),
    ).not.toBeNull();
  });

  it("ignores rubbish amounts rather than counting them toward the minimum", () => {
    const amounts = [
      ...ordinary(MIN_PROPOSAL_SAMPLE.high - 1),
      0,
      -500,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    expect(proposeBand({ amounts, current: CURRENT })).toBeNull();
  });
});

describe("confidence governs how soon the data may speak", () => {
  /*
   * A high-confidence band is probably right, so disturbing it needs a solid
   * sample. A low-confidence one is a guess — carpentry anchored to a day rate
   * because nobody publishes a call-out price — so leaving it unchallenged
   * costs more than an early, noisier look. A person approves either way.
   */
  it("reaches a first proposal sooner on a low-confidence band", () => {
    const thin = ordinary(MIN_PROPOSAL_SAMPLE.low);

    expect(proposeBand({ amounts: thin, current: CURRENT, confidence: "low" }))
      .not.toBeNull();
    expect(proposeBand({ amounts: thin, current: CURRENT, confidence: "high" }))
      .toBeNull();
  });

  it("orders the thresholds strictest-first", () => {
    expect(MIN_PROPOSAL_SAMPLE.high).toBeGreaterThan(MIN_PROPOSAL_SAMPLE.medium);
    expect(MIN_PROPOSAL_SAMPLE.medium).toBeGreaterThan(MIN_PROPOSAL_SAMPLE.low);
  });

  it("defaults to the strictest when confidence is not given", () => {
    expect(
      proposeBand({ amounts: ordinary(MIN_PROPOSAL_SAMPLE.low), current: CURRENT }),
    ).toBeNull();
  });
});

describe("no single revision may leap", () => {
  it("holds a wild proposal inside the movement cap", () => {
    /*
     * A category where every job suddenly settles at ten times the band. The
     * statistic is working; the model is not. The cap is what stops one
     * approval moving a published price — and a commission basis — that far.
     */
    const result = proposeBand({
      amounts: Array.from({ length: 50 }, () => 45_000),
      current: CURRENT,
    })!;

    expect(result.high).toBeLessThanOrEqual(
      Math.ceil(CURRENT.high * (1 + MAX_REVISION_MOVE) * 1.01),
    );
    expect(result.capped).toBe(true);
  });

  it("says what it would have proposed without the cap", () => {
    // A reviewer needs to see what was held back, or the cap is just a lie
    // told quietly.
    const result = proposeBand({
      amounts: Array.from({ length: 50 }, () => 45_000),
      current: CURRENT,
    })!;

    expect(result.uncapped.high).toBeGreaterThan(result.high);
  });

  it("does not cap a human correcting a band they know is wrong", () => {
    /*
     * THE CAP IS AGAINST A BAD SAMPLE, NOT AGAINST A PERSON. AC servicing was
     * wrong at both ends by more than a fifth — floor above an ordinary
     * service, ceiling below a gas refill — and making that take four approval
     * cycles would be the guard working against the thing it exists for.
     */
    const amounts = Array.from({ length: 50 }, () => 45_000);

    const computed = proposeBand({ amounts, current: CURRENT })!;
    const correction = proposeBand({ amounts, current: CURRENT, mode: "correction" })!;

    expect(computed.capped).toBe(true);
    expect(correction.capped).toBe(false);
    expect(correction.high).toBeGreaterThan(computed.high);
    expect(correction.high).toBe(correction.uncapped.high);
  });

  it("does not report a cap when the data agrees with the published band", () => {
    // Quartiles of this sample are 1,700 and 3,200; the published band sits
    // inside the cap of both, which is what "the data agrees" means.
    const steady = Array.from({ length: 60 }, (_, i) => 1000 + (i % 30) * 100);
    const result = proposeBand({ amounts: steady, current: { low: 1800, high: 3000 } })!;

    expect(result.capped).toBe(false);
  });
});

describe("the proposal is always a usable band", () => {
  it("never returns a floor at or above its ceiling", () => {
    // Every job at one price is the degenerate case, and it is real: a
    // category with a single fixed-price service.
    const result = proposeBand({
      amounts: Array.from({ length: 40 }, () => 2000),
      current: { low: 1900, high: 2100 },
    })!;

    expect(result.low).toBeLessThan(result.high);
    expect(result.low).toBeGreaterThan(0);
  });

  it("rounds to whole hundreds so a published price never looks computed", () => {
    const result = proposeBand({
      amounts: ordinary(60).map((n) => n + 37),
      current: CURRENT,
    })!;

    expect(result.low % 100).toBe(0);
    expect(result.high % 100).toBe(0);
  });
});
