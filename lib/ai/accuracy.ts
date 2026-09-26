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

/* ------------------------------------------------------------------ *
 * Why the keyword matcher answered
 * ------------------------------------------------------------------ */

/**
 * A silent fallback is not one failure, it is five, and only one of them is
 * "nobody set the key".
 *
 * WHY THIS GROUPING EXISTS. For the whole life of this product every triage was
 * a fallback and the cause was always the same missing environment variable, so
 * "fallback" and "no key" were the same fact and nothing needed to tell them
 * apart. The moment a key is live that stops being true, and the interesting
 * case becomes the one that looks like success: the key is set, the presence
 * check is green, and every answer is still the matcher.
 *
 * Each of these has a different fix, which is the test for whether a
 * distinction is worth a name:
 *
 * - `noKey` — add an environment variable.
 * - `keyRejected` — rotate a credential. The key is *present*, so every
 *   configuration check in this product reports it as fine.
 * - `providerFailed` — usually nothing; it recovers. Worth counting because a
 *   rate that stops recovering is the signal.
 * - `answerRejected` — ours. The model replied and our own validation threw the
 *   reply away, which is a prompt or schema problem and the only one of the
 *   five fixed in this repository.
 * - `notRecorded` — rule 6. Written before the column existed.
 */
export type FallbackCause =
  | "notRecorded"
  | "noKey"
  | "keyRejected"
  | "providerFailed"
  | "answerRejected";

export type FallbackTally = Record<FallbackCause, number> & {
  /** Fallback rows considered, so every count above has its denominator. */
  total: number;
};

/**
 * Group a logged reason into its cause.
 *
 * `recorded` tells an old row from a new one, exactly as `hazardCase` does, and
 * for the same reason: a null `reason` on a row written before the column is
 * silence, and reading it as `noKey` would invent a diagnosis. Those fifteen
 * rows almost certainly WERE `noKey` — there was no key — but "almost certainly"
 * is not a measurement, and a screen that prints it as one is the thing rule 6
 * exists to stop.
 *
 * Returns null for a reason that is not a fallback at all (`ok`, `cache-hit`):
 * those rows were served by the model and have no cause to explain.
 */
export function fallbackCause(row: {
  reason: string | null;
  recorded: boolean;
}): FallbackCause | null {
  if (!row.recorded) return "notRecorded";
  switch (row.reason) {
    // Not a fallback. The model answered, or a model answer was replayed.
    case "ok":
    case "cache-hit":
      return null;
    case "no-api-key":
      return "noKey";
    case "auth-rejected":
      return "keyRejected";
    case "timeout":
    case "rate-limited":
    case "provider-error":
      return "providerFailed";
    case "unparseable":
      return "answerRejected";
    /*
     * A reason we do not recognise, or none on a row that should have one. Not
     * `noKey` and not `providerFailed`: a value this function has never seen is
     * something nobody has diagnosed, which is what `notRecorded` means.
     */
    default:
      return "notRecorded";
  }
}

/**
 * Did the fallback fire with a key in place?
 *
 * THE FLAG, AND THE WHOLE POINT OF THE GROUPING ABOVE. "No key" is a setup step
 * nobody has done. Anything else on this list means the product is configured,
 * looks configured to every check we have, and is still answering from the
 * keyword matcher — which is a different failure and a more expensive one,
 * because nothing about it looks wrong.
 *
 * `notRecorded` is false: not knowing is not evidence of a key. Saying "this
 * fired despite a key" about a row nobody diagnosed would raise an alarm out of
 * an absence.
 */
export function firedDespiteKey(cause: FallbackCause | null): boolean {
  return (
    cause === "keyRejected" ||
    cause === "providerFailed" ||
    cause === "answerRejected"
  );
}
