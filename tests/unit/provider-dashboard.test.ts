import { describe, expect, it } from "vitest";

import {
  availabilityNow,
  availableUntil,
  bandForTrades,
  clampRate,
  endOfWorkingDay,
  minutesRemaining,
} from "@/lib/provider";
import {
  NEWCOMER_SLOT_INDEX,
  isNewProvider,
  withNewcomerSlot,
} from "@/lib/data/ranking";

/**
 * The three things a professional controls, and the one thing they do not.
 *
 * Each is bounded differently on purpose, and the boundaries are the whole
 * content: a rate is clamped, a flag decays, and exposure is a position rather
 * than a number.
 */

describe("the rate is clamped to the published band", () => {
  const band = { low: 900, high: 4500 };

  it("leaves an honest figure alone", () => {
    expect(clampRate({ rate: 1500, band })).toMatchObject({
      rate: 1500,
      clampedTo: null,
    });
  });

  it("lifts a figure that undercuts the band", () => {
    // Rs 200 for plumbing is not a bargain, it is a way onto a card and into
    // somebody's house before quoting the real number on the doorstep.
    expect(clampRate({ rate: 200, band })).toMatchObject({
      rate: 900,
      clampedTo: "low",
    });
  });

  it("caps a figure above the band", () => {
    expect(clampRate({ rate: 9000, band })).toMatchObject({
      rate: 4500,
      clampedTo: "high",
    });
  });

  it("rounds to whole rupees", () => {
    // "from Rs 1,499.50" on a card reads as a bug.
    expect(clampRate({ rate: 1499.5, band }).rate).toBe(1500);
  });

  it("survives a band stored the wrong way round", () => {
    // A data error must not trap every professional at an impossible figure.
    const verdict = clampRate({ rate: 2000, band: { low: 4500, high: 900 } });
    expect(verdict).toMatchObject({ rate: 2000, low: 900, high: 4500 });
  });
});

describe("one rate across several trades", () => {
  const bands = [
    { slug: "plumbing", low: 900, high: 4500 },
    { slug: "water-tank-cleaning", low: 1500, high: 7000 },
    { slug: "painting", low: 3000, high: 40000 },
  ];

  it("takes the union, so a second trade never lowers a ceiling", () => {
    // Punishing breadth would mean taking on more work costs you the ability
    // to price the work you already had.
    expect(bandForTrades(["plumbing", "water-tank-cleaning"], bands)).toEqual({
      low: 900,
      high: 7000,
    });
  });

  it("ignores a trade it does not know rather than collapsing the band", () => {
    expect(bandForTrades(["plumbing", "chimney-sweeping"], bands)).toEqual({
      low: 900,
      high: 4500,
    });
  });

  it("returns null when nothing matches, rather than a band of zero", () => {
    // Zero would silently pin every multi-trade professional to the floor.
    expect(bandForTrades(["chimney-sweeping"], bands)).toBeNull();
  });
});

describe("available now expires on its own", () => {
  // 10am Nepal time on a Friday. Nepal is UTC+05:45 and has no daylight saving.
  const morning = new Date("2026-09-18T04:15:00Z");

  it("lapses at the end of the working day, not after a fixed number of hours", () => {
    // A tradesperson is available "today", not "for six hours", and a flag
    // that dies at 3pm while they are still working is its own kind of lie.
    const until = availableUntil({ on: true, at: morning })!;
    expect(until.toISOString()).toBe(endOfWorkingDay(morning).toISOString());
    expect(until.getTime()).toBeGreaterThan(morning.getTime());
  });

  it("gives tomorrow when switched on after the day has ended", () => {
    // 9pm. Handing them an already-dead flag would read as a broken button.
    const night = new Date("2026-09-18T15:15:00Z");
    const until = availableUntil({ on: true, at: night })!;
    expect(until.getTime()).toBeGreaterThan(night.getTime());
  });

  it("clears the stamp when switched off", () => {
    expect(availableUntil({ on: false })).toBeNull();
  });

  it("shows now while the stamp holds and falls back after it", () => {
    const until = availableUntil({ on: true, at: morning })!;

    expect(
      availabilityNow({ availableUntil: until, base: "today", at: morning }),
    ).toBe("now");

    // The next morning: the flag is gone and they are whatever they normally
    // are. Nothing had to run overnight for that to be true.
    const tomorrow = new Date(morning.getTime() + 24 * 60 * 60_000);
    expect(
      availabilityNow({ availableUntil: until, base: "today", at: tomorrow }),
    ).toBe("today");
  });

  it("never invents now from a missing or unreadable stamp", () => {
    for (const stamp of [null, undefined, "not a date"]) {
      expect(
        availabilityNow({ availableUntil: stamp, base: "scheduled", at: morning }),
      ).toBe("scheduled");
    }
  });

  it("reports the time left, and nothing once it has passed", () => {
    const until = availableUntil({ on: true, at: morning })!;
    expect(minutesRemaining({ availableUntil: until, at: morning })).toBeGreaterThan(0);

    const after = new Date(until.getTime() + 60_000);
    expect(minutesRemaining({ availableUntil: until, at: after })).toBeNull();
  });
});

describe("the newcomer slot", () => {
  const rows = (news: number[]) =>
    Array.from({ length: 8 }, (_, i) => ({ id: i, isNew: news.includes(i) }));
  const slot = (list: Array<{ id: number; isNew: boolean }>, emergency = false) =>
    withNewcomerSlot({ ranked: list, isNew: (row) => row.isNew, emergency });

  it("is new until three jobs are done", () => {
    expect(isNewProvider(0)).toBe(true);
    expect(isNewProvider(2)).toBe(true);
    expect(isNewProvider(3)).toBe(false);
  });

  it("lifts the best newcomer into third place", () => {
    const result = slot(rows([6]));
    expect(result[NEWCOMER_SLOT_INDEX].id).toBe(6);
    // The two strongest are untouched — the slot buys exposure, not the top.
    expect(result[0].id).toBe(0);
    expect(result[1].id).toBe(1);
  });

  it("promotes only one, however many are waiting", () => {
    // Bounded by construction. Fifty newcomers cannot flood a page, which is
    // the property a score boost cannot offer.
    const result = slot(rows([5, 6, 7]));
    expect(result.slice(0, 3).filter((row) => row.isNew)).toHaveLength(1);
    expect(result[NEWCOMER_SLOT_INDEX].id).toBe(5);
  });

  it("never demotes a newcomer who earned a higher place", () => {
    // The bug this shape hides most easily: a slot that is also a ceiling.
    const result = slot(rows([0]));
    expect(result[0].id).toBe(0);
  });

  it("does nothing on an emergency", () => {
    // Somebody with a burst pipe at 2am is the worst person to hand a
    // first-timer, and that search sorts on who turns up rather than who is
    // best.
    const result = slot(rows([6]), true);
    expect(result.map((row) => row.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("leaves a list too short to have a third place alone", () => {
    const short = [{ id: 0, isNew: false }, { id: 1, isNew: true }];
    expect(slot(short).map((row) => row.id)).toEqual([0, 1]);
  });

  it("changes nothing when there are no newcomers", () => {
    expect(slot(rows([])).map((row) => row.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
