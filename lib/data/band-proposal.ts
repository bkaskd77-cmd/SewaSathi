/**
 * What our own settled jobs suggest a category's band should be.
 *
 * NOTHING HERE APPLIES ANYTHING, and that is the design rather than an
 * omission. The band sets the quote, the quote anchors what gets agreed, and
 * those agreed figures are the rows this function reads — so a band that
 * adjusted itself would be measuring its own shadow, with no way in the data to
 * tell a real market move from the echo of its own last change. It is also
 * published copy, and it moves commission via `max(final_amount, quoted_min)`.
 * A person approves; see ARCHITECTURE.md and `docs/PRICING-BANDS.md`.
 *
 * THE STATISTIC, AND THE PROBLEM IT SOLVES. `percentile_cont` looks robust and
 * is not, at these sample sizes: with n = 30, p75 interpolates between the 22nd
 * and 23rd values, so three unusual jobs move it — and the unusual jobs here are
 * systematically large, one whole-flat deep clean among thirty bathrooms. So
 * the sample is fenced and winsorised before the percentiles are taken.
 *
 * Pure and dependency-free, like `ranking.ts` and `pricing-signals.ts`: it is a
 * product judgement about money and has to be testable without a database.
 */

/**
 * How many settled jobs a band must survive before our own data may challenge
 * it — and it depends on how much the band is worth trusting.
 *
 * A HIGH-CONFIDENCE BAND IS PROBABLY RIGHT, so disturbing it needs a solid
 * sample; the cost of a noisy proposal is a person being asked to approve a
 * worse number than the one they have. A LOW-CONFIDENCE BAND IS A GUESS —
 * carpentry's is anchored to a day rate because nobody publishes a call-out
 * price, pest control's residential floor is inference from commercial rates —
 * so the cost of leaving it unchallenged for another quarter is higher than the
 * cost of an early, noisier first look. A person approves either way, which is
 * what makes erring toward "show them sooner" safe.
 */
export const MIN_PROPOSAL_SAMPLE: Record<BandConfidence, number> = {
  high: 30,
  medium: 22,
  low: 15,
};

export type BandConfidence = "high" | "medium" | "low";

/** Tukey. A quarter of the sample can be arbitrarily large before Q3 moves. */
export const FENCE_IQR_MULTIPLIER = 1.5;

/**
 * The most a COMPUTED revision may move either bound.
 *
 * Robustness handles outliers; it does not handle a wrong model. A genuinely
 * bimodal category yields a proposal that is stable, robust and wrong, because
 * "one band" is the thing that does not fit. The cap means no one approval can
 * move a published price by more than a fifth on the strength of a sample, and
 * `winsorised` is the tell that sub-bands are the real answer.
 *
 * IT DOES NOT APPLY TO A HUMAN CORRECTION, and that distinction is the whole
 * point of `mode`. The cap exists to stop a bad SAMPLE moving a price, not to
 * stop a person fixing a price they already know is wrong. AC servicing was
 * wrong at both ends by more than a fifth — floor above an ordinary service,
 * ceiling below a gas refill — and making that take four approval cycles would
 * be the guard working against the thing it is for.
 */
export const MAX_REVISION_MOVE = 0.2;

/** Published prices are round. A band ending in 37 reads as a machine's output. */
const ROUNDING = 100;

export type BandProposal = {
  low: number;
  high: number;
  /** Settled jobs the proposal was computed from. */
  sample: number;
  /** How many were capped at a fence. A high count means the band is the wrong shape. */
  winsorised: number;
  /** Before the movement cap, so a reviewer can see what was held back. */
  uncapped: { low: number; high: number };
  /** True when the cap bit — worth saying on screen. */
  capped: boolean;
};

/** Linear-interpolated quantile on an already-sorted array. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];

  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

/** Outward, so rounding can only widen a band and never squeeze a real job out. */
function roundOut(low: number, high: number): { low: number; high: number } {
  return {
    low: Math.max(ROUNDING, Math.floor(low / ROUNDING) * ROUNDING),
    high: Math.max(ROUNDING * 2, Math.ceil(high / ROUNDING) * ROUNDING),
  };
}

/** Hold a revision inside ±MAX_REVISION_MOVE of what is published today. */
function capMove(proposed: number, current: number): number {
  if (!Number.isFinite(current) || current <= 0) return proposed;
  const floor = current * (1 - MAX_REVISION_MOVE);
  const ceiling = current * (1 + MAX_REVISION_MOVE);
  return Math.min(ceiling, Math.max(floor, proposed));
}

/**
 * A band proposal, or null when there is not enough evidence to make one.
 *
 * `amounts` is every settled `final_amount` in the category over the window.
 * Guarantee re-do visits are the caller's job to exclude — an unpaid return is
 * not a market price. Commission appeals are NOT excluded: an honest small job
 * is exactly the signal a floor should hear.
 */
export function proposeBand(input: {
  amounts: readonly number[];
  /** The band published today, which the movement cap is measured against. */
  current: { low: number; high: number };
  /** Governs the minimum sample. Defaults to the strictest. */
  confidence?: BandConfidence;
  /**
   * `computed` is the routine path and is capped. `correction` is a person
   * fixing a band they know is wrong, and is not — see `MAX_REVISION_MOVE`.
   */
  mode?: "computed" | "correction";
}): BandProposal | null {
  const clean = input.amounts
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (clean.length < MIN_PROPOSAL_SAMPLE[input.confidence ?? "high"]) {
    return null;
  }

  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  const iqr = q3 - q1;

  const lowerFence = q1 - FENCE_IQR_MULTIPLIER * iqr;
  const upperFence = q3 + FENCE_IQR_MULTIPLIER * iqr;

  /*
   * CAPPED, NOT DROPPED. A Rs 40,000 job happened, and discarding it would
   * throw away the evidence that the ceiling is not absurd. Capping stops that
   * one job SETTING the ceiling while keeping it in the count.
   */
  let winsorised = 0;
  const fenced = clean.map((amount) => {
    if (amount > upperFence) {
      winsorised += 1;
      return upperFence;
    }
    if (amount < lowerFence) {
      winsorised += 1;
      return lowerFence;
    }
    return amount;
  });

  const rounded = roundOut(quantile(fenced, 0.25), quantile(fenced, 0.75));

  const correcting = input.mode === "correction";
  const capped = correcting
    ? rounded
    : {
        low: capMove(rounded.low, input.current.low),
        high: capMove(rounded.high, input.current.high),
      };
  const final = roundOut(capped.low, capped.high);

  return {
    // A band whose floor met its ceiling is not a band; keep one step apart.
    low: Math.min(final.low, final.high - ROUNDING),
    high: final.high,
    sample: clean.length,
    winsorised,
    uncapped: rounded,
    capped: final.low !== rounded.low || final.high !== rounded.high,
  };
}
