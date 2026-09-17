import { describe, expect, it } from "vitest";

import { FALLBACK_PRICE_BANDS } from "@/lib/ai/price-bands";
import { KEYWORD_RULES, triageProblem } from "@/lib/ai/mockTriage";
import { parseTriageResponse } from "@/lib/ai/triage-schema";
import { SUB_BAND_SEED } from "@/lib/config/services";
import type { TriageCopy } from "@/lib/ai/copy";

/**
 * The fifth key: which product inside the trade.
 *
 * `TriageResult` had four keys and had not changed since Phase 2 — category,
 * urgency, price range, explanation. This is the first widening, and it earns
 * it: the sub-band slug is where the researched price AND the researched
 * duration both live, so naming the product is what lets a booking know its
 * own length without anybody inventing a number.
 *
 * NULL IS A REAL ANSWER AND MOST OF THIS FILE IS ABOUT DEFENDING IT. A guessed
 * product files the booking under the wrong thing in every signal that later
 * reads it, and books the wrong span out of somebody's week.
 */

const COPY: TriageCopy = {
  explanations: new Proxy({} as Record<string, string>, {
    get: (_t, key) => `explanation for ${String(key)}`,
  }),
  safety: {
    gas: "GAS.",
    burning: "BURNING.",
    "live-wire": "WIRE.",
    unseenPhoto: "UNSEEN.",
  },
  genericCategory: "a professional",
  genericCtaLabel: "Find a professional",
};

const plumbing = FALLBACK_PRICE_BANDS.find((b) => b.slug === "plumbing")!;

function reply(over: Record<string, unknown>): string {
  return JSON.stringify({
    category: "plumbing",
    urgency: "routine",
    priceRangeNPR: [plumbing.low, plumbing.high],
    explanation: "A dripping tap usually needs a new washer.",
    ...over,
  });
}

describe("the model may name a product, and only one this trade sells", () => {
  it("keeps a slug the category actually has", () => {
    expect(parseTriageResponse(reply({ band: "blockage" }))!.result.band).toBe(
      "blockage",
    );
  });

  /*
   * THE FAILURE THIS GUARDS. The key is a bare string rather than an enum
   * precisely because an enum would have to be the union of all 36 slugs and
   * would happily accept painting's four-day `flat` on a plumbing job — which
   * would reserve four days of somebody's week for a tap washer.
   */
  it("drops a slug that belongs to a different trade", () => {
    expect(parseTriageResponse(reply({ band: "flat" }))!.result.band).toBeNull();
    expect(
      parseTriageResponse(reply({ band: "room-supplied" }))!.result.band,
    ).toBeNull();
  });

  it("drops a slug that exists nowhere", () => {
    expect(
      parseTriageResponse(reply({ band: "not-a-product" }))!.result.band,
    ).toBeNull();
  });

  /*
   * A BAD BAND NEVER COSTS THE ANSWER. The four keys that matter are all still
   * good, and sending somebody to the keyword matcher over a scheduling hint
   * would be a worse outcome than scheduling the job the way every booking was
   * scheduled before duration existed.
   */
  it("still answers, with the price clamped, when the band is wrong", () => {
    const out = parseTriageResponse(reply({ band: "flat", priceRangeNPR: [900, 40000] }));
    expect(out).not.toBeNull();
    expect(out!.result.category).toBe("plumbing");
    expect(out!.result.priceRangeNPR[1]).toBeLessThanOrEqual(plumbing.high);
  });

  /*
   * Optional, exactly like `hazard`. A reply in the older shape must not drop
   * a customer to the fallback over a key that only affects scheduling.
   */
  it("accepts a reply that has no band at all", () => {
    const out = parseTriageResponse(reply({}));
    expect(out).not.toBeNull();
    expect(out!.result.band).toBeNull();
  });

  it("accepts an explicit null", () => {
    const out = parseTriageResponse(reply({ band: null }));
    expect(out).not.toBeNull();
    expect(out!.result.band).toBeNull();
  });
});

describe("the keyword matcher names a product only when it cannot be wrong", () => {
  const slugsFor = (category: string) =>
    new Set(
      SUB_BAND_SEED.filter((b) => b.categorySlug === category).map((b) => b.slug),
    );

  it("never points at a product its own trade does not sell", () => {
    for (const rule of KEYWORD_RULES) {
      if (!rule.band) continue;
      expect(
        slugsFor(rule.category).has(rule.band),
        `${rule.category} has no product "${rule.band}"`,
      ).toBe(true);
    }
  });

  it("names one for a blocked drain, which can only be one thing", () => {
    expect(triageProblem("toilet is blocked", COPY).band).toBe("blockage");
    expect(triageProblem("कमोड जाम भयो", COPY).band).toBe("blockage");
  });

  /*
   * THE CASE THAT MATTERS AND THE MATCHER CANNOT CALL IT. Painting runs from a
   * one-day touch-up to a seven-day flat, and the word "painting" says nothing
   * about which. This is exactly why the model names the band and this file
   * does not guess — and why a null here is the correct answer rather than a
   * gap somebody should later fill in.
   */
  it("names none for painting, because one word cannot tell a wall from a flat", () => {
    expect(triageProblem("I want my house painted", COPY).band).toBeNull();
  });

  it("names none for an AC that is not cooling", () => {
    // A service, a gas refill or a repair — 1,200 to 7,500 apart.
    expect(triageProblem("ac not cooling", COPY).band).toBeNull();
  });

  /*
   * AN ALIAS NAMES A TRADE, NOT A PROBLEM. "मिस्त्री" says who you want, not
   * what broke — so it drops the band for the same reason it borrows the
   * ordinary rule rather than the emergency one. Inheriting the base rule's
   * product would file every alias booking under whatever that rule meant.
   */
  it("names none for a trade word", () => {
    expect(triageProblem("plumber", COPY).band).toBeNull();
    expect(triageProblem("मिस्त्री", COPY).band).toBeNull();
  });

  it("names none when nothing matched at all", () => {
    expect(triageProblem("something is odd upstairs", COPY).band).toBeNull();
    expect(triageProblem("", COPY).band).toBeNull();
  });
});

describe("the prompt hands the model the keys it is asked to choose from", () => {
  /*
   * A model cannot return a slug it was never shown. The note is generated
   * from the sub-bands as `slug=Label low-high`, so repricing or re-timing a
   * product updates what the model is told in the same edit.
   */
  it("prints every product's key beside its label", () => {
    const ac = FALLBACK_PRICE_BANDS.find((b) => b.slug === "ac-servicing")!;
    for (const sub of ac.subBands) {
      expect(ac.note).toContain(`${sub.slug}=${sub.labelEn}`);
    }
  });

  it("gives a survey trade no keys, because it has no products", () => {
    const movers = FALLBACK_PRICE_BANDS.find((b) => b.slug === "movers-packers")!;
    expect(movers.subBands).toEqual([]);
    expect(movers.note).toMatch(/survey/i);
  });
});
