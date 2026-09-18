import { describe, expect, it } from "vitest";

import {
  SLOT_MINUTES,
  UNESTIMATED_HOLD_MINUTES,
  capacityFor,
  countOverlapping,
  hasRoom,
  nextFreeSlot,
  overlaps,
  slotWindow,
} from "@/lib/booking";

/**
 * Two customers booking the same professional at 2pm.
 *
 * Nothing stopped it. The one who lost found out on the day, from somebody who
 * did not arrive — and `canServeAt` was never going to catch it, because it
 * answers "are they in somebody's house right now", not "is Thursday 2pm
 * already spoken for".
 *
 * These tests hold the two decisions that are easy to get subtly wrong: the
 * window is HALF-OPEN, so a full day of back-to-back work is not a day of
 * conflicts; and capacity is a MINIMUM of three sources plus at most one
 * deliberate offer, so neither an admin override nor probation can be routed
 * around by the other.
 */

const at = new Date("2026-09-17T06:00:00.000Z");
const twoPm = "2026-09-17T08:15:00.000Z";
const fourPm = "2026-09-17T10:15:00.000Z";

function held(scheduledFor: string | null, status = "accepted", id?: string) {
  return { scheduledFor, status, id };
}

describe("a job occupies a window, not an instant", () => {
  it("holds the default when nobody knows how long the job is", () => {
    // Null is not "zero minutes", it is "nobody named the product". The
    // reservation is then exactly what every booking held before duration
    // existed — see UNESTIMATED_HOLD_MINUTES.
    const window = slotWindow(twoPm, null, at);
    expect(window.end.getTime() - window.start.getTime()).toBe(
      UNESTIMATED_HOLD_MINUTES * 60_000,
    );
    expect(UNESTIMATED_HOLD_MINUTES).toBe(SLOT_MINUTES);
  });

  /*
   * THE WHOLE POINT OF THE PHASE. A job runs for its own length now, so a
   * four-hour deep clean and a forty-five-minute leak no longer reserve the
   * same block.
   */
  it("runs for the job's own length when there is one", () => {
    const window = slotWindow(twoPm, 480, at);
    expect(window.end.getTime() - window.start.getTime()).toBe(480 * 60_000);
  });

  it("treats an as-soon-as-possible job as starting now", () => {
    // That is what the customer asked for and what the professional will
    // actually be doing, so it has to collide with anything else happening now.
    expect(slotWindow(null, null, at).start.getTime()).toBe(at.getTime());
  });

  it("does not overlap a job that starts exactly as this one ends", () => {
    // Half-open on purpose: closed intervals would read every back-to-back
    // pair in a full day as a conflict and grey out a working schedule.
    expect(overlaps(slotWindow(twoPm, null, at), slotWindow(fourPm, null, at))).toBe(false);
  });

  it("overlaps a job starting one minute before this one ends", () => {
    const nearlyFour = "2026-09-17T10:14:00.000Z";
    expect(overlaps(slotWindow(twoPm, null, at), slotWindow(nearlyFour, null, at))).toBe(
      true,
    );
  });
});

describe("what counts against the window", () => {
  it("ignores finished and cancelled jobs", () => {
    const jobs = [
      held(twoPm, "completed"),
      held(twoPm, "cancelled"),
      held(twoPm, "paid"),
    ];
    expect(countOverlapping({ jobs, scheduledFor: twoPm, at })).toBe(0);
  });

  it("counts a pending job, because it is still holding their time", () => {
    // A job nobody has accepted yet is still one the customer was told was
    // being arranged. Counting it only from `accepted` would let the same slot
    // be sold twice in the gap.
    expect(
      countOverlapping({ jobs: [held(twoPm, "pending")], scheduledFor: twoPm, at }),
    ).toBe(1);
  });

  it("does not count a booking against itself when it is re-checked", () => {
    const jobs = [held(twoPm, "accepted", "b1")];
    expect(
      countOverlapping({ jobs, scheduledFor: twoPm, at, excludeId: "b1" }),
    ).toBe(0);
  });
});

describe("how many a listing may hold", () => {
  it("takes the category default when there is no override", () => {
    expect(capacityFor({ categoryLimit: 2 })).toBe(2);
  });

  it("takes an admin-set override above the category default", () => {
    // Movers is the case: one man with a pickup does one move, a verified firm
    // with three trucks does three. Admin-set at onboarding, never self-set.
    expect(capacityFor({ categoryLimit: 1, providerLimit: 3 })).toBe(3);
  });

  it("lets probation cap a firm's override", () => {
    // A new listing has not yet shown it can hold two jobs, let alone three.
    expect(
      capacityFor({ categoryLimit: 1, providerLimit: 3, probationLimit: 2 }),
    ).toBe(2);
  });

  it("never falls below one, whatever the numbers say", () => {
    expect(capacityFor({ categoryLimit: 0, providerLimit: 0 })).toBe(1);
  });

  it("adds exactly one for an offer, and only for this booking", () => {
    expect(capacityFor({ categoryLimit: 2, overbookOffered: true })).toBe(3);
    // The offer lives on the booking, so a second booking asking the same
    // question without one gets the ordinary limit back.
    expect(capacityFor({ categoryLimit: 2 })).toBe(2);
  });
});

