import { describe, expect, it } from "vitest";

import {
  bandOutcome,
  categoryAgrees,
  hazardCase,
  middleOf,
} from "@/lib/ai/accuracy";

/**
 * The triage accuracy loop's pure half.
 *
 * WHAT THIS IS FOR. The product's one AI capability had no measurement at all:
 * `triage_logs` was written on every request and never read back against what
 * the customer actually did. These are the three judgements the measurement
 * rests on, and each of them has a way of being quietly wrong that would make
 * the whole surface report confident nonsense.
 *
 * MEASUREMENT, NOT TUNING. Nothing here has a threshold, a grade or an
 * opinion. There is no `GOOD_ENOUGH`, because nobody has the rows to say what
 * good looks like yet, and a constant would encode a guess as a standard.
 */

describe("did the customer book what the triage said", () => {
  it("agrees when the categories match", () => {
    expect(categoryAgrees("plumbing", "plumbing")).toBe(true);
  });

  it("disagrees when they do not", () => {
    expect(categoryAgrees("plumbing", "electrical")).toBe(false);
  });

  /*
   * NULL IS NOT FALSE, and this is the distinction that keeps the screen
   * honest. A booking with no triage behind it has no opinion to compare —
   * counting it as a disagreement would blame the AI for journeys it was never
   * part of, and for the whole life of this product that was every journey.
   */
  it("has no answer when either side is missing", () => {
    expect(categoryAgrees(null, "plumbing")).toBeNull();
    expect(categoryAgrees("plumbing", null)).toBeNull();
    expect(categoryAgrees(undefined, undefined)).toBeNull();
  });
});

describe("where the settled amount fell against the range shown", () => {
  it("is inside at the boundaries, not outside them", () => {
    // The card printed "Rs 900 to Rs 4,500". A job that came to exactly 900 is
    // one the quote covered, and an off-by-one here would report the band as
    // wrong on precisely the jobs where it was exactly right.
    expect(bandOutcome(900, 4500, 900)).toBe("inside");
    expect(bandOutcome(900, 4500, 4500)).toBe("inside");
    expect(bandOutcome(900, 4500, 2000)).toBe("inside");
  });

  it("names which side it missed on", () => {
    // Above and below are different failures: above is a customer surprised by
    // a bill, below is a quote that scared somebody off for no reason.
    expect(bandOutcome(900, 4500, 4501)).toBe("above");
    expect(bandOutcome(900, 4500, 899)).toBe("below");
  });

  it("has no answer on an unsettled job or a row with no range", () => {
    expect(bandOutcome(900, 4500, null)).toBeNull();
    expect(bandOutcome(null, 4500, 2000)).toBeNull();
    expect(bandOutcome(900, null, 2000)).toBeNull();
  });
});

/**
 * The comparison that has never existed.
 *
 * `triage_logs.hazard` records the OUTCOME — `applySafetyFloor` lets the text
 * guard win whenever both fire, so `vision:*` appears only on rows where text
 * found nothing. From that column, agreement is unmeasurable, disagreement is
 * unmeasurable, and "text caught what vision missed" is unmeasurable. Only
 * "vision caught what text missed" survives, because that is literally what a
 * `vision:*` row means.
 *
 * `text_hazard` and `vision_hazard` are each detector's own reading, and these
 * six cases are what they make answerable.
 */
describe("what each hazard detector said", () => {
  const read = (textHazard: string | null, visionHazard: string | null) =>
    hazardCase({ textHazard, visionHazard, recorded: true });

  it("counts both firing on the same hazard as agreement", () => {
    expect(read("gas", "gas")).toBe("agreed");
  });

  it("counts both firing on different hazards as disagreement", () => {
    // Worth separating: two detectors that both see danger but name it
    // differently is a different fact from one seeing nothing.
    expect(read("gas", "burning")).toBe("disagreed");
  });

  it("counts the text guard catching what vision missed", () => {
    // Unmeasurable before: the winner's prefix said "text" either way.
    expect(read("gas", null)).toBe("textOnly");
  });

  it("counts vision catching what the text guard missed", () => {
    expect(read(null, "burning")).toBe("visionOnly");
  });

  it("counts both looking and finding nothing", () => {
    expect(read(null, null)).toBe("neither");
  });

  /*
   * RULE 6, AND IT BITES ON DAY ONE RATHER THAN IN THEORY. Every row written
   * before these columns existed has null in both — fifteen of them live right
   * now — and reading that silence as "both detectors found nothing" would
   * manufacture a clean safety record out of an absent one.
   */
  it("never reads a row that predates the columns as a quiet one", () => {
    expect(hazardCase({ textHazard: null, visionHazard: null, recorded: false })).toBe(
      "notRecorded",
    );
    expect(
      hazardCase({ textHazard: null, visionHazard: null, recorded: false }),
    ).not.toBe("neither");
  });
});

describe("how long a path took", () => {
  it("takes the middle, not the average", () => {
    // One 9.5-second timeout in a sample of five. The mean is 2,120ms and
    // describes a product nobody used; the median is 900ms and describes four
    // of the five requests.
    expect(middleOf([800, 850, 900, 950, 9500]).medianMs).toBe(900);
  });

  it("averages the two middles on an even sample", () => {
    expect(middleOf([100, 200, 300, 400]).medianMs).toBe(250);
  });

  it("carries the sample size, because the median alone is an anecdote", () => {
    expect(middleOf([1000, 1100, 1200])).toEqual({ medianMs: 1100, total: 3 });
  });

  /*
   * RULE 6 AGAIN, one level down. Nothing recorded is not "instant" — and 0ms
   * on the screen beside the model's 1,900ms would read as the fallback being
   * gloriously fast rather than as never having been timed.
   */
  it("has no middle at all with nothing to measure", () => {
    expect(middleOf([])).toEqual({ medianMs: null, total: 0 });
  });

  it("leaves a row with no recorded time out of the sample", () => {
    // Not 0, and not counted: a null latency_ms is a row that was not timed.
    expect(middleOf([Number.NaN, 1000, Number.POSITIVE_INFINITY])).toEqual({
      medianMs: 1000,
      total: 1,
    });
  });
});
