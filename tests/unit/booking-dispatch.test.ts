import { describe, expect, it } from "vitest";

import {
  awaitingProvider,
  dispatchStage,
  DISPATCH_WINDOWS,
  BOOKING_STATUSES,
  type BookingStatus,
} from "@/lib/booking";

/**
 * How long a job waits before it goes to somebody else, and when we give up.
 *
 * This exists because the booking page told customers "we are alerting
 * professionals now" while the booking sat assigned to one person who might
 * never open the app. These windows are the sentence made true, so they are
 * product promises rather than implementation details — and the two failures
 * they guard against pull in opposite directions:
 *
 *   widen too early  -> the customer's choice of professional is decorative
 *   widen too late   -> somebody waits by a burst pipe for an hour
 */

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 4, 12, minutes, 0));
const BOOKED = new Date(Date.UTC(2026, 8, 4, 12, 0, 0)).toISOString();

describe("the chosen professional gets first refusal", () => {
  it("keeps an emergency with them for the first few minutes", () => {
    expect(dispatchStage(BOOKED, "emergency", at(4))).toBe("first-refusal");
  });

  it("keeps a routine job with them for a full hour", () => {
    // Nobody is inconvenienced by an hour on a repaint, and widening sooner
    // would trample a choice the customer deliberately made.
    expect(dispatchStage(BOOKED, "routine", at(59))).toBe("first-refusal");
  });
});

describe("an unanswered job opens to everybody", () => {
  it("opens an emergency fast, because somebody is standing next to a leak", () => {
    expect(dispatchStage(BOOKED, "emergency", at(5))).toBe("open");
    expect(dispatchStage(BOOKED, "emergency", at(30))).toBe("open");
  });

  it("opens a routine job only after the hour", () => {
    expect(dispatchStage(BOOKED, "routine", at(60))).toBe("open");
  });

  it("opens the boundary minute itself rather than waiting one more", () => {
    // Off-by-one here means a job sits for a whole extra sweep interval.
    const { firstRefusalMinutes } = DISPATCH_WINDOWS.soon;
    expect(dispatchStage(BOOKED, "soon", at(firstRefusalMinutes))).toBe("open");
    expect(dispatchStage(BOOKED, "soon", at(firstRefusalMinutes - 1))).toBe(
      "first-refusal",
    );
  });
});

describe("a job nobody takes ends, rather than waiting for ever", () => {
  it("gives up on an emergency inside the hour", () => {
    // Waiting longer than this is not "still trying", it is abandonment with
    // extra steps — the customer has long since rung somebody else.
    expect(dispatchStage(BOOKED, "emergency", at(45))).toBe("give-up");
  });

  it("gives a routine job a full day first", () => {
    expect(dispatchStage(BOOKED, "routine", at(24 * 60 - 1))).toBe("open");
    expect(dispatchStage(BOOKED, "routine", at(24 * 60))).toBe("give-up");
  });

  it("orders every window so give-up never precedes opening", () => {
    // A schedule where a job is abandoned before it was ever offered widely
    // would be silently, catastrophically wrong.
    for (const window of Object.values(DISPATCH_WINDOWS)) {
      expect(window.giveUpMinutes).toBeGreaterThan(window.firstRefusalMinutes);
    }
  });

  it("escalates an emergency faster than a routine job at every stage", () => {
    expect(DISPATCH_WINDOWS.emergency.firstRefusalMinutes).toBeLessThan(
      DISPATCH_WINDOWS.soon.firstRefusalMinutes,
    );
    expect(DISPATCH_WINDOWS.soon.firstRefusalMinutes).toBeLessThan(
      DISPATCH_WINDOWS.routine.firstRefusalMinutes,
    );
  });
});

describe("only a job nobody has accepted is dispatchable", () => {
  it("dispatches a pending booking", () => {
    expect(awaitingProvider("pending")).toBe(true);
  });

  it("never reopens a job somebody is already doing", () => {
    // The sweep reassigning an accepted booking would send two professionals
    // to one house, which is the worst outcome this whole mechanism can have.
    for (const status of BOOKING_STATUSES as readonly BookingStatus[]) {
      if (status === "pending") continue;
      expect(awaitingProvider(status)).toBe(false);
    }
  });
});

describe("an unknown urgency still gets a schedule", () => {
  it("falls back to the most patient one rather than throwing", () => {
    // A bad value must not stop the sweep dead and strand every other booking
    // behind it.
    const stage = dispatchStage(BOOKED, "nonsense" as never, at(30));
    expect(stage).toBe("first-refusal");
  });
});
