import { describe, expect, it } from "vitest";

import {
  MAX_REVISION_MOVE,
  MIN_PROPOSAL_SAMPLE,
  STATED_BAND_MAX_FACTOR,
  proposeBand,
  statedBandRefusal,
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

  it("caps every sample, and leaves the escape to the person", () => {
    /*
     * THE CAP IS AGAINST A BAD SAMPLE, NOT AGAINST A PERSON — and this case used
     * to prove that by passing `mode: "correction"`, a parameter nothing in the
     * product ever passed. Asserting a dead branch is how a no-caller feature
     * survives in a green suite, so the escape is asserted where it now lives:
     * `proposeBand` caps unconditionally, `uncapped` is what the sample asked
     * for, and `statedBandRefusal` is the path a person takes instead.
     *
     * AC servicing was wrong at both ends by more than a fifth — floor above an
     * ordinary service, ceiling below a gas refill — which is still the case the
     * escape exists for, and it is the case with no sample at all.
     */
    const amounts = Array.from({ length: 50 }, () => 45_000);
    const computed = proposeBand({ amounts, current: CURRENT })!;

    expect(computed.capped).toBe(true);
    expect(computed.uncapped.high).toBeGreaterThan(computed.high);
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

/* ------------------------------------------------------------------ *
 * A band a person states
 * ------------------------------------------------------------------ */

describe("a band somebody states, with no sample behind it", () => {
  it("lets through the correction MAX_REVISION_MOVE was holding back", () => {
    /*
     * THE CASE THE WHOLE PATH EXISTS FOR, and the one `mode: "correction"` named
     * and could not serve. AC servicing was wrong at both ends by more than a
     * fifth; a fifth is `MAX_REVISION_MOVE`, so this correction is refused by the
     * computed path by construction, whatever the sample says.
     */
    const current = { low: 500, high: 12_000 };
    const beyondTheCap = {
      low: Math.round(current.low * (1 + MAX_REVISION_MOVE)) + 200,
      high: Math.round(current.high * (1 + MAX_REVISION_MOVE)) + 2_000,
    };

    expect(statedBandRefusal(beyondTheCap, current)).toBeNull();
  });

  it("refuses an extra zero in either direction", () => {
    /*
     * THE WHOLE JOB OF THE BOUND. 1,500 typed as 15,000 is the slip
     * `lib/payments/pricing.ts` names, and a missing zero is the same slip with
     * the decimal the other way — a floor at a tenth of its value quotes every
     * job in the category below cost.
     */
    const current = { low: 1_500, high: 6_000 };

    expect(statedBandRefusal({ low: 15_000, high: 60_000 }, current)).toBe(
      "tooBigAJump",
    );
    expect(statedBandRefusal({ low: 150, high: 600 }, current)).toBe(
      "tooBigAJump",
    );
  });

  it("measures each bound against its own published bound", () => {
    /* A floor pushed up to the old ceiling is a different band, not a wider one,
       and per-bound is what catches it — the pair as a whole still looks sane. */
    const current = { low: 350, high: 5_000 };

    expect(statedBandRefusal({ low: 4_000, high: 5_000 }, current)).toBe(
      "tooBigAJump",
    );
  });

  it("holds the bound at the factor rather than at a number", () => {
    /*
     * Written against the factor on purpose, which is the opposite of
     * `ACTIVITY_FLOOR`'s lesson and correct here: what is being pinned is that
     * the bound is MULTIPLICATIVE and symmetric, not where it happens to sit, so
     * a case built from a literal would say nothing about a category priced ten
     * times higher. The behaviour that must not drift — a zero is refused — is
     * pinned by the case above, with literals.
     */
    const current = { low: 1_000, high: 10_000 };
    const f = STATED_BAND_MAX_FACTOR;

    expect(
      statedBandRefusal({ low: 1_000 * f, high: 10_000 * f }, current),
    ).toBeNull();
    expect(
      statedBandRefusal({ low: 1_000 * f + 1, high: 10_000 * f }, current),
    ).toBe("tooBigAJump");
    expect(
      statedBandRefusal({ low: 1_000 / f, high: 10_000 / f }, current),
    ).toBeNull();
    expect(
      statedBandRefusal({ low: 1_000 / f - 1, high: 10_000 / f }, current),
    ).toBe("tooBigAJump");
  });

  it("refuses a floor that meets its ceiling", () => {
    /* A fixed price is not a band: "inside the quoted band" would have measure
       zero and `openPayment`'s three outcomes would collapse to two. That is a
       product change, not a price change. */
    const current = { low: 1_000, high: 4_000 };

    expect(statedBandRefusal({ low: 2_000, high: 2_000 }, current)).toBe(
      "tooNarrow",
    );
    expect(statedBandRefusal({ low: 2_000, high: 2_050 }, current)).toBe(
      "tooNarrow",
    );
    expect(statedBandRefusal({ low: 2_000, high: 2_100 }, current)).toBeNull();
  });

  it("publishes the figure typed, rounded to nothing", () => {
    /* The one deliberate departure from `proposeBand`, which rounds to Rs 100
       because a band ending in 37 reads as a machine's output. A person typing
       1,250 means 1,250, and publishing 1,300 instead would be the screen
       showing one number and the catalogue carrying another. */
    expect(
      statedBandRefusal({ low: 1_250, high: 4_370 }, { low: 1_000, high: 4_000 }),
    ).toBeNull();
  });

  it("refuses paisa and refuses nothing at all", () => {
    const current = { low: 1_000, high: 4_000 };

    expect(statedBandRefusal({ low: 1_200.5, high: 4_000 }, current)).toBe(
      "notWholeRupees",
    );
    expect(statedBandRefusal({ low: Number.NaN, high: 4_000 }, current)).toBe(
      "notWholeRupees",
    );
    expect(statedBandRefusal({ low: 0, high: 4_000 }, current)).toBe(
      "notPositive",
    );
    expect(statedBandRefusal({ low: -1_200, high: 4_000 }, current)).toBe(
      "notPositive",
    );
  });

  it("refuses rather than skips when there is no band to measure against", () => {
    /*
     * RULE 6 FOR A GATE. With no usable published pair the typo guard cannot run,
     * and a guard that cannot run must never read as a guard that passed.
     * `capMove` returns the figure unchanged in this case because a person then
     * reads it; nobody reads this one.
     */
    expect(statedBandRefusal({ low: 1_000, high: 4_000 }, { low: 0, high: 0 })).toBe(
      "noCurrentBand",
    );
    expect(
      statedBandRefusal(
        { low: 1_000, high: 4_000 },
        { low: 900, high: Number.NaN },
      ),
    ).toBe("noCurrentBand");
  });
});
