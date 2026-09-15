import { describe, expect, it } from "vitest";

import { blocksBooking, canServeAt, servingWhen } from "@/lib/provider";

/**
 * Can this professional do this job, and when.
 *
 * THE CASE WORTH THE MOST HERE IS THE ONE THAT MUST *NOT* REFUSE: being on a
 * job right now says nothing about Thursday. Getting that wrong would take
 * work from the busiest professionals on the platform, which is the opposite
 * of what the state exists for — and it is the branch a careless later edit is
 * most likely to break, because refusing looks like the safe direction.
 */

const now = new Date("2026-09-14T04:00:00Z"); // 09:45 in Kathmandu
const inTwoHours = new Date(now.getTime() + 2 * 60 * 60_000);
const thursday = new Date(now.getTime() + 3 * 24 * 60 * 60_000);

describe("as soon as possible", () => {
  it("refuses somebody on one of our jobs", () => {
    const verdict = canServeAt({ state: "on_job", when: null, at: now });
    expect(verdict).toEqual({
      ok: false,
      reason: "onJobNow",
      freeFrom: null,
    });
  });

  /**
   * No `freeFrom` for a job in progress, deliberately: a job has no scheduled
   * end, and a guessed one is a promise we cannot keep. The screen offers
   * other people instead of a time that might be wrong.
   */
  it("does not invent a time a job will end", () => {
    const verdict = canServeAt({ state: "on_job", when: null, at: now });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.freeFrom).toBeNull();
  });

  it("refuses a declared busy window and says when it lifts", () => {
    const verdict = canServeAt({
      state: "busy",
      busyUntil: inTwoHours,
      when: null,
      at: now,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("busyNow");
      expect(verdict.freeFrom).toEqual(inTwoHours);
    }
  });

  it("accepts everybody who is not currently tied up", () => {
    for (const state of ["now", "today", "scheduled"] as const) {
      expect(canServeAt({ state, when: null, at: now }).ok).toBe(true);
    }
  });
});

describe("a slot in the future", () => {
  it("NEVER refuses somebody just because they are on a job now", () => {
    expect(
      canServeAt({ state: "on_job", when: thursday, at: now }).ok,
    ).toBe(true);
  });

  it("accepts a slot after a busy window ends", () => {
    expect(
      canServeAt({
        state: "busy",
        busyUntil: inTwoHours,
        when: thursday,
        at: now,
      }).ok,
    ).toBe(true);
  });

  it("refuses a slot that falls inside a busy window", () => {
    const inOneHour = new Date(now.getTime() + 60 * 60_000);
    const verdict = canServeAt({
      state: "busy",
      busyUntil: inTwoHours,
      when: inOneHour,
      at: now,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("busyThen");
      expect(verdict.freeFrom).toEqual(inTwoHours);
    }
  });

  it("treats a slot already in the past as now, rather than passing it", () => {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
    expect(
      canServeAt({ state: "on_job", when: yesterday, at: now }).ok,
    ).toBe(false);
  });

  it("ignores an unreadable slot rather than throwing", () => {
    expect(
      canServeAt({ state: "today", when: "not a date", at: now }).ok,
    ).toBe(true);
  });
});

describe("an emergency is always now", () => {
  /**
   * The customer choosing emergency has already answered the question. Even if
   * a slot came along with it, an emergency is judged against this minute.
   */
  it("ignores any slot attached to an emergency", () => {
    expect(
      servingWhen({ urgency: "emergency", scheduledFor: thursday.toISOString() }),
    ).toBeNull();
  });

  it("honours the slot for every other urgency", () => {
    const iso = thursday.toISOString();
    expect(servingWhen({ urgency: "soon", scheduledFor: iso })).toBe(iso);
    expect(servingWhen({ urgency: "routine", scheduledFor: iso })).toBe(iso);
    expect(servingWhen({ urgency: "routine", scheduledFor: null })).toBeNull();
  });
});

describe("what stops a booking and what merely warns", () => {
  const refused = canServeAt({ state: "on_job", when: null, at: now });

  /**
   * THE DECISION THE WHOLE CHANGE RESTS ON. An emergency assigned to somebody
   * who cannot come now spends the five minutes that matter most, so it is a
   * stop and the customer is handed people who can come.
   */
  it("stops an emergency against somebody who cannot come now", () => {
    expect(blocksBooking({ urgency: "emergency", verdict: refused })).toBe(true);
  });

  /**
   * Everything else goes through: the professional is told, and if they have
   * not answered inside the first-refusal window the customer can hand it on.
   * That half already exists on the booking page.
   */
  it("lets a scheduled job through with a warning instead", () => {
    for (const urgency of ["soon", "routine", null, undefined]) {
      expect(blocksBooking({ urgency, verdict: refused })).toBe(false);
    }
  });

  it("stops nothing when the professional can come", () => {
    expect(
      blocksBooking({ urgency: "emergency", verdict: { ok: true } }),
    ).toBe(false);
  });
});

describe("a window somebody else already has", () => {
  /*
   * A DIFFERENT KIND OF NO FROM THE OTHER THREE. Those are things the
   * professional has said about themselves and the product says them and
   * carries on, because the booking would still work. This one would not:
   * `enforce_slot_capacity` refuses the insert, so carrying on past it walks
   * somebody through four screens to a confirm button that cannot succeed.
   */

  it("refuses whatever else is true about them", () => {
    const verdict = canServeAt({
      state: "now",
      when: "2026-09-17T08:15:00Z",
      windowFull: true,
    });
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toBe("full");
  });

  it("offers no freeFrom, because a full window says nothing about when it empties", () => {
    // The screen offers the next slot the picker itself would show, rather
    // than a time this function would have to invent.
    const verdict = canServeAt({ state: "now", windowFull: true });
    expect(!verdict.ok && verdict.freeFrom).toBeNull();
  });

  it("is not the same as nobody having asked", () => {
    // `windowFull` undefined is every caller from before capacity existed. It
    // must read as "unknown", never as "there is room" — and never as "full".
    expect(canServeAt({ state: "now" }).ok).toBe(true);
    expect(canServeAt({ state: "now", windowFull: false }).ok).toBe(true);
  });

  it("stops a booking at every urgency, not only an emergency", () => {
    const verdict = canServeAt({
      state: "now",
      when: "2026-09-17T08:15:00Z",
      windowFull: true,
    });
    for (const urgency of ["emergency", "soon", "routine", null]) {
      expect(blocksBooking({ urgency, verdict })).toBe(true);
    }
  });

  it("leaves the other refusals exactly as they were", () => {
    // The full-window rule is an exception to "only an emergency stops", not a
    // tightening of it: a scheduled job against somebody on another job right
    // now is still a perfectly good booking.
    const onJob = canServeAt({ state: "on_job" });
    expect(blocksBooking({ urgency: "emergency", verdict: onJob })).toBe(true);
    expect(blocksBooking({ urgency: "routine", verdict: onJob })).toBe(false);
  });
});
