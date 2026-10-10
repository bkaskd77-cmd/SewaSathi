import { describe, expect, it } from "vitest";

import { parseTriageResponse } from "@/lib/ai/triage-schema";
import { FALLBACK_PRICE_BANDS } from "@/lib/ai/price-bands";

/**
 * The price clamp.
 *
 * The published band is already in the prompt, so this only fires when the
 * model ignored it — but when it does, an invented 40,000 quote for a leaking
 * tap is exactly the sort of thing that ends up in a screenshot. The clamp is
 * what makes the number on screen a number we stand behind.
 */

const band = FALLBACK_PRICE_BANDS.find((b) => b.slug === "plumbing")!;

function reply(over: Record<string, unknown>): string {
  return JSON.stringify({
    category: "plumbing",
    urgency: "routine",
    priceRangeNPR: [band.low, band.high],
    explanation: "A dripping tap usually needs a new washer.",
    ...over,
  });
}


/**
 * The triage out of a reply that names a trade.
 *
 * `parseTriageResponse().result` became nullable when the schema learned to accept a
 * reply with no trade in it — an off-topic verdict, or a home problem the model could not
 * place. Every case below names one, and this keeps the two failures apart in the message:
 * "the whole reply was discarded" and "the reply named no trade" are different faults, and
 * a bare `!` would report them identically.
 */
function named(raw: string): NonNullable<
  NonNullable<ReturnType<typeof parseTriageResponse>>["result"]
> {
  const out = parseTriageResponse(raw);
  expect(out, "the whole reply was discarded").not.toBeNull();
  expect(out!.result, "the reply named no trade").not.toBeNull();
  return out!.result!;
}

describe("the quote stays inside the published band", () => {
  it("pulls an absurd high back to the ceiling", () => {
    const out = named(reply({ priceRangeNPR: [900, 40000] }));
    expect(out.priceRangeNPR[1]).toBeLessThanOrEqual(band.high);
  });

  it("pushes an implausible low up to the floor", () => {
    const out = named(reply({ priceRangeNPR: [5, 20] }));
    expect(out.priceRangeNPR[0]).toBeGreaterThanOrEqual(band.low);
  });

  it("leaves a quote already inside the band alone", () => {
    const inside = Math.round((band.low + band.high) / 2 / 100) * 100;
    const out = named(reply({ priceRangeNPR: [inside, inside] }));
    expect(out.priceRangeNPR).toEqual([inside, inside]);
  });

  it("repairs a reversed range rather than quoting backwards", () => {
    const out = named(reply({ priceRangeNPR: [3000, 1200] }));
    const [low, high] = out.priceRangeNPR;
    expect(low).toBeLessThanOrEqual(high);
  });

  it("never quotes an odd figure — nobody says 1,847", () => {
    const out = named(reply({ priceRangeNPR: [1847, 2953] }));
    for (const value of out.priceRangeNPR) {
      expect(value % 100).toBe(0);
    }
  });
});

describe("an unusable answer is refused, not patched", () => {
  it("returns null for a category we do not sell", () => {
    expect(parseTriageResponse(reply({ category: "roof-thatching" }))).toBeNull();
  });

  it("returns null for an urgency outside the contract", () => {
    expect(parseTriageResponse(reply({ urgency: "whenever" }))).toBeNull();
  });

  it("returns null for text that is not JSON at all", () => {
    // The fallback matcher answers instead — see mockTriage. Never an error.
    expect(parseTriageResponse("I'm sorry, I can't help with that.")).toBeNull();
  });

  it("still reads JSON the model wrapped in prose or a fence", () => {
    const wrapped = "Here you go:\n```json\n" + reply({}) + "\n```";
    expect(parseTriageResponse(wrapped)).not.toBeNull();
  });
});

describe("the hazard key is passed up, not acted on here", () => {
  it("reports a hazard the model saw in the photo", () => {
    const parsed = parseTriageResponse(reply({ hazard: "burning" }));
    expect(parsed!.hazard).toBe("burning");
    const out = parsed!.result!;
    // Deliberately NOT escalated here: applySafetyFloor makes that decision,
    // in one place, whatever the source.
    expect(out.urgency).toBe("routine");
  });

  it("treats an explicit 'none' as no hazard", () => {
    expect(parseTriageResponse(reply({ hazard: "none" }))!.hazard).toBeNull();
  });
});
