import { describe, expect, it } from "vitest";

import {
  ARRIVAL_FRESHNESS_WINDOW_MINUTES,
  NEPAL_UTC_OFFSET_MINUTES,
  judgeFreshness,
  takenBeforeCompletion,
} from "@/lib/photos/freshness";

/**
 * Reading a camera clock against the moment somebody tapped "I have arrived".
 *
 * THE CASE THAT CAUGHT A REAL BUG IS THE FIRST ONE. EXIF holds a local wall clock with no
 * timezone and `parseExifDate` reads it as UTC, so a phone in Kathmandu reads 345 minutes
 * ahead of the instant it took the picture — every time. Subtracted naively from a server
 * instant, every honest Nepali photograph looks five and three quarter hours stale, and a
 * freshness window would have flagged all of them. Nothing had seen it because no real
 * arrival photograph exists yet.
 */
describe("whether a photograph was taken when it says", () => {
  const tap = new Date("2026-10-05T04:15:00Z"); // 10:00 in Kathmandu.

  /** What a Kathmandu phone writes into EXIF for an instant, read back as UTC. */
  const wallClockFor = (at: Date, offsetMinutes = 0) =>
    new Date(at.getTime() + NEPAL_UTC_OFFSET_MINUTES * 60_000 + offsetMinutes * 60_000);

  it("calls a photograph taken at the tap fresh, on a Nepali phone", () => {
    const result = judgeFreshness({ takenAt: wallClockFor(tap), at: tap });
    expect(result.verdict).toBe("fresh");
    // Zero, not 345 — the two sides are compared in one frame.
    expect(result.skewMinutes).toBe(0);
  });

  it("is still fresh a few minutes either side", () => {
    expect(judgeFreshness({ takenAt: wallClockFor(tap, -8), at: tap }).verdict).toBe("fresh");
    expect(judgeFreshness({ takenAt: wallClockFor(tap, 8), at: tap }).verdict).toBe("fresh");
  });

  it("calls yesterday's photograph stale", () => {
    const result = judgeFreshness({ takenAt: wallClockFor(tap, -60 * 26), at: tap });
    expect(result.verdict).toBe("stale");
    expect(result.skewMinutes).toBe(-60 * 26);
  });

  /*
   * NO CAPTURE TIME IS ITS OWN ANSWER, not a stale one. A screenshot, a download and a file
   * a messaging app stripped all arrive this way, and that is a different conversation from
   * a photograph taken yesterday.
   */
  it("tells a photograph with no camera data apart from an old one", () => {
    const result = judgeFreshness({ takenAt: null, at: tap });
    expect(result.verdict).toBe("no-capture-time");
    expect(result.skewMinutes).toBeNull();
  });

  it("uses a window generous enough for a hand-set clock", () => {
    expect(ARRIVAL_FRESHNESS_WINDOW_MINUTES).toBe(120);
    const justInside = judgeFreshness({ takenAt: wallClockFor(tap, 119), at: tap });
    const justOutside = judgeFreshness({ takenAt: wallClockFor(tap, 121), at: tap });
    expect(justInside.verdict).toBe("fresh");
    expect(justOutside.verdict).toBe("stale");
  });
});

/**
 * The rule that needs no tuning.
 *
 * A photograph taken before the work finished cannot show that work failing. It is not a
 * judgement about age but about the order of two events, which is why it sits beside the
 * window rather than inside it.
 */
describe("a claim photograph taken before the job ended", () => {
  const completed = new Date("2026-10-01T06:00:00Z");
  const wall = (at: Date) => new Date(at.getTime() + NEPAL_UTC_OFFSET_MINUTES * 60_000);

  it("is recognised, in the phone's own frame", () => {
    expect(
      takenBeforeCompletion({
        takenAt: wall(new Date(completed.getTime() - 60 * 60_000)),
        completedAt: completed,
      }),
    ).toBe(true);
  });

  it("is not triggered by a photograph taken after", () => {
    expect(
      takenBeforeCompletion({
        takenAt: wall(new Date(completed.getTime() + 60 * 60_000)),
        completedAt: completed,
      }),
    ).toBe(false);
  });

  /* Rule 6: neither a missing capture time nor a missing completion is evidence. */
  it("says nothing when either side is missing", () => {
    expect(takenBeforeCompletion({ takenAt: null, completedAt: completed })).toBeNull();
    expect(takenBeforeCompletion({ takenAt: wall(completed), completedAt: null })).toBeNull();
  });
});
