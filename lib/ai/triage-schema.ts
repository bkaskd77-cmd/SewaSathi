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
  /*
   * NULLABLE, AND THAT IS THE FIX FOR A BUG THAT RAN FOR A WHOLE PHASE.
   *
   * The prompt has asked the model for an `onTopic` verdict since the ceilings
   * shipped. It never said what to put in `category` when the answer is "this
   * is not a home-service problem", because there is nothing honest to put
   * there — and this enum was required. So every reply that correctly judged a
   * question off-topic failed `safeParse`, the whole object was discarded as
   * `unparseable`, the verdict went with it, and the keyword matcher printed
   * `GENERIC_RULE` — plumbing, "needed soon", Rs 900-4,000 — at somebody who
   * had pasted lorem ipsum. Seven rows in production on 2026-10-10.
   *
   * A PROMPT THAT ASKS FOR AN ANSWER THE SCHEMA REFUSES is the same class as a
   * list written twice: both halves were written carefully and nobody ran the
   * pair. `tests/unit/triage-schema.test.ts` now parses the exact shape the
   * prompt asks for, so the two cannot drift again.
   *
   * NULL IS ONLY EVER "NO TRADE NAMED", never a trade we failed to read: the
   * enum still refuses a slug we do not sell.
   */
  category: z.enum(SLUGS).nullish(),
  /*
   * Nullable for the same reason and only in company with a null category: an
   * urgency, a price and a band are all answers ABOUT a trade, and a reply that
   * named none has nothing to say about them. `parseTriageResponse` is what
   * holds them together — a null urgency beside a real category is a malformed
   * reply and is still refused.
   */
  urgency: z.enum(["emergency", "soon", "routine"]).nullish(),
  priceRangeNPR: z
    .tuple([z.number().finite(), z.number().finite()])
    .nullish(),
  /*
   * REQUIRED ON EVERY PATH, including the ones with no trade. It is the
   * sentence the person actually reads, and a refusal with no sentence is the
   * dead end `EmptyState` exists to prevent.
   */
  explanation: z.string().trim().min(10).max(400),
  // Optional so a response in the old four-key shape still validates rather
  // than dropping to the fallback — a missing hazard reads as "none", which is
  // the same thing the text guard would conclude on its own.
  hazard: z.enum(["gas", "burning", "live-wire", "none"]).optional(),
  /*
   * WHICH PRODUCT INSIDE THE TRADE. A `category_price_bands` slug.
   *
   * Deliberately a bare string here rather than an enum, and checked against
   * the chosen category's own sub-bands below. An enum would have to be the
   * union of all 36 slugs across all ten trades, which would happily accept
   * painting's `flat` on a plumbing job — and the whole value of this key is
   * that it says which product, so accepting the wrong one is worse than
   * accepting none.
   *
   * Optional, like `hazard`, and for the same reason: a reply in the older
   * shape must still validate rather than dropping a customer to the keyword
   * matcher over a key that only affects scheduling.
   */
  /*
   * `nullish`, NOT `optional`, and a test is what found that. The prompt tells
   * the model to return null when it cannot tell which product this is — the
   * "nothing fits" example in there literally contains `"band": null` — so
   * `optional()` alone would have refused every reply that followed our own
   * instructions and dropped that customer to the keyword matcher. A key added
   * to make scheduling better would have made triage worse.
   */
  band: z.string().trim().min(1).max(40).nullish(),

  /*
   * DOES THE PHOTO SHOW THE PROBLEM THEY DESCRIBED?
   *
   * JUDGED IN THIS CALL AND NOT A SECOND ONE. The model is already looking at
   * the photo to read the hazard; asking what it shows at the same time costs
   * the output tokens for one word and a short reason, and a second call would
   * double the latency on the one screen where a customer is waiting.
   *
   * IT IS A JUDGEMENT, NOT A SCORE. Three named answers and a sentence saying
   * why, never a confidence number — rule 6's shape for a model opinion. A
   * number invites a threshold, a threshold reads as a measurement, and
   * nobody has the data to choose one.
   *
   * `unclear` IS NOT `unrelated`, and the difference decides what a customer is
   * told. "I cannot tell what this is" asks for a clearer photo; "this is a
   * different thing from what you described" asks for the right one. Collapsing
   * them would tell somebody with a dark photo that they photographed the wrong
   * tap.
   *
   * OPTIONAL, like `hazard`, so a reply in the older shape still validates.
   */
  photoRelevance: z.enum(["related", "unrelated", "unclear"]).nullish(),
  photoRelevanceReason: z.string().trim().min(1).max(160).nullish(),
  /**
   * Is this a home-service problem at all?
   *
   * A JUDGEMENT WITH A REASON, NEVER A SCORE — rule 6. There is no confidence number
   * here and no threshold anywhere reads one. `false` is an answer the model gave;
   * null is "nobody asked or nobody answered", which is what every reply from before
   * this field reads as, and it is never counted as on-topic OR off-topic.
   */
  onTopic: z.boolean().nullish(),
  offTopicReason: z.string().trim().min(1).max(160).nullish(),
});

