import { z } from "zod";

import type { TriageResult, Urgency } from "@/lib/ai/mockTriage";
import type { Hazard } from "@/lib/ai/safety";
import { FALLBACK_PRICE_BANDS, type PriceBand } from "@/lib/ai/price-bands";

/**
 * What we will accept back from the model.
 *
 * The prompt asks for JSON and nothing else, and models mostly comply — but
 * "mostly" is not a contract, and the thing on the other end of this is a
 * price quoted to a stranger. Anything that does not validate is discarded and
 * the caller falls back to the keyword matcher; a raw parse error must never
 * reach the person who typed "tap leaking".
 */

// The enum is built from the authored categories rather than the table: a
// category the code has never heard of cannot be rendered or routed to, so
// accepting one from the model would only push the failure downstream.
const SLUGS = FALLBACK_PRICE_BANDS.map((band) => band.slug) as [
  string,
  ...string[],
];

const FALLBACK_BAND_BY_SLUG = new Map(
  FALLBACK_PRICE_BANDS.map((band) => [band.slug, band]),
);

export const triageResponseSchema = z.object({
  category: z.enum(SLUGS),
  urgency: z.enum(["emergency", "soon", "routine"]),
  priceRangeNPR: z.tuple([z.number().finite(), z.number().finite()]),
  explanation: z.string().trim().min(10).max(400),
  // Optional so a response in the old four-key shape still validates rather
  // than dropping to the fallback — a missing hazard reads as "none", which is
  // the same thing the text guard would conclude on its own.
  hazard: z.enum(["gas", "burning", "live-wire", "none"]).optional(),
});

/**
 * Pull the JSON object out of a model response.
 *
 * Tolerates the two things that actually happen — a ```json fence, and a
 * sentence before the brace — without tolerating anything that would let a
 * half-parsed object through.
 */
function extractJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Nearest 100 rupees. Nobody quotes 1,847. */
function roundNpr(value: number): number {
  return Math.max(100, Math.round(value / 100) * 100);
}

/**
 * Validate and normalise. Returns null if the response is unusable.
 *
 * The price is clamped into the published band for the category it chose. The
 * band is in the prompt, so this only fires when the model ignored it — but
 * when it does, an invented 40,000 quote for a leaking tap is exactly the kind
 * of thing that ends up in a screenshot.
 */
export function parseTriageResponse(
  raw: string,
  bands: PriceBand[] = FALLBACK_PRICE_BANDS,
): { result: TriageResult; hazard: Hazard | null } | null {
  const bandBySlug = new Map(bands.map((band) => [band.slug, band]));
  const candidate = extractJson(raw);
  if (candidate === null) return null;

  const parsed = triageResponseSchema.safeParse(candidate);
  if (!parsed.success) return null;

  const { category, urgency, priceRangeNPR, explanation, hazard } = parsed.data;
  const band = bandBySlug.get(category) ?? FALLBACK_BAND_BY_SLUG.get(category);
  if (!band) return null;

  const [rawLow, rawHigh] = priceRangeNPR;
  const low = Math.min(rawLow, rawHigh);
  const high = Math.max(rawLow, rawHigh);

  const clampedLow = roundNpr(Math.min(Math.max(low, band.low), band.high));
  const clampedHigh = roundNpr(Math.min(Math.max(high, band.low), band.high));

  return {
    result: {
      category,
      urgency: urgency as Urgency,
      priceRangeNPR: [clampedLow, Math.max(clampedLow, clampedHigh)] as [
        number,
        number,
      ],
      explanation: explanation.replace(/\s+/g, " ").trim(),
    },
    // The urgency the model chose is not adjusted here. The hazard is passed
    // up as a signal and applySafetyFloor decides what it does — one place
    // makes that decision, whatever the source.
    hazard: hazard && hazard !== "none" ? hazard : null,
  };
}
