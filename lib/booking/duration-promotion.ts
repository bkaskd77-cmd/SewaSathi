/**
 * When our guessed durations are replaced by what actually happened.
 *
 * WHAT THIS IS FOR. All 36 sub-band durations were authored `invented` —
 * nobody in Nepal publishes how long a tap leak takes — which is why no screen
 * prints one and why no job holds more than a day. The way out was always
 * "observe them", and nothing observed anything: `actual_working_minutes` was
 * recording elapsed time, `actual_elapsed_days` did not exist, and no code read
 * either. This is the loop that closes it.
 *
 * IT ACTS WITHOUT A PERSON, WHICH `proposeBand` MAY NOT, AND THE DIFFERENCE IS
 * WORTH STATING BECAUSE IT IS NOT CARELESSNESS. A band proposal is refused the
 * right to apply itself for two reasons: the band sets the quote, the quote
 * anchors what gets agreed, and the agreed figures are the rows the proposal
 * reads — so it would be measuring its own shadow — and it moves commission
 * through `max(final_amount, quoted_min)`. Neither holds here. What we publish
 * as a duration changes what the scheduler RESERVES; it does not change how
 * long the professional is actually on the tools, so the measurement is
 * independent of the published figure. And no duration touches a rupee.
 *
 * THE SPAN IS THE ONE PLACE THAT ARGUMENT IS WEAKER, and it is one of three
 * reasons its floor is higher: `estimated_elapsed_days` generates `booking_days`,
 * which is how much of a professional's week is held, which could in principle
 * shape how long a job takes. The other two are that a wrong span removes real
 * bookable capacity invisibly, and that a span is the number a customer plans
 * their life around.
 *
 * NO TIME WINDOW, deliberately, where `PROPOSAL_WINDOW_DAYS` is 180 for a band.
 * A price is a fact about a market and goes stale; how long it takes to clear a
 * blockage is a fact about the work and does not. What WOULD invalidate old
 * observations is redefining what a product means — and that is a new `slug`,
 * not a re-timing of this one, because `bookings.band_slug` is the identity
 * everything downstream joins on.
 *
 * Pure and dependency-free, like `ranking.ts` and `band-proposal.ts`: it is a
 * product judgement and has to be testable without a database.
 */

/** The two numbers, promoted on separate evidence and separate floors. */
export type DurationKind = "minutes" | "span";

/**
 * How many completions a sub-band must have before its own data replaces our
 * guess — and the two numbers are not the same answer.
 *
 * MINUTES: 12. The statistic is a median, so the figure only moves if a THIRD
 * of the sample is unusual; at twelve the median sits between the sixth and
 * seventh values. Lower than `MIN_PROPOSAL_SAMPLE`'s 15–30 on purpose, because
 * a wrong minutes figure costs a reservation — 90 minutes held where 120 was
 * right, bounded, invisible to everybody, and strictly better than the flat two
 * hours every booking held before durations existed. Being slow to improve a
 * reservation has a cost too, and it is the one we have been paying.
 *
 * SPAN: 20. A wrong span holds four days of a painter's week and four days of a
 * customer's home, takes real capacity out of the product, and nothing on any
 * screen tells it apart from a measurement. It is also the number a customer
 * plans around, and the one whose observation could be shaped by what we
 * scheduled. Three reasons to make it expensive, and the cost of the higher
 * floor is only that multi-day scheduling arrives later for painting, where it
 * has been off since the day the column existed.
 */
export const MIN_DURATION_SAMPLE: Record<DurationKind, number> = {
  minutes: 12,
  span: 20,
};

/**
 * Published durations are round. 47 minutes reads as a machine's output.
 *
 * Five rather than fifteen, because the shortest thing we sell is a 30-minute
 * inspection and rounding that to the quarter hour is a sixth of the job.
 */
export const MINUTES_ROUNDING = 5;

/** Tukey. A quarter of the sample can be arbitrarily large before Q3 moves. */
export const FENCE_IQR_MULTIPLIER = 1.5;

export type DurationEvidenceSet = {
  kind: DurationKind;
  /** Every plausible measurement for one sub-band. Order is irrelevant. */
  values: readonly number[];
  /** What is published today. */
  published: number;
  /** The published figure's provenance, for THIS number. */
  source: "invented" | "researched" | "observed";
};

export type DurationDecision =
  /** Nothing has been measured. Not "the guess is right" — nothing is known. */
  | { act: false; why: "no-evidence" }
  /** Measured, and not enough of it yet. `need` is how many more. */
  | { act: false; why: "below-floor"; need: number }
  /** Already published as this, from observation. Nothing left to do. */
  | { act: false; why: "settled" }
  | { act: true; to: number };

