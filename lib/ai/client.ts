import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { serverEnv } from "@/lib/env";

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
