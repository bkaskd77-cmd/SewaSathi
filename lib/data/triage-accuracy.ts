import "server-only";

import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import {
  bandOutcome,
  categoryAgrees,
  fallbackCause,
  hazardCase,
  middleOf,
  type BandOutcome,
  type FallbackTally,
  type HazardComparison,
  type Middle,
} from "@/lib/ai/accuracy";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Was the triage right?
 *
 * WHY THIS DID NOT EXIST. Pricing has had a feedback loop for phases —
 * `pricing-signals.ts` measures whether a published band is wrong, and
 * `band-proposal.ts` winsorises a fenced sample before taking percentiles.
 * Triage had nothing. Every row of `triage_logs` was written and never read
 * back against what the customer actually did, so the one AI capability in the
 * product could not be told right from wrong, and therefore could not be
 * improved except by guessing.
 *
 * THIS MEASURES AND DOES NOT TUNE, WHICH IS THE WHOLE BRIEF. Nothing here
 * proposes a prompt change, moves a band or edits a keyword rule. There are no
 * thresholds, because a threshold is a claim about what "good" looks like and
 * nobody has the rows to make that claim yet. A number that cannot be read yet
 * says so rather than rendering a confident percentage.
 *
 * EVERY RATE CARRIES ITS DENOMINATOR, and that is not politeness. "61%" on
 * thirteen bookings is not a finding, and a screen that prints it beside "61%"
 * on nine hundred has quietly equated them. So the shape returned here is
 * always a count and a total; the ratio is the reader's to take, next to the
 * `n` it came from. Same rule as `bayesianRating` and `claimRateWorthReading`,
 * minus the judgement — those two decide something, and this decides nothing.
 */

/**
 * One aggregate that may not have been readable.
 *
 * `Readable<T>` in lib/data/readable.ts is the same rule for a LIST — one row
 * per category, and `rows: []` meaning "nothing" rather than "the query
 * broke". Everything here is a single object rather than a list, and
 * `rows: [theOneThing]` would be a list shape pretending. Same discipline,
 * different arity: a failed read is never an empty count, because "0% of
 * categories agreed" is not a shrug, it is bad news nobody measured.
 */
export type Counted<T> = { ok: true; value: T } | { ok: false; value: null };

export function uncounted<T>(): Counted<T> {
  return { ok: false, value: null };
}

/*
 * The judgements live in `lib/ai/accuracy.ts` — pure, testable without a
 * database, and re-exported here so a caller has one import for the whole
 * measurement rather than having to know which half a symbol lives in.
 */
export {
  bandOutcome,
  categoryAgrees,
  fallbackCause,
  firedDespiteKey,
  hazardCase,
  middleOf,
  type BandOutcome,
  type FallbackCause,
  type FallbackTally,
  type HazardCase,
  type HazardComparison,
  type Middle,
} from "@/lib/ai/accuracy";

/** A count against what it was counted out of. The ratio is never precomputed. */
export type Tally = { matched: number; total: number };



/** The three paths a triage answer can arrive by. */
export type TriageSourceKey = "claude" | "cache" | "fallback";

export type BySource<T> = Record<TriageSourceKey, T>;

const emptyTally = (): Tally => ({ matched: 0, total: 0 });
const bySource = <T>(make: () => T): BySource<T> => ({
  claude: make(),
  cache: make(),
  fallback: make(),
});

function isSource(value: unknown): value is TriageSourceKey {
  return value === "claude" || value === "cache" || value === "fallback";
}

/* ------------------------------------------------------------------ *
 * The read
 * ------------------------------------------------------------------ */

