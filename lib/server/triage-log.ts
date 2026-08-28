import "server-only";

import type { Hazard } from "@/lib/ai/safety";
import type { TriageResult } from "@/lib/ai/mockTriage";
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
  hazard: Hazard | null;
};

export function canLogTriage(): boolean {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

export async function logTriage(entry: TriageLogEntry): Promise<void> {
  if (!canLogTriage()) return;

  const write = createAdminClient()
    .from("triage_logs")
    .insert({
      user_id: entry.userId,
      // Trimmed, not anonymised: this is what the person typed and it is what
      // makes the row useful. Nothing else about them is stored here.
      input_text: entry.inputText.slice(0, 600) || null,
      had_photo: entry.hadPhoto,
      category: entry.result.category,
      urgency: entry.result.urgency,
      price_low: entry.result.priceRangeNPR[0],
      price_high: entry.result.priceRangeNPR[1],
      source: entry.source,
      model: entry.model,
      latency_ms: entry.latencyMs,
      hazard: entry.hazard,
    });

  try {
    const outcome = await Promise.race([
      write,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), LOG_TIMEOUT_MS),
      ),
    ]);

    if (outcome && outcome.error) {
      console.error("[triage] log write failed:", outcome.error.message);
    }
  } catch (error) {
    console.error("[triage] log write threw:", error);
  }
}
