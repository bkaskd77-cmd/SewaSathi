import type { Locale } from "@/i18n/routing";
import type { TriageCopy } from "@/lib/ai/copy";
import {
  triageProblem as keywordTriage,
  type TriageResult,
} from "@/lib/ai/mockTriage";
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
 * Why this answer came from where it did. Server reasons come back in the
 * response; the two below it are the ones only the browser can know.
 */
export type TriageReason =
  | "ok"
  | "cache-hit"
  | "no-api-key"
  | "timeout"
  | "provider-error"
  | "unparseable"
  | "unreachable"
  | "rejected";

export type TriageOutcome = {
  result: TriageResult;
  source: TriageSource;
  reason: TriageReason;
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
    reason,
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
      model?: string | null;
    };

    if (!payload.result)
      return localFallback(text, copy, "unparseable", Boolean(image));
    return {
      result: payload.result,
      source: payload.source ?? "claude",
      reason: payload.reason ?? "ok",
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
