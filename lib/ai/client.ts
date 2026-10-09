import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { serverEnv } from "@/lib/env/server";

/**
 * The model SajiloKaam runs triage on.
 *
 * Triage is a short classification with a price band attached, on a public
 * endpoint that pays per call and has to answer inside ten seconds — Sonnet is
 * the right shape for it. Thinking is left off for the same reason: the whole
 * job is one paragraph of judgement, and latency here is the product.
 *
 * The safety path does not depend on the model being clever: lib/ai/safety.ts
 * enforces it server-side whatever comes back.
 */
export const TRIAGE_MODEL = "claude-sonnet-4-6";

/** Enough for the JSON object and no more — the reply is four fields. */
export const TRIAGE_MAX_TOKENS = 400;

/**
 * Wall clock for one call. The route falls back to the keyword matcher when
 * this expires, so it is a promise to the user rather than a client setting:
 * an answer arrives within ten seconds, always.
 */
export const TRIAGE_TIMEOUT_MS = 9_500;

/**
 * And longer when a photograph is attached, because the two calls are not the same call.
 *
 * MEASURED, NOT GUESSED: `?deep=1` reports a text-only triage answering in 1,374ms, and a
 * request carrying a photograph has to push roughly a megabyte of base64 to Anthropic
 * before inference starts. Nine and a half seconds is comfortable for the first and tight
 * for the second — and a customer reported exactly that, a photograph the product admitted
 * it could not look at, on the second attempt in two days.
 *
 * THE FALLBACK IS WHY THIS IS SAFE RATHER THAN A GAMBLE. Nothing hangs: at the ceiling the
 * route still answers, from the keyword matcher, with the "we couldn't look at your photo"
 * line. And if the platform kills the function first, `triageProblem`'s own catch produces
 * the same sentence in the browser. Raising it can cost a longer wait and cannot cost an
 * answer.
 *
 * TWENTY-TWO SECONDS, UNDER THE ROUTE'S `maxDuration` OF 30, so our own timeout is what
 * fires and the failure stays one we can describe. A number above it would hand the
 * failure to the platform, which has no copy to show anybody.
 */
export const TRIAGE_PHOTO_TIMEOUT_MS = 22_000;

let cached: Anthropic | null = null;

/**
 * Lazily construct the Anthropic client.
 *
 * Lazy because `ANTHROPIC_API_KEY` is read on first use, not at import: a
 * missing key must not break `next build` or any page that never calls Claude.
 * Server-only — the key must never reach the browser.
 */
export function getAnthropic(): Anthropic {
  if (!cached) {
    cached = new Anthropic({ apiKey: serverEnv.anthropicApiKey });
  }
  return cached;
}

/** True when the Anthropic key is configured, for feature-gating the UI. */
export function hasAnthropicConfig(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