export type TriageAccuracy = {
  /**
   * How much of this is measurable at all.
   *
   * THE FIRST NUMBER ON THE SCREEN, because for the entire life of this
   * product it has been zero: `bookings.triage_log_id` had a column, a schema,
   * a flow-state slot and an insert, and nothing ever produced the value. A
   * screen that led with an accuracy percentage would have been reporting on
   * an empty set with a straight face.
   */
  coverage: Counted<{ bookings: number; attributed: number }>;
  /** Agreement between the predicted category and the booked one, by path. */
  category: Counted<BySource<Tally>>;
  /** Where the settled amount fell against the range the card printed. */
  band: Counted<BySource<Record<BandOutcome, number> & { total: number }>>;
  /** What each detector said, independently. */
  hazard: Counted<HazardComparison>;
  /** How many logs arrived by each path at all. */
  mix: Counted<BySource<number>>;
  /**
   * How long each path took, median.
   *
   * ON THE SAME SCREEN AS ACCURACY DELIBERATELY. The fallback is instant and
   * the model is not, so a path that is right more often and slower is a
   * trade-off somebody has to be able to see both halves of. Neither number
   * means anything without the other.
   */
  latency: Counted<BySource<Middle>>;
  /**
   * Why the keyword matcher answered, when it did.
   *
   * THE SECTION THAT EXISTS BECAUSE A KEY IS NOW LIVE. Until today every
   * fallback had the same cause — there was no key — so "how many fallbacks"
   * and "why" were the same number. They come apart the moment a key is set,
   * and the case worth catching is the one that looks like success: the key is
   * present, every configuration check reports it as fine, and the matcher is
   * still answering. `firedDespiteKey` is that distinction.
   */
  fallback: Counted<FallbackTally>;
};