/** What the photo was judged to be, when there was one and the model said. */
export type PhotoRelevance = "related" | "unrelated" | "unclear";

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
): {
  /**
   * The triage, or null when the model named no trade.
   *
   * NULL IS AN ANSWER AND NOT A FAILURE — the caller tells the two apart by
   * this function returning an object at all. A reply it could not use at all
   * still returns null for the whole thing, exactly as before.
   */
  result: TriageResult | null;
  hazard: Hazard | null;
  photo: { relevance: PhotoRelevance; reason: string | null } | null;
  /** Null is "not recorded" — never on-topic and never off-topic. */
  topic: { onTopic: boolean; reason: string | null } | null;
} | null {
  const bandBySlug = new Map(bands.map((band) => [band.slug, band]));
  const candidate = extractJson(raw);
  if (candidate === null) return null;

  const parsed = triageResponseSchema.safeParse(candidate);
  if (!parsed.success) return null;

  const {
    category,
    urgency,
    priceRangeNPR,
    explanation,
    hazard,
    band: chosenBand,
    photoRelevance,
    photoRelevanceReason,
    onTopic,
    offTopicReason,
  } = parsed.data;
  const topic =
    typeof onTopic === "boolean"
      ? { onTopic, reason: offTopicReason ?? null }
      : null;

  /*
   * NO TRADE NAMED. Everything about a trade goes with it, and the reply is
   * still a good reply: the hazard, the photo verdict and the topic verdict all
   * stand, because each was read from something other than the category.
   *
   * THE HAZARD ESPECIALLY. The prompt says in as many words that `onTopic`
   * never changes it — somebody whose words mention gas gets the emergency line
   * whatever else the model made of the sentence, and dropping this reply on
   * the floor is precisely what used to lose it.
   */
  if (category == null) {
    return {
      result: null,
      hazard: hazard && hazard !== "none" ? hazard : null,
      topic,
      photo: photoRelevance
        ? { relevance: photoRelevance, reason: photoRelevanceReason ?? null }
        : null,
    };
  }

  /*
   * A TRADE WITH NO URGENCY OR NO PRICE IS A MALFORMED REPLY, not a modest one,
   * and it is refused exactly as it was before those two became nullable. The
   * nullability is for the no-trade shape alone; widening it to "any field may
   * be missing" would have made every reply partially acceptable.
   */
  if (!urgency || !priceRangeNPR) return null;

  const band = bandBySlug.get(category) ?? FALLBACK_BAND_BY_SLUG.get(category);
  if (!band) return null;

  /*
   * THE PRODUCT, ONLY IF IT IS ONE THIS TRADE ACTUALLY SELLS.
   *
   * A slug the category does not have is dropped to null rather than
   * rejecting the whole reply: the four keys that matter — category, urgency,
   * price, explanation — are all still good, and refusing them over a
   * scheduling hint would send a customer to the keyword matcher for nothing.
   * Null then means what it means everywhere else: we do not know which
   * product, so nobody is told how long it takes.
   */
  const subBand =
    chosenBand && band.subBands.some((sub) => sub.slug === chosenBand)
      ? chosenBand
      : null;

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
      band: subBand,
    },
    // The urgency the model chose is not adjusted here. The hazard is passed
    // up as a signal and applySafetyFloor decides what it does — one place
    // makes that decision, whatever the source.
    hazard: hazard && hazard !== "none" ? hazard : null,
    /*
     * NULL WHEN THERE WAS NO PHOTO **OR** THE MODEL DID NOT SAY, which are the
     * same thing to every caller: nobody looked, so nothing is claimed. Rule 6
     * — "not recorded" must not render as "the photo was fine".
     */
    topic,
    photo: photoRelevance
      ? { relevance: photoRelevance, reason: photoRelevanceReason ?? null }
      : null,
  };
}
