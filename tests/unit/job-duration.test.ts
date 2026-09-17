import { describe, expect, it } from "vitest";

import {
  DURATION_PLAUSIBLE_MIN_MINUTES,
  UNESTIMATED_HOLD_MINUTES,
  elapsedDays,
  isEstimated,
  isMultiDay,
  plausibleWorkedMinutes,
  spansDays,
  workingMinutes,
  type BookingDuration,
} from "@/lib/booking";
import { hasPublishableDuration } from "@/lib/provider";

/**
 * How long a job takes, and the three different answers to that question.
 *
 * THE RULE THIS FILE EXISTS TO PIN: an invented number may reserve, it may not
 * claim, and it may not reserve more than a day. Three gates, three different
 * amounts of harm, and collapsing any two of them is how a guess becomes a
 * fact somebody plans around.
 */

const INVENTED = { source: "invented" } as const;
const RESEARCHED = { source: "researched" } as const;
const OBSERVED = { source: "observed" } as const;

const painting: BookingDuration = {
  estimatedWorkingMinutes: 960,
  estimatedElapsedDays: 4,
};

const unknown: BookingDuration = {
  estimatedWorkingMinutes: null,
  estimatedElapsedDays: null,
};

describe("what the scheduler reserves", () => {
  it("uses the estimate when there is one", () => {
    expect(workingMinutes(painting)).toBe(960);
  });

  /*
   * EXACTLY WHAT EVERY BOOKING HELD BEFORE DURATION EXISTED. A booking whose
   * product nobody could name must behave as it did yesterday, so nothing
   * regresses for the rows that have no band — which today is all of them.
   */
  it("holds two hours when nobody knows, which is yesterday's behaviour", () => {
    expect(workingMinutes(unknown)).toBe(UNESTIMATED_HOLD_MINUTES);
    expect(UNESTIMATED_HOLD_MINUTES).toBe(120);
  });

  /*
   * A HOLD IS NOT AN ESTIMATE, and `isEstimated` is what keeps the two apart.
   * The moment 120 reaches a screen it becomes "about 2 hours", which is a
   * default presented as a measurement.
   */
  it("says plainly that a hold is not an estimate", () => {
    expect(isEstimated(unknown)).toBe(false);
    expect(isEstimated(painting)).toBe(true);
  });

  it("prefers the professional's figure, because they have seen the job", () => {
    expect(
      workingMinutes({ ...painting, providerEstimatedWorkingMinutes: 300 }),
    ).toBe(300);
  });
});

describe("an invented duration may reserve, but not for days", () => {
  /*
   * THE CHEAP HALF. A wrong working figure reserves 90 minutes where 120 was
   * right — bounded, the same order as the flat window it replaced, and
   * strictly better than reserving the same two hours for a tap washer and a
   * whole-flat repaint. So provenance does not gate it.
   */
  it("uses an invented working figure, because being wrong costs little", () => {
    expect(workingMinutes(painting)).toBe(960);
    expect(hasPublishableDuration(INVENTED)).toBe(false);
  });

  /*
   * THE EXPENSIVE HALF. A wrong span holds four days of a painter's week and
   * four days of a customer's home. It removes real bookable capacity, it is
   * invisible to everybody it affects, and nothing distinguishes it from a
   * measurement.
   */
  it("refuses to span days on a guess", () => {
    expect(spansDays(painting, INVENTED)).toBe(false);
    expect(elapsedDays(painting, INVENTED)).toBe(1);
    expect(isMultiDay(painting, INVENTED)).toBe(false);
  });

  it("spans them once somebody has done the research", () => {
    expect(spansDays(painting, RESEARCHED)).toBe(true);
    expect(elapsedDays(painting, RESEARCHED)).toBe(4);
    expect(spansDays(painting, OBSERVED)).toBe(true);
  });

  /*
   * NO PROVENANCE IS NOT BETTER THAN BAD PROVENANCE. A caller that forgets to
   * pass it gets the safe answer, never the confident one — the same
   * fail-closed posture the data layer takes when the column is unreadable.
   */
  it("fails closed when nobody said where the number came from", () => {
    expect(spansDays(painting)).toBe(false);
    expect(elapsedDays(painting)).toBe(1);
  });

  /*
   * A PROFESSIONAL'S OWN FIGURE IS EVIDENCE AND OUTRANKS THE GATE. They have
   * been to the site. What is being gated is OUR guess, not their judgement —
   * and refusing their span would mean a painter who says "this is four days"
   * still gets booked for something else on Wednesday.
   */
  it("lets the professional span days whatever our provenance says", () => {
    const corrected = { ...painting, providerEstimatedElapsedDays: 3 };
    expect(spansDays(corrected, INVENTED)).toBe(true);
    expect(elapsedDays(corrected, INVENTED)).toBe(3);
  });

  it("lets them shorten it to one day too", () => {
    const corrected = { ...painting, providerEstimatedElapsedDays: 1 };
    expect(spansDays(corrected, RESEARCHED)).toBe(false);
    expect(elapsedDays(corrected, RESEARCHED)).toBe(1);
  });

  it("never spans days for a booking with no estimate at all", () => {
    expect(spansDays(unknown, RESEARCHED)).toBe(false);
    expect(elapsedDays(unknown, RESEARCHED)).toBe(1);
  });
});

describe("what counts as evidence of how long it took", () => {
  it("accepts a real job", () => {
    const start = new Date("2026-09-17T04:00:00Z");
    const end = new Date("2026-09-17T05:35:00Z");
    expect(plausibleWorkedMinutes(start, end)).toBe(95);
  });

  /*
   * THE NUMBERS HERE ARE THE REAL ONES. Every completed booking in production
   * when duration shipped ran three to twenty-nine SECONDS — walkthroughs by
   * our own test accounts. Recording those as durations would have put
   * measured-looking values into the column the researched figures are meant
   * to grow out of.
   */
  it("refuses the three-second and twenty-nine-second walkthroughs", () => {
    const start = new Date("2026-09-17T04:00:00Z");
    expect(
      plausibleWorkedMinutes(start, new Date(start.getTime() + 3_000)),
    ).toBeNull();
    expect(
      plausibleWorkedMinutes(start, new Date(start.getTime() + 29_000)),
    ).toBeNull();
  });

  it("refuses anything under the floor, and the floor is ten minutes", () => {
    expect(DURATION_PLAUSIBLE_MIN_MINUTES).toBe(10);
    const start = new Date("2026-09-17T04:00:00Z");
    const justUnder = new Date(start.getTime() + 9 * 60_000);
    const justOver = new Date(start.getTime() + 11 * 60_000);
    expect(plausibleWorkedMinutes(start, justUnder)).toBeNull();
    expect(plausibleWorkedMinutes(start, justOver)).toBe(11);
  });

  it("refuses a job that finished before it started", () => {
    const start = new Date("2026-09-17T04:00:00Z");
    expect(
      plausibleWorkedMinutes(start, new Date(start.getTime() - 60_000)),
    ).toBeNull();
  });

  it("has nothing to say about a job nobody started", () => {
    expect(plausibleWorkedMinutes(null, new Date())).toBeNull();
    expect(plausibleWorkedMinutes(new Date(), null)).toBeNull();
  });
});
