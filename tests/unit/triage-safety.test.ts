import { describe, expect, it } from "vitest";

import { applySafetyFloor, detectHazard } from "@/lib/ai/safety";
import type { SafetyCopy } from "@/lib/ai/copy";
import type { TriageResult } from "@/lib/ai/mockTriage";

/**
 * The safety floor.
 *
 * This is the highest-stakes logic in the product: it is what a frightened
 * person reads when they type "gas smell" at eleven at night. It runs on every
 * path — model, cache and fallback — and it is deterministic, which is what
 * makes it testable at all.
 *
 * These test behaviour: what urgency comes out, and whether the safety line
 * leads the explanation. They say nothing about which regex matched, so the
 * matcher can be rewritten without touching this file.
 */

const COPY: SafetyCopy = {
  gas: "GAS-ACTION.",
  burning: "BURNING-ACTION.",
  "live-wire": "WIRE-ACTION.",
  unseenPhoto: "UNSEEN-PHOTO.",
};

function calm(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    category: "plumbing",
    urgency: "routine",
    priceRangeNPR: [900, 1800],
    explanation: "A dripping tap usually needs a new washer.",
    ...overrides,
  };
}

describe("detecting a hazard in what someone typed", () => {
  it("catches it in English", () => {
    expect(detectHazard("I can smell gas in the kitchen")).toBe("gas");
    // A sparking board is classed as "burning", not "live-wire": the burning
    // line tells you to kill the mains and stop using that socket, which is
    // the right advice here. Both reach emergency; only the wording differs.
    expect(detectHazard("the switchboard is sparking")).toBe("burning");
    expect(detectHazard("bare wire hanging in the bathroom")).toBe("live-wire");
    expect(detectHazard("there is a burning smell from the socket")).toBe(
      "burning",
    );
  });

  it("catches it in Devanagari", () => {
    // A Nepali reader typing in their own script must not get the calm path.
    expect(detectHazard("भान्सामा ग्यास गन्हाइरहेको छ")).toBe("gas");
  });

  it("catches it in Romanized Nepali", () => {
    expect(detectHazard("bhansa ma gas ko gandha aayo")).toBe("gas");
  });

  it("leaves an ordinary problem alone", () => {
    expect(detectHazard("kitchen tap is dripping")).toBeNull();
    expect(detectHazard("need the flat cleaned before we move in")).toBeNull();
  });

  it("does not treat an AC gas refill as a gas leak", () => {
    // Deliberate: this is a routine service call, and escalating it would
    // teach people the warnings are noise.
    expect(detectHazard("AC needs a gas refill, not cooling")).toBeNull();
  });
});

describe("the floor is applied", () => {
  it("raises a calm result to emergency and leads with what to do", () => {
    const outcome = applySafetyFloor("I smell gas", calm(), { copy: COPY });

    expect(outcome.result.urgency).toBe("emergency");
    expect(outcome.hazard).toBe("gas");
    expect(outcome.via).toBe("text");
    // The action comes first. Somebody scared reads the first line and stops.
    expect(outcome.result.explanation.startsWith("GAS-ACTION.")).toBe(true);
  });

  it("leaves an ordinary result untouched", () => {
    const before = calm();
    const outcome = applySafetyFloor("dripping tap", before, { copy: COPY });

    expect(outcome.result.urgency).toBe("routine");
    expect(outcome.hazard).toBeNull();
    expect(outcome.result.explanation).toBe(before.explanation);
  });

  it("does not stack the safety line twice", () => {
    const once = applySafetyFloor("gas smell", calm(), { copy: COPY });
    const twice = applySafetyFloor("gas smell", once.result, { copy: COPY });

    expect(twice.result.explanation).toBe(once.result.explanation);
  });
});

describe("what the photo is allowed to do", () => {
  it("raises a result when only the photo shows the hazard", () => {
    // The panic case: somebody photographs a sparking board and types nothing.
    const outcome = applySafetyFloor("", calm(), {
      copy: COPY,
      visionHazard: "live-wire",
    });

    expect(outcome.result.urgency).toBe("emergency");
    expect(outcome.via).toBe("vision");
  });

  it("never lowers a result — vision is one-way", () => {
    const urgent = calm({ urgency: "emergency" });
    const outcome = applySafetyFloor("smell of gas", urgent, {
      copy: COPY,
      visionHazard: null,
    });

    expect(outcome.result.urgency).toBe("emergency");
  });

  it("lets the deterministic text guard win when both fire", () => {
    const outcome = applySafetyFloor("I smell gas", calm(), {
      copy: COPY,
      visionHazard: "burning",
    });

    expect(outcome.hazard).toBe("gas");
    expect(outcome.via).toBe("text");
  });

  it("says so when a photo was attached and never looked at", () => {
    const outcome = applySafetyFloor("", calm({ category: "electrical" }), {
      copy: COPY,
      photoUnseen: true,
    });

    expect(outcome.cautioned).toBe(true);
    // Not seeing something is not evidence of a hazard.
    expect(outcome.result.urgency).toBe("routine");
  });

  it("does not warn a cleaning job about flames", () => {
    const outcome = applySafetyFloor("", calm({ category: "cleaning" }), {
      copy: COPY,
      photoUnseen: true,
    });

    expect(outcome.cautioned).toBe(false);
  });
});