export type DurationProposal = {
  kind: DurationKind;
  sample: number;
  /** The median, rounded the way this kind is published. Null with no sample. */
  observed: number | null;
  published: number;
  /**
   * Values outside the Tukey fence.
   *
   * REPORTED AND NEVER REMOVED. For a band proposal the fence winsorises,
   * because percentiles at n = 30 are moved by three unusual jobs. A median is
   * already robust, so clamping would change nothing — which makes this purely
   * a SIGNAL, and the signal is that the sub-band is two different jobs wearing
   * one name. Painting's bimodality is the case that produced sub-bands in the
   * first place; this is how the next one shows itself.
   */
  unusual: number;
  /** The floor in force when this was computed, so an old row stays readable. */
  floor: number;
  decision: DurationDecision;
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

/**
 * The published shape of each kind.
 *
 * MINUTES round to the nearest 5. A SPAN ROUNDS DOWN, and that asymmetry is
 * the whole of the span's safety: an under-reserved span shows up as a job
 * running over, which somebody notices and can act on, where an over-reserved
 * one silently removes capacity nobody can see. So a sub-band genuinely split
 * between one day and two resolves to one, and stays there until the evidence
 * is unambiguous.
 */
function publishable(kind: DurationKind, median: number): number {
  if (kind === "span") return Math.max(1, Math.floor(median));
  return Math.max(
    MINUTES_ROUNDING,
    Math.round(median / MINUTES_ROUNDING) * MINUTES_ROUNDING,
  );
}

export function proposeDuration(input: DurationEvidenceSet): DurationProposal {
  const floor = MIN_DURATION_SAMPLE[input.kind];
  const sorted = [...input.values].sort((a, b) => a - b);
  const sample = sorted.length;

  if (sample === 0) {
    return {
      kind: input.kind,
      sample: 0,
      observed: null,
      published: input.published,
      unusual: 0,
      floor,
      decision: { act: false, why: "no-evidence" },
    };
  }

  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const spread = q3 - q1;
  const low = q1 - FENCE_IQR_MULTIPLIER * spread;
  const high = q3 + FENCE_IQR_MULTIPLIER * spread;
  const unusual = sorted.filter((v) => v < low || v > high).length;

  const observed = publishable(input.kind, quantile(sorted, 0.5));

  const decision: DurationDecision =
    sample < floor
      ? { act: false, why: "below-floor", need: floor - sample }
      : observed === input.published && input.source === "observed"
        ? { act: false, why: "settled" }
        : { act: true, to: observed };

  return {
    kind: input.kind,
    sample,
    observed,
    published: input.published,
    unusual,
    floor,
    decision,
  };
}

/**
 * Why a proposal did not act, as one word for a log and a screen.
 *
 * A CLOSED SET, because it is a check constraint on `duration_observations`
 * as well as a type — one list written twice, and the db suite compares them.
 * `LOGGABLE_REASONS` learned that lesson the expensive way: a value the column
 * refuses loses the row in the same statement that writes it.
 */
export const DURATION_OUTCOMES = [
  "applied",
  "below-floor",
  "settled",
] as const;

export type DurationOutcome = (typeof DURATION_OUTCOMES)[number];

/**
 * The outcome worth logging, or null when there is nothing to log.
 *
 * `no-evidence` RETURNS NULL AND IS NOT A ROW. Thirty-six sub-bands times two
 * kinds, nightly, with nothing measured, would be seventy-two rows a day
 * asserting that nothing happened — and `cron_runs` already records that the
 * sweep ran, which is the fact that was genuinely unobservable. A row per
 * sub-band that HAS evidence is a time series of the loop's reasoning, which is
 * the thing worth keeping.
 */
export function durationOutcome(
  decision: DurationDecision,
): DurationOutcome | null {
  if (decision.act) return "applied";
  if (decision.why === "no-evidence") return null;
  return decision.why;
}

/**
 * Does this completed booking count as evidence about its product?
 *
 * TWO EXCLUSIONS, AND THEY ARE THE SAME EXCLUSION.
 *
 * `inherited` is a guarantee visit copying the band of the job it is putting
 * right — the same fault revisited, so its duration describes a callback and
 * not the product. `band_source` exists partly to carry exactly this filter,
 * and its own comment says so.
 *
 * A NULL SOURCE GOES WITH IT, not as a borderline case but for the same
 * reason. There is one such row in production, a guarantee visit whose band was
 * copied before `claims.ts` carried the provenance, and with nothing recorded
 * there is no way to tell a callback from a fresh job. Rule 6: null is "not
 * recorded", and reading it as "fresh" would feed the loop a measurement
 * nothing can vouch for.
 *
 * Pure and shared, because the sweep and the screen both need it and a filter
 * written twice is two filters — `scoreParts` and the catalogue card diverged
 * exactly that way, which is why `lib/provider/measured.ts` exists.
 */
export function countsAsEvidence(input: {
  bandSource: string | null;
}): boolean {
  return input.bandSource !== null && input.bandSource !== "inherited";
}
