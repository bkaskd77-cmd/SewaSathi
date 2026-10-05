import { describe, expect, it } from "vitest";

import { parseTriageResponse } from "@/lib/ai/triage-schema";

/**
 * The photo verdict and the hazard are independent, and this is where they could couple.
 *
 * THE CASE THE WHOLE FEATURE RESTS ON. Judging whether a photo shows the described problem
 * is a convenience; reading it for a gas leak is not. A photo of a burning socket sent by
 * somebody describing a blocked drain is BOTH unrelated and an emergency, and if relevance
 * could suppress the hazard read, this feature would have made the product less safe than
 * before it existed. They are two keys in one reply and `parseTriageResponse` is the only
 * place they meet.
 */
const reply = (extra: Record<string, unknown>) =>
  JSON.stringify({
    category: "plumbing",
    urgency: "routine",
    priceRangeNPR: [500, 1500],
    explanation: "A plumber will look at the drain and clear it.",
    ...extra,
  });

describe("what the model made of the photo", () => {
  it("keeps the hazard from a photo that showed something else entirely", () => {
    const parsed = parseTriageResponse(
      reply({
        hazard: "burning",
        photoRelevance: "unrelated",
        photoRelevanceReason: "this looks like a wall socket, not a drain",
      }),
    );

    expect(parsed).not.toBeNull();
    // The hazard survives the photo being of something else.
    expect(parsed?.hazard).toBe("burning");
    expect(parsed?.photo).toEqual({
      relevance: "unrelated",
      reason: "this looks like a wall socket, not a drain",
    });
  });

  it("keeps the hazard from a photo nobody could read", () => {
    const parsed = parseTriageResponse(
      reply({ hazard: "gas", photoRelevance: "unclear", photoRelevanceReason: "too dark" }),
    );
    expect(parsed?.hazard).toBe("gas");
    expect(parsed?.photo?.relevance).toBe("unclear");
  });

  /*
   * NULL IS "NO PHOTO, OR THE MODEL DID NOT SAY" — one meaning to every reader, and it must
   * never render as "the photo was fine". A reply in the older shape still validates rather
   * than dropping a customer to the keyword matcher over a key that asks for a retake.
   */
  it("reads a reply that says nothing about a photo", () => {
    const parsed = parseTriageResponse(reply({ hazard: "none" }));
    expect(parsed).not.toBeNull();
    expect(parsed?.photo).toBeNull();
    expect(parsed?.hazard).toBeNull();
  });

  it("refuses a relevance the card cannot render", () => {
    const parsed = parseTriageResponse(reply({ photoRelevance: "probably fine" }));
    expect(parsed).toBeNull();
  });

  /*
   * A REASON, NEVER A SCORE. The prompt asks for a sentence and the schema takes one; a
   * number would invite a threshold, and a threshold reads as a measurement nobody has the
   * data to choose. This is rule 6 in the form it takes for a model's opinion.
   */
  it("takes a sentence and nothing numeric", () => {
    const withNumber = parseTriageResponse(
      reply({ photoRelevance: "unrelated", photoRelevanceReason: 0.82 }),
    );
    expect(withNumber).toBeNull();
  });
});
