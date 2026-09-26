import type { Locale } from "@/i18n/routing";
import type { TriageCopy } from "@/lib/ai/copy";
import {
  triageProblem as keywordTriage,
  type TriageResult,
} from "@/lib/ai/mockTriage";
import type { TriageReason } from "@/lib/ai/reason";
import { applySafetyFloor } from "@/lib/ai/safety";

/**
 * Triage, from the browser's point of view.
 *
 * Same shape the mock returned in Phase 2 — a `TriageResult` — so the hero did
 * not have to learn anything new except that it now takes time and can carry a
 * photo. The Anthropic key is never here: this posts to /api/triage.
 *
 * It does not throw and it does not return null. Offline, rate limited, API
 * down, request aborted mid-flight — anything that is not a real answer from
 * the server becomes the keyword matcher running locally, with the same safety
 * floor applied. The person always gets something.
 *
 * The caller passes the copy for both because this path runs with no network:
 * the safety lines and the keyword explanations have to already be in the
 * browser, in the reader's language, before the request that failed was ever
 * made.
 */

export type { TriageResult, Urgency } from "@/lib/ai/mockTriage";
export { categoryName, categoryCtaLabel } from "@/lib/ai/mockTriage";

export type TriageImage = {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** Base64, no data: prefix. */
  data: string;
};

export type TriageSource = "claude" | "cache" | "fallback";

/**
 * Why this answer came from where it did.
 *
 * RE-EXPORTED, NOT DECLARED. This union used to be written out here AND again
 * inside `app/api/triage/route.ts`, and the two had already drifted — the
 * route's copy was missing `unreachable` and `rejected`. Nothing broke, because
 * the route cannot produce those two, and that is exactly what makes the
 * duplication dangerous: the drift was invisible and the next value would have
 * gone into whichever file somebody had open. `lib/ai/reason.ts` is the one
 * declaration, and it is a contract rather than an internal detail — the route
 * sends these strings over the wire and the badge looks up copy by them.
 */
export type { TriageReason };

/** One product inside the trade, as a customer reads it. */
export type SubBandChoice = {
  slug: string;
  /** Already in the reader's language. The server picked the side. */
  label: string;
  /** The published range for this product, researched and dated. */
  low: number;
  high: number;
};

export type TriageOutcome = {
  result: TriageResult;
  source: TriageSource;
  reason: TriageReason;
  /**
   * The choices for "which of these is it?", or empty when there is nothing
   * to ask: the triage already named the product, the trade is priced by
   * survey, or we never reached the server at all.
   *
   * Empty is the ordinary answer and the card renders no question for it —
   * the ask must never appear as a row of nothing.
   */
  subBands: SubBandChoice[];
  /**
   * The `triage_logs` row this answer was written to, when it was written.
   *
   * Carried onto the booking link so a booking can point back at the triage
   * that produced it — the join the accuracy loop reads. Null on every path
   * that did not log: unconfigured, timed out, failed, or the local fallback
   * that never reached the server at all. A null simply means this booking
   * cannot be attributed, never that anything went wrong for the customer.
   */
  triageLogId: string | null;
  /** Present only when Claude answered. For the dev badge. */
  model?: string | null;
};

function localFallback(
  text: string,
  copy: TriageCopy,
  reason: TriageReason,
  photoUnseen = false,
): TriageOutcome {
  return {
    // Same floor as the server applies, including the note when a photo was
    // attached and nothing ever looked at it — which is precisely what this
    // path means.
    result: applySafetyFloor(text, keywordTriage(text, copy), {
      copy: copy.safety,
      photoUnseen,
    }).result,
    source: "fallback",
    // Never reached the server, so nothing was logged and there is nothing to
    // attribute a later booking to. The booking still works; it is simply not
    // traceable back to a triage, which is the honest record of what happened.
    triageLogId: null,
    reason,
    /*
     * NO ASK ON THIS PATH, and it is the honest answer rather than a gap.
     * This runs when the browser could not reach us at all, so there are no
     * live labels to offer. A server-side fallback — no API key, a timeout —
     * still comes back through the response and still carries them, which is
     * the case that actually matters: that is where the matcher names a
     * product least often.
     */
    subBands: [],
  };
}

export async function triageProblem(
  input: string,
  options: {
    /** The reader's language. Sent to the server, and used by the fallback. */
    locale: Locale;
    copy: TriageCopy;
    image?: TriageImage | null;
    signal?: AbortSignal;
  },
): Promise<TriageOutcome> {
  const text = input.trim();
  const image = options.image ?? null;
  const { copy, locale } = options;

  if (!text && !image) return localFallback("", copy, "rejected");

  try {
    const response = await fetch("/api/triage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: text || undefined,
        image: image ?? undefined,
        locale,
      }),
      signal: options.signal,
    });

    if (!response.ok)
      return localFallback(text, copy, "rejected", Boolean(image));

    const payload = (await response.json()) as {
      result?: TriageResult;
      source?: TriageSource;
      reason?: TriageReason;
      subBands?: SubBandChoice[];
      triageLogId?: string | null;
      model?: string | null;
    };

    if (!payload.result)
      return localFallback(text, copy, "unparseable", Boolean(image));
    return {
      result: payload.result,
      source: payload.source ?? "claude",
      reason: payload.reason ?? "ok",
      subBands: payload.subBands ?? [],
      triageLogId: payload.triageLogId ?? null,
      model: payload.model ?? null,
    };
  } catch (error) {
    // An abort is the caller replacing this run with a newer one, not a
    // failure — it must not paint a fallback result over the new query.
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    return localFallback(text, copy, "unreachable", Boolean(image));
  }
}
