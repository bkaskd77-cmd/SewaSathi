/**
 * Was the triage right? The judgements, with no database anywhere near them.
 *
 * WHY THESE ARE HERE AND NOT BESIDE THE QUERY. They are rules about what
 * triage got right, so they belong with triage — and keeping them out of
 * `lib/data` is what lets a test reach them without dragging the Supabase
 * client in. `lib/data/triage-accuracy.ts` does the reading and calls these;
 * the same split `lib/config/guarantee.ts` has from `lib/data/claim-signals.ts`.
 *
 * NOTHING HERE HAS A THRESHOLD. No grade, no `GOOD_ENOUGH`, no opinion about
 * what a good agreement rate looks like — nobody has the rows to say yet, and
 * a constant would encode a guess as a standard. These classify; they do not
 * judge.
 */

/* ------------------------------------------------------------------ *
 * The pure classifications
 * ------------------------------------------------------------------ */

/**
 * Did the customer book what the triage said?
 *
 * A DISAGREEMENT IS NOT AUTOMATICALLY A MISS, and the screen must never call
 * it one. The customer can read a correct answer and still book something
 * else: they decide the tap is not urgent after all, or the triage said
 * plumbing and they book the carpentry they were also putting off. What this
 * counts is agreement, and agreement is evidence rather than a verdict.
 */
export function categoryAgrees(
  predicted: string | null | undefined,
  booked: string | null | undefined,
): boolean | null {
  if (!predicted || !booked) return null;
  return predicted === booked;
}

export type BandOutcome = "inside" | "above" | "below";

/**
 * Did the settled amount land in the range the customer was shown?
 *
 * THIS IS A DIFFERENT QUESTION FROM `pricing-signals.ts`, which is worth being
 * precise about because the two look alike. That one asks whether OUR
 * published band is right, measured against `band_min` frozen on the booking.
 * This asks whether the range the TRIAGE CARD printed contained what the job
 * came to — the number a customer read before they had chosen anybody, and the
 * one they will remember if the final figure surprises them.
 *
 * Null when anything needed is missing: an unsettled job has no answer, and an
 * absent price range is a row that predates the column rather than a triage
 * that quoted nothing.
 */
export function bandOutcome(
  low: number | null | undefined,
  high: number | null | undefined,
  finalAmount: number | null | undefined,
): BandOutcome | null {
  if (low == null || high == null || finalAmount == null) return null;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (finalAmount < low) return "below";
  if (finalAmount > high) return "above";
  return "inside";
}

/**
 * What the two hazard detectors each said.
 *
 * THE COMPARISON THIS EXISTS FOR HAS NEVER BEEN POSSIBLE BEFORE. `hazard` on
 * the log records the OUTCOME — the text guard wins whenever both fire, so
 * `vision:*` only ever appears on rows where text found nothing. Agreement,
 * disagreement, and "text caught what vision missed" were all unmeasurable
 * from it. `text_hazard` and `vision_hazard` are each detector's own reading,
 * and this is what they are for.
 *
 * `notRecorded` IS NOT `neither`, and conflating them would be rule 6 exactly:
 * a row written before those columns existed is silent about what the
 * detectors saw, and reading that silence as "both found nothing" would
 * manufacture a clean record out of an absent one.
 */
export type HazardCase =
  /** Written before both readings were kept. Says nothing either way. */
  | "notRecorded"
  /** Both looked, neither found anything. */
  | "neither"
  /** Only the deterministic text guard fired. */
  | "textOnly"
  /** Only the model's read of the photo fired — text missed it. */
  | "visionOnly"
  /** Both fired, on the same hazard. */
  | "agreed"
  /** Both fired, on different hazards. */
  | "disagreed";

export function hazardCase(row: {
  textHazard: string | null;
  visionHazard: string | null;
  /** Needed only to tell an old row from a quiet one. */
  recorded: boolean;
}): HazardCase {
  if (!row.recorded) return "notRecorded";
  const text = row.textHazard;
  const vision = row.visionHazard;
  if (!text && !vision) return "neither";
  if (text && !vision) return "textOnly";
  if (!text && vision) return "visionOnly";
  return text === vision ? "agreed" : "disagreed";
}

export type HazardComparison = Record<HazardCase, number> & {
  /**
   * A photo arrived and nothing looked at it.
   *
   * Counted apart from the six above because it is not a detector reading at
   * all — it is the absence of one, on a journey where a customer was told so.
   */
  unseenPhoto: number;
  /** Rows considered, so every count above has its denominator. */
  total: number;
};

/* ------------------------------------------------------------------ *
 * How long it took
 * ------------------------------------------------------------------ */

/**
 * A middle, with the sample it came out of.
 *
 * THE MEDIAN AND NOT THE MEAN, for the reason every latency measurement wants
 * it: one 9.5-second timeout drags an average far enough to describe a product
 * nobody experienced. And `total` rides along for the same reason it does on a
 * `Tally` — "1,900ms" over four requests is an anecdote, and a screen printing
 * it beside "1,900ms" over nine hundred has quietly equated the two.
 */
export type Middle = { medianMs: number | null; total: number };

/**
 * Median of what was actually recorded.
 *
 * PURE, AND IT LIVES HERE RATHER THAN BESIDE THE QUERY for the reason the rest
 * of this file does: `lib/data/triage-accuracy.ts` is `server-only`, so a
 * helper written there is a helper no unit test can reach. That has now
 * happened twice in this product — `claimRateWorthReading` and these very
 * classifications — and both times the fix was the move, not a mock.
 *
 * An empty sample is `null`, never 0: nothing measured is not "instant".
 */
export function middleOf(samples: number[]): Middle {
  const usable = samples.filter((n) => Number.isFinite(n));
  if (usable.length === 0) return { medianMs: null, total: 0 };
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 1
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { medianMs, total: sorted.length };
}
