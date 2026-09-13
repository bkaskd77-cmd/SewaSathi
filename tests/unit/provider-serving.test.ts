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
