import { describe, expect, it } from "vitest";

import {
  bookableDays,
  formatSlotInstant,
  isValidSlot,
  slotLabel,
  slotsForDay,
  WORKING_HOURS,
} from "@/lib/booking";

/**
 * Working hours and slots.
 *
 * The contract that matters: the list a customer is offered and the check that
 * accepts their choice are the same rule. A slot the picker shows must always
 * validate, and one it hides must always be refused — otherwise somebody picks
 * a time and is then told no.
 *
 * Nepal Time is UTC+05:45, so 02:15Z is 08:00 in Kathmandu. Every fixed clock
 * below is written in UTC with the Nepal time in the comment, because that
 * conversion is exactly where this code goes wrong.
 */

/** 2026-09-02, 08:00 Nepal Time. */
const MORNING = new Date("2026-09-02T02:15:00Z");
/** 2026-09-02, 21:45 Nepal Time — after the last window has started. */
const LATE = new Date("2026-09-02T16:00:00Z");

describe("the offered list and the validator agree", () => {
  it("accepts every slot it offers", () => {
    for (const day of bookableDays(MORNING).slice(0, 5)) {
      for (const slot of slotsForDay(day.value, MORNING)) {
        expect(isValidSlot(slot.start, MORNING)).toBe(true);
      }
    }
  });

  it("refuses a time it never offered", () => {
    // 05:00 Nepal Time — before working hours, so it is not in any list.
    expect(isValidSlot("2026-09-03T23:15:00Z", MORNING)).toBe(false);
    // Not on a two-hour boundary.
    expect(isValidSlot("2026-09-03T02:45:00Z", MORNING)).toBe(false);
  });

  it("refuses nonsense rather than throwing", () => {
    expect(isValidSlot("not a date", MORNING)).toBe(false);
    expect(isValidSlot("", MORNING)).toBe(false);
  });
});

describe("nothing in the past", () => {
  it("drops windows that have already started", () => {
    const hours = slotsForDay("2026-09-02", MORNING).map((s) => s.startHour);
    expect(hours).not.toContain(7);
  });

  it("drops the window that is too soon to reach", () => {
    // At 08:00 the 09:00 window is only an hour out, inside the 90-minute
    // lead time somebody needs to actually get there.
    const hours = slotsForDay("2026-09-02", MORNING).map((s) => s.startHour);
    expect(hours).not.toContain(9);
    expect(hours[0]).toBe(11);
  });

  it("returns nothing for a day that has gone", () => {
    expect(slotsForDay("2026-09-01", MORNING)).toEqual([]);
  });

  it("returns nothing late at night, but tomorrow is whole", () => {
    expect(slotsForDay("2026-09-02", LATE)).toEqual([]);
    expect(slotsForDay("2026-09-03", LATE)).toHaveLength(7);
  });
});

describe("working hours", () => {
  it("never offers a window outside them", () => {
    for (const slot of slotsForDay("2026-09-03", MORNING)) {
      expect(slot.startHour).toBeGreaterThanOrEqual(WORKING_HOURS.startHour);
      expect(slot.startHour).toBeLessThanOrEqual(WORKING_HOURS.lastStartHour);
    }
  });

  it("stops at the horizon", () => {
    const days = bookableDays(MORNING);
    expect(days).toHaveLength(WORKING_HOURS.horizonDays);
    expect(slotsForDay("2026-10-01", MORNING)).toEqual([]);
  });
});

describe("Nepal Time, not UTC", () => {
  it("labels a stored instant with the hour the customer chose", () => {
    // This shipped wrong twice: toISOString() showed a Kathmandu reader an
    // hour 5h45m off the one they booked.
    const slot = slotsForDay("2026-09-03", MORNING).find((s) => s.startHour === 11);
    expect(slot).toBeDefined();
    expect(formatSlotInstant(slot!.start)).toBe("2026-09-03 · 11:00 – 13:00");
  });

  it("puts a late-evening Nepal slot on the right Nepal date", () => {
    // 19:00 NPT on the 3rd is 13:15Z on the 3rd — the date must not slide.
    const slot = slotsForDay("2026-09-03", MORNING).find((s) => s.startHour === 19);
    expect(slot!.start).toBe("2026-09-03T13:15:00.000Z");
    expect(formatSlotInstant(slot!.start)).toBe("2026-09-03 · 19:00 – 21:00");
  });

  it("uses Latin digits, matching the number rule", () => {
    expect(slotLabel({ start: "", end: "", startHour: 7, endHour: 9 })).toBe(
      "07:00 – 09:00",
    );
  });
});
