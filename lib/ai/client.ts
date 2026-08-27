import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { serverEnv } from "@/lib/env";

/**
 * The model SajiloKaam runs triage on.
 *
 * Triage decides urgency and a price band from a free-text or photographed
 * description — a judgement call where being wrong is expensive (a mis-scoped
 * emergency, a quote a provider can't honour), so this runs on the strongest
 * model rather than the cheapest.
 */
export const TRIAGE_MODEL = "claude-opus-5";

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
