import "server-only";

import type { TriageResult } from "@/lib/ai/mockTriage";
import { isLoggableReason, type LoggableReason } from "@/lib/ai/reason";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Write one triage to `triage_logs`.
 *
 * Training data for Phase 9: are the bands right, which categories are we
 * missing, how often does the fallback stand in. Collecting it from day one is
 * the whole point — it cannot be backfilled.
 *
 * Two rules. It never blocks the answer for long (2s cap), and it never fails
 * the request: if the log write breaks, the person still gets their triage and
 * we get a line in the server log.
 *
 * Service role, because the table has no insert policy — the public anon key
 * must not be able to write rows into this or read what strangers typed.
 */

const LOG_TIMEOUT_MS = 2_000;

export type TriageLogEntry = {
  userId: string | null;
  inputText: string;
  hadPhoto: boolean;
  result: TriageResult;
  source: "claude" | "cache" | "fallback";
  model: string | null;
  latencyMs: number;
  /**
   * How the safety floor fired, as "<detector>:<hazard>" — "text:gas",
   * "vision:burning" — or "unseen-photo" when a photo was attached and never
   * looked at.
   *
   * THIS IS THE OUTCOME, NOT THE EVIDENCE, and the comment here used to claim
   * otherwise: that the prefix let "the two detectors be compared later
   * without a schema change". It does not. The text guard wins whenever both
   * fire, so `vision:*` appears only on rows where the text guard found
   * nothing — the column records which detector won. The two fields below are
   * what each one actually said.
   */
  hazard: string | null;
  /**
   * What the deterministic text guard found, whether or not it won.
   *
   * Null is "found nothing" here, because this is written on every path. A
   * null in the COLUMN can also mean the row predates it, which is a
   * distinction only a reader of old rows has to make — see the migration.
   */
  textHazard: string | null;
  /**
   * What the model read from the photo, whether or not it won.
   *
   * Null covers two different things and neither is "no hazard": the model
   * looked and saw nothing, or nobody looked at all — no photo, or the model
   * never answered. `hazard: "unseen-photo"` records the case where a photo
   * went unread, which is the one a customer is told about.
   */
  visionHazard: string | null;
  /**
   * Why this answer came from the path it did.
   *
   * WRITTEN NOW, AND COMPUTED-THEN-DISCARDED BEFORE. The route worked this out
   * on every request and sent it to the browser for the dev badge, so the only
   * reader was a developer with one card open. Nothing could count it, which
   * meant nothing could tell "the matcher answered because there is no key"
   * from "the matcher answered although there is one" — and the second is the
   * expensive failure, because every configuration check in the product reports
   * a present key as fine.
   *
   * Only reasons a server can produce are accepted: `unreachable` and
   * `rejected` come from the browser fallback and no row can carry one. The
   * column's check constraint says the same thing in SQL.
   */
  reason: LoggableReason;
};

export function canLogTriage(): boolean {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

/**
 * Returns the row's id, or null.
 *
 * NULL IS ORDINARY AND MUST STAY CHEAP. Logging is unconfigured, or the write
 * timed out, or it failed — in every one of those the person still gets their
 * triage and the card still works. The id is what lets the booking they make
 * point back at this row; it is an enhancement to the link, never a
 * precondition for answering, and nothing downstream may treat its absence as
 * an error.
 */
export async function logTriage(entry: TriageLogEntry): Promise<string | null> {
  if (!canLogTriage()) return null;

  const write = createAdminClient()
    .from("triage_logs")
    .insert({
      user_id: entry.userId,
      // Trimmed, not anonymised: this is what the person typed and it is what
      // makes the row useful. Nothing else about them is stored here.
      input_text: entry.inputText.slice(0, 600) || null,
      had_photo: entry.hadPhoto,
      category: entry.result.category,
      /*
       * WHICH PRODUCT, OR NULL. This is the column that answers whether
       * duration is the normal path or the exception, and it needs no
       * `band_source` beside it: `source` below already says claude, cache or
       * fallback, and a cache hit replays a model answer — so the derivation
       * is exact and a second column would be a second thing to keep in step.
       */
      band: entry.result.band,
      urgency: entry.result.urgency,
      price_low: entry.result.priceRangeNPR[0],
      price_high: entry.result.priceRangeNPR[1],
      source: entry.source,
      model: entry.model,
      latency_ms: entry.latencyMs,
      hazard: entry.hazard,
      text_hazard: entry.textHazard,
      vision_hazard: entry.visionHazard,
      /*
       * Guarded rather than trusted. A value outside the loggable set would be
       * refused by `triage_logs_reason_known` and take the whole insert with it
       * — losing the row, the id, and therefore the attribution of whatever
       * booking followed, to record a diagnostic. Null is already "not
       * recorded", so falling back to it costs a count and nothing else.
       */
      reason: isLoggableReason(entry.reason) ? entry.reason : null,
    })
    // The id is what lets a booking point back at the triage that produced
    // it. Without it `bookings.triage_log_id` stays null for ever and the
    // accuracy loop has no join — which is exactly what it was doing.
    .select("id")
    .single();

  try {
    const outcome = await Promise.race([
      write,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), LOG_TIMEOUT_MS),
      ),
    ]);

    if (outcome && outcome.error) {
      console.error("[triage] log write failed:", outcome.error.message);
      return null;
    }
    // A timeout resolves null: the write may yet land, but we have no id to
    // hand back and the answer is not waiting for one.
    return (outcome?.data?.id as string | undefined) ?? null;
  } catch (error) {
    console.error("[triage] log write threw:", error);
    return null;
  }
}