export async function triageAccuracy(): Promise<TriageAccuracy> {
  const blank: TriageAccuracy = {
    coverage: uncounted(),
    category: uncounted(),
    band: uncounted(),
    hazard: uncounted(),
    mix: uncounted(),
    latency: uncounted(),
    fallback: uncounted(),
  };
  if (!hasSupabaseConfig()) return blank;

  try {
    const admin = createAdminClient();

    /*
     * Two reads rather than one join, because they answer different questions
     * over different populations. Hazard and the path mix are facts about
     * every triage, including the many that never became a booking. Category
     * and band need the pair.
     */
    const [{ data: logRows, error: logError }, { data: bookingRows }] =
      await Promise.all([
        /*
         * `category` and the price range are named here and read in the
         * booking loop below. OMITTING EITHER WOULD BE SILENT: every
         * comparison simply returns null and the screen reports nothing
         * measured, which looks exactly like having no data. The comment sits
         * above the call rather than inside it because
         * `tests/db/column-manifest.test.ts` parses every select against the
         * real schema and a comment inside the argument defeats it.
         */
        admin
          .from("triage_logs")
          .select(
            "id, source, category, price_low, price_high, had_photo, latency_ms, reason, hazard, text_hazard, vision_hazard, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(5_000),
        /*
         * NO `id`, NO `reference`, NO `customer_id`. Nothing here needs to name
         * a booking, and the narrow select is what makes the claim in
         * SECURITY.md exactly true rather than nearly: this function reads
         * aggregates over the whole table and cannot hand the screen a single
         * identifiable job.
         */
        admin
          .from("bookings")
          .select("category_slug, final_amount, triage_log_id")
          .not("triage_log_id", "is", null)
          .limit(5_000),
      ]);

    if (logError) {
      console.error(`[triage-accuracy] log read failed — ${describeError(logError)}`);
      return blank;
    }

    const logs = (logRows ?? []) as Record<string, unknown>[];
    const linked = (bookingRows ?? []) as Record<string, unknown>[];

    /*
     * THE CUTOVER, AND IT HAS TO BE DERIVED RATHER THAN HARD-CODED. A row
     * predates the two reading columns if neither was written — but so does a
     * row where both detectors genuinely found nothing, and those are the
     * overwhelming majority. Telling them apart by date would need a constant
     * nobody can verify later.
     *
     * So it is read from the data: the oldest row that has a reading is the
     * earliest point we know the columns were being written, and anything
     * before it is `notRecorded`. Conservative in the honest direction — it
     * can only ever report LESS as measured than truly was.
     */
    const firstRecordedAt = logs
      .filter((r) => r.text_hazard != null || r.vision_hazard != null)
      .map((r) => Date.parse(r.created_at as string))
      .reduce<number | null>(
        (oldest, at) => (oldest === null || at < oldest ? at : oldest),
        null,
      );

    /*
     * A SECOND CUTOVER, DERIVED THE SAME WAY AND SEPARATELY. `reason` and the
     * two hazard columns arrived in different migrations, so one date cannot
     * answer for both — using the hazard cutover here would report rows as
     * having an unrecorded reason when they have one, or worse the reverse.
     * Same rule, same direction of error: it can only ever call LESS measured
     * than truly was.
     */
    const firstReasonAt = logs
      .filter((r) => r.reason != null)
      .map((r) => Date.parse(r.created_at as string))
      .reduce<number | null>(
        (oldest, at) => (oldest === null || at < oldest ? at : oldest),
        null,
      );

    const fallback: FallbackTally = {
      notRecorded: 0,
      noKey: 0,
      keyRejected: 0,
      providerFailed: 0,
      answerRejected: 0,
      total: 0,
    };

    const hazard: HazardComparison = {
      notRecorded: 0,
      neither: 0,
      textOnly: 0,
      visionOnly: 0,
      agreed: 0,
      disagreed: 0,
      unseenPhoto: 0,
      total: logs.length,
    };
    const mix = bySource(() => 0);
    const latencies = bySource<number[]>(() => []);
    const byId = new Map<string, Record<string, unknown>>();

    for (const row of logs) {
      byId.set(row.id as string, row);
      const source = row.source;
      if (isSource(source)) {
        mix[source] += 1;
        const ms = row.latency_ms;
        // Null is a row that predates the column or a write that did not
        // record one. It is left out rather than counted as 0ms, which would
        // report the product as faster than it has ever been.
        if (typeof ms === "number" && Number.isFinite(ms)) latencies[source].push(ms);
      }

      if (row.hazard === "unseen-photo") hazard.unseenPhoto += 1;

      const recorded =
        firstRecordedAt !== null &&
        Date.parse(row.created_at as string) >= firstRecordedAt;

      /*
       * ONLY THE FALLBACK ROWS HAVE A CAUSE TO EXPLAIN. A model answer and a
       * cache replay are not failures, and counting them in the denominator
       * would make "how much of the fallback was a rejected key" read as a
       * share of all traffic — which is a smaller, more comforting number about
       * a different question.
       */
      if (row.source === "fallback") {
        fallback.total += 1;
        const cause = fallbackCause({
          reason: (row.reason as string | null) ?? null,
          recorded:
            firstReasonAt !== null &&
            Date.parse(row.created_at as string) >= firstReasonAt,
        });
        // Null means the row was not a fallback after all, which `source`
        // already ruled out — so it cannot happen here, and if it ever does it
        // is counted as undiagnosed rather than silently dropped.
        fallback[cause ?? "notRecorded"] += 1;
      }

      hazard[
        hazardCase({
          textHazard: (row.text_hazard as string | null) ?? null,
          visionHazard: (row.vision_hazard as string | null) ?? null,
          recorded,
        })
      ] += 1;
    }

    const category = bySource(emptyTally);
    const band = bySource(() => ({ inside: 0, above: 0, below: 0, total: 0 }));

    for (const booking of linked) {
      const log = byId.get(booking.triage_log_id as string);
      // Linked to a log outside the window read above. Counted in coverage,
      // not here: it is a row we did not look at, not a disagreement.
      if (!log) continue;
      const source = isSource(log.source) ? log.source : null;
      if (!source) continue;

      const agrees = categoryAgrees(
        log.category as string | null,
        booking.category_slug as string | null,
      );
      if (agrees !== null) {
        category[source].total += 1;
        if (agrees) category[source].matched += 1;
      }

      const outcome = bandOutcome(
        log.price_low as number | null,
        log.price_high as number | null,
        booking.final_amount as number | null,
      );
      if (outcome) {
        band[source][outcome] += 1;
        band[source].total += 1;
      }
    }

    const { count: allBookings } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true });

    return {
      coverage: {
        ok: true,
        value: { bookings: allBookings ?? 0, attributed: linked.length },
      },
      category: { ok: true, value: category },
      band: { ok: true, value: band },
      hazard: { ok: true, value: hazard },
      mix: { ok: true, value: mix },
      fallback: { ok: true, value: fallback },
      latency: {
        ok: true,
        value: {
          claude: middleOf(latencies.claude),
          cache: middleOf(latencies.cache),
          fallback: middleOf(latencies.fallback),
        },
      },
    };
  } catch (thrown) {
    console.error(`[triage-accuracy] threw — ${describeError(thrown)}`);
    return blank;
  }
}
