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
/**
 * How much history counts as "now" for a band proposal.
 *
 * IT IS THE OTHER HALF OF `MIN_PROPOSAL_SAMPLE` and belongs beside it: widening
 * the window reaches the minimum sooner on older evidence, narrowing it holds out
 * for newer evidence and may never reach the minimum at all. Changing either
 * number without the other is how a proposal comes to describe last year.
 *
 * 180 days is `docs/PRICING-BANDS.md § 4`'s figure: long enough that a trade
 * doing a few jobs a week clears 30, short enough to exclude a Kathmandu price
 * from two monsoons ago.
 */
export const PROPOSAL_WINDOW_DAYS = 180;


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
 * IT DOES NOT APPLY TO A BAND A PERSON STATES, and that is why the word COMPUTED
 * is in the first line. The cap exists to stop a bad SAMPLE moving a price, not
 * to stop a person fixing a price they already know is wrong: AC servicing was
 * wrong at both ends by more than a fifth — floor above an ordinary service,
 * ceiling below a gas refill — and making that take four approval cycles would be
 * the guard working against the thing it is for.
 *
 * THAT DISTINCTION USED TO BE A `mode` PARAMETER ON `proposeBand` AND NOTHING EVER
 * PASSED IT. It was written, commented at length against this constant, and had no
 * caller anywhere — the no-caller sin, one module over from `applyRedoRecovery`.
 * It would not have closed the gap either: lifting the cap still leaves
 * `MIN_PROPOSAL_SAMPLE`, so with no settled jobs it returned null exactly as the
 * routine path does, and the case it named — a band known to be wrong on day one —
 * is precisely the case with no sample. `statedBandRefusal` below is the human
 * path, and it is a different shape rather than a flag on this one: a stated band
 * has no sample, no quartiles and no winsorised count, so there is nothing for
 * `proposeBand` to return.
 */
export const MAX_REVISION_MOVE = 0.2;

/**
 * Published prices are round. A band ending in 37 reads as a machine's output.
 *
 * EXPORTED BECAUSE IT IS ALSO THE MINIMUM WIDTH OF A BAND, which the screen has
 * to be able to say out loud — see `statedBandRefusal`. A copy of the number in
 * a message catalogue would be one list written twice, and it would go stale
 * silently: the copy renders perfectly whatever this says.
 */