describe("room for one more", () => {
  it("refuses a second job at a capacity of one", () => {
    expect(
      hasRoom({ jobs: [held(twoPm)], scheduledFor: twoPm, capacity: 1, at }),
    ).toBe(false);
  });

  it("allows it when the professional offered to fit them in", () => {
    expect(
      hasRoom({
        jobs: [held(twoPm)],
        scheduledFor: twoPm,
        capacity: capacityFor({ categoryLimit: 1, overbookOffered: true }),
        at,
      }),
    ).toBe(true);
  });

  it("still refuses a third, because the offer is worth one seat", () => {
    expect(
      hasRoom({
        jobs: [held(twoPm), held(twoPm)],
        scheduledFor: twoPm,
        capacity: capacityFor({ categoryLimit: 1, overbookOffered: true }),
        at,
      }),
    ).toBe(false);
  });
});

describe("the next slot they could actually take", () => {
  const candidates = [twoPm, fourPm, "2026-09-17T12:15:00.000Z"];

  it("skips the full window and names the first free one", () => {
    expect(
      nextFreeSlot({ candidates, jobs: [held(twoPm)], capacity: 1, at }),
    ).toBe(fourPm);
  });

  it("returns null when nothing inside the horizon is free", () => {
    // The greyed row then says so rather than showing a Book button that
    // leads nowhere.
    const jobs = candidates.map((slot) => held(slot));
    expect(nextFreeSlot({ candidates, jobs, capacity: 1, at })).toBeNull();
  });

  it("only ever proposes a slot the picker itself offers", () => {
    const free = nextFreeSlot({
      candidates,
      jobs: [held(twoPm)],
      capacity: 1,
      at,
    });
    expect(candidates).toContain(free);
  });
});

/**
 * Jobs of different lengths, which is what the fixed two-hour window could not
 * express and what `ARCHITECTURE.md` named as the structural gap.
 *
 * The old model gave a tap washer and a whole-flat repaint the same block. It
 * was roughly right for booking collisions and roughly meaningless as a model
 * of anybody's week, and `categories.max_concurrent_jobs` existed to paper
 * over the difference.
 */
describe("a long job and a short one", () => {
  const tenAm = "2026-09-17T04:15:00.000Z";
  const onePm = "2026-09-17T07:15:00.000Z";

  /*
   * THE COLLISION THE OLD MODEL MISSED. A four-hour deep clean from ten runs
   * to two; a forty-five-minute leak at one lands inside it. Under a fixed
   * two-hour window the clean ended at noon and the two never met — so the
   * second customer was told somebody was coming and found out on the day
   * that nobody was.
   */
  it("collides when the long job is still running", () => {
    expect(
      countOverlapping({
        jobs: [{ scheduledFor: tenAm, status: "accepted", workingMinutes: 240 }],
        scheduledFor: onePm,
        workingMinutes: 45,
        at,
      }),
    ).toBe(1);
  });

  it("does not collide once the long job has finished", () => {
    const threePm = "2026-09-17T09:15:00.000Z";
    expect(
      countOverlapping({
        jobs: [{ scheduledFor: tenAm, status: "accepted", workingMinutes: 240 }],
        scheduledFor: threePm,
        workingMinutes: 45,
        at,
      }),
    ).toBe(0);
  });

  /*
   * AND IT IS ASYMMETRIC, which is the half a single fixed number cannot have.
   * Swap the lengths and the same two start times stop colliding: a
   * forty-five-minute job at ten is done long before one o'clock.
   */
  it("stops colliding when the lengths are swapped", () => {
    expect(
      countOverlapping({
        jobs: [{ scheduledFor: tenAm, status: "accepted", workingMinutes: 45 }],
        scheduledFor: onePm,
        workingMinutes: 240,
        at,
      }),
    ).toBe(0);
  });

  /*
   * A JOB NOBODY SIZED STILL BEHAVES AS IT ALWAYS DID. Null on either side
   * holds the two-hour default, so nothing regresses for the rows that have no
   * product — which today is all of them.
   */
  it("holds two hours on both sides when neither is estimated", () => {
    const elevenAm = "2026-09-17T05:15:00.000Z";
    expect(
      countOverlapping({
        jobs: [held(tenAm)],
        scheduledFor: elevenAm,
        at,
      }),
    ).toBe(1);

    const oneAm = "2026-09-17T07:15:00.000Z";
    expect(
      countOverlapping({ jobs: [held(tenAm)], scheduledFor: oneAm, at }),
    ).toBe(0);
  });

  /*
   * The greyed row on the booking screen asks this, and it has to ask it about
   * the job the customer is actually booking: a four-hour job needs a
   * four-hour gap, so the first slot it can take is later than the first slot
   * a short job could.
   */
  it("finds a later first-free slot for a longer job", () => {
    const candidates = [tenAm, "2026-09-17T06:15:00.000Z", onePm];
    const jobs = [
      { scheduledFor: tenAm, status: "accepted", workingMinutes: 120 },
    ];

    expect(
      nextFreeSlot({ candidates, jobs, workingMinutes: 45, capacity: 1, at }),
    ).toBe("2026-09-17T06:15:00.000Z");

    expect(
      nextFreeSlot({ candidates, jobs, workingMinutes: 240, capacity: 1, at }),
    ).toBe("2026-09-17T06:15:00.000Z");
  });
});