export const BAND_ROUNDING = 100;
const ROUNDING = BAND_ROUNDING;

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

  const capped = {
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

/* ------------------------------------------------------------------ *
 * A proposal somebody has already turned down
 * ------------------------------------------------------------------ */

/**
 * How much more evidence makes a rejected proposal worth showing again.
 *
 * WHY THE SAMPLE NEEDS A CLAUSE AT ALL. A rejection can mean two different
 * things and the screen cannot tell them apart: *this number is wrong because
 * the category is two different jobs* (a model objection — more data producing
 * the same number answers nothing), or *too soon, come back with more jobs* (a
 * sample objection, which more data does answer). Suppressing on the number
 * alone would strand the second kind for ever; suppressing on the sample alone
 * would re-offer the first kind every time a job settled.
 *
 * HALF AGAIN, because it has to be a genuinely different sample rather than one
 * more job. At the 30-job minimum that is 15 more settled jobs, which on this
 * product's volume is a season rather than a week — long enough that somebody
 * looking again is looking at new evidence, not at the same screen.
 */
export const REJECTION_SAMPLE_GROWTH = 0.5;

/** What a rejection recorded, as `proposalSuppressedBy` needs to read it. */
export type RejectedProposal = {
  proposedLow: number;
  proposedHigh: number;
  /** The sample the rejected proposal was computed from. */
  sample: number;
};

/**
 * Is this proposal the one somebody already said no to?
 *
 * THE RULE, STATED RATHER THAN IMPLIED. A rejection suppresses a later proposal
 * while BOTH hold:
 *
 *   1. the proposed pair is identical to the rejected pair, and
 *   2. the sample has not grown by `REJECTION_SAMPLE_GROWTH`.
 *
 * NO MARGIN, AND NOTHING TO TUNE — which is the point of comparing the pair
 * exactly. `proposeBand` has already rounded both bounds outward to `ROUNDING`,
 * so two proposals are either the same published numbers or at least Rs 100
 * apart: "materially different" is a property of the output rather than a
 * threshold somebody has to pick, defend and later be suspicious of. Any band
 * tuning constant in this file is a product decision with a paragraph beside it;
 * this one did not need to exist.
 *
 * `Math.ceil` on the growth so the bar is never cleared by rounding: at a sample
 * of 31 the threshold is 47, not 46.5 rounded down to a number 47 jobs already
 * passed.
 */
export function proposalSuppressedBy(
  rejection: RejectedProposal,
  proposal: Pick<BandProposal, "low" | "high" | "sample">,
): boolean {
  const samePair =
    proposal.low === rejection.proposedLow &&
    proposal.high === rejection.proposedHigh;
  if (!samePair) return false;

  const enoughNewEvidence =
    proposal.sample >= Math.ceil(rejection.sample * (1 + REJECTION_SAMPLE_GROWTH));
  return !enoughNewEvidence;
}

/* ------------------------------------------------------------------ *
 * Which settled jobs are market prices
 * ------------------------------------------------------------------ */

/**
 * Does a guarantee visit's price belong in a band proposal?
 *
 * PURE AND HERE RATHER THAN INSIDE THE READ, because this is a judgement about
 * money and a judgement written inside a `server-only` module is one no unit test
 * can reach — a mistake this project has now made five times (`claimRateWorthReading`,
 * `heldReasonFor`, `whyWaiting`…). The read composes it.
 *
 * `docs/PRICING-BANDS.md § 4` says "re-do visits" are excluded, flatly. THIS IS
 * NARROWER, DELIBERATELY, and the guarantee rules are what decide it: only a
 * `sameFault` visit is unpaid, and an unpaid return is not a market price. A
 * `differentProblem`, `nothingWrong` or `customerCaused` visit is "an ordinary
 * booking at the ordinary price" — the policy's own words — so excluding it would
 * throw away real evidence about what this trade charges.
 *
 * A VISIT WITH NO VERDICT IS EXCLUDED, which is rule 6 in the shape it takes for a
 * sample: nobody has said yet whether this was paid work, and unknown is not
 * evidence in either direction. It comes back into the sample the day somebody
 * records a verdict, because the read is computed on demand.
 */
export function visitPriceIsMarketPrice(verdict: string | null): boolean {
  if (verdict === null) return false;
  return verdict !== "sameFault";
}

/* ------------------------------------------------------------------ *
 * A band a person states, with no sample behind it
 * ------------------------------------------------------------------ */

/**
 * The most a STATED band may move either bound, as a multiple.
 *
 * WHY A BOUND AT ALL ON A FIGURE SOMEBODY TYPED ON PURPOSE. This is a typo
 * guard and nothing else. `lib/payments/pricing.ts` is the precedent and says
 * it plainly: 2x the quoted max is "chosen so an honest overrun fits and a
 * mistyped extra zero — 1,500 becoming 15,000 — cannot. It is a customer
 * protection, not a tuning knob." The dangerous slip on a band is the same one
 * in both directions — a zero too many (10x) or one too few (a tenth) — and
 * the band is what every future quote in the category is framed by, frozen onto
 * each booking by `freeze_booking_band()` as it is taken. A wrong band caught a
 * week later cannot be un-frozen off the bookings it quoted.
 *
 * FIVE RATHER THAN `pricing.ts`'s TWO, because the two numbers guard opposite
 * situations. There, the band is the reference and is assumed right, so an
 * overrun has to stay near it. Here the reference is a number we may have got
 * badly wrong, and fixing that is the entire purpose: AC servicing's recorded
 * case was wrong at both ends by more than a fifth, and a tight bound would
 * reproduce `MAX_REVISION_MOVE`'s problem on the one path that exists to escape
 * it. Five leaves the largest honest correction expressible while still sitting
 * below both spellings of a misplaced zero.
 *
 * IT REFUSES; IT DOES NOT CLAMP. Clamping would publish a number nobody typed,
 * which on a published price is worse than refusing — `proposeBand` may clamp
 * because a person then reads the clamped figure and approves it, and here there
 * is nobody left to read it. A correction larger than this is stated in two
 * steps, each with its own reason and its own audited row. Two steps of five is
 * twenty-five, so this is defeatable by anybody determined, and that is fine: a
 * typo does not happen twice with two different sentences typed beside it.
 */
export const STATED_BAND_MAX_FACTOR = 5;

/**
 * Why a stated band cannot be published, or null when it can be.
 *
 * PURE, AND HERE RATHER THAN IN THE DATA LAYER, for the reason
 * `visitPriceIsMarketPrice` above states and this project has now recorded six
 * times: a judgement about money written inside a `server-only` module is one no
 * unit test can reach.
 *
 * `noCurrentBand` IS A REFUSAL AND NOT A SKIP. With no usable published pair
 * there is nothing to measure a correction against, so the typo guard cannot
 * run — and a guard that cannot run must never read as a guard that passed,
 * which is rule 6 in the shape it takes for a gate. `capMove` returns the
 * proposal unchanged in that case because a person then reads it; nobody reads
 * this one.
 */
export type StatedBandRefusal =
  | "notWholeRupees"
  | "notPositive"
  | "tooNarrow"
  | "tooBigAJump"
  | "noCurrentBand";

export function statedBandRefusal(
  stated: { low: number; high: number },
  current: { low: number; high: number },
): StatedBandRefusal | null {
  if (!Number.isInteger(stated.low) || !Number.isInteger(stated.high)) {
    return "notWholeRupees";
  }
  if (stated.low <= 0 || stated.high <= 0) return "notPositive";

  /*
   * THE MINIMUM WIDTH IS `ROUNDING`, BORROWED DELIBERATELY. A band whose floor
   * meets its ceiling is a fixed price rather than a band: "inside the quoted
   * band" would have measure zero, so every job would land either exactly on the
   * number or over it, and `lib/payments/pricing.ts`'s three outcomes would
   * collapse to two. `proposeBand` already holds its own output one step apart
   * for the same reason, and using the same constant is what stops the two paths
   * publishing bands of different minimum width — which would make "inside the
   * band" mean different things depending on who set it.
   *
   * NOTHING IS ROUNDED, THOUGH, which is the one place a stated band
   * deliberately departs from a computed one. `proposeBand` rounds to Rs 100
   * because a band ending in 37 reads as a machine's output; a person typing
   * 1,250 means 1,250, and quietly publishing 1,200 or 1,300 instead would be
   * the screen showing one number and the catalogue carrying another.
   */
  if (stated.high - stated.low < ROUNDING) return "tooNarrow";

  const usable = (n: number) => Number.isFinite(n) && n > 0;
  if (!usable(current.low) || !usable(current.high)) return "noCurrentBand";

  const within = (next: number, now: number) =>
    next <= now * STATED_BAND_MAX_FACTOR &&
    next >= now / STATED_BAND_MAX_FACTOR;

  if (!within(stated.low, current.low) || !within(stated.high, current.high)) {
    return "tooBigAJump";
  }

  return null;
}
