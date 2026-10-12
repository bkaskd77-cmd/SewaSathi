import { describe, expect, it } from "vitest";

import {
  RANKING_EVIDENCE_FLOOR,
  ROTATION_MIN_LISTINGS,
  TRIAGE_OUTCOME_FLOOR,
  TUNING_FLOORS,
  readiness,
  rotationOfferFloor,
} from "@/lib/config/tuning-floors";

/**
 * The floors that say when a loop may be argued about.
 *
 * WRITTEN AS THE NUMBERS, NOT AGAINST THE CONSTANTS, which is the
 * `ACTIVITY_FLOOR` lesson: every case there read the constant the code also
 * read, so lowering the floor to 1 left them all green and they asserted that
 * the floor is the floor. The cases below say nineteen-then-twenty, so a floor
 * that moved would have to move these too — and moving them is the decision.
 */
describe("a floor is a count with a stated unit", () => {
  it("holds ranking out at nineteen and lets it in at twenty", () => {
    expect(readiness(19, RANKING_EVIDENCE_FLOOR)).toEqual({
      ready: false,
      have: 19,
      floor: 20,
      short: 1,
    });
    expect(readiness(20, RANKING_EVIDENCE_FLOOR)?.ready).toBe(true);
  });

  it("never reports a negative shortfall", () => {
    // A loop well past its floor is ready by a distance nobody needs; "short"
    // is what is missing, and a negative there would render as "-14 more".
    expect(readiness(300, RANKING_EVIDENCE_FLOOR)?.short).toBe(0);
  });

  it("scales the rotation floor with the pool, because a share does", () => {
    /*
     * THE DERIVATION, ASSERTED. A bigger pool makes each share smaller, so the
     * same "one offer must not move it much" rule needs more offers. A fixed
     * number would be right for exactly one pool size.
     */
    expect(rotationOfferFloor(5)).toBe(50);
    expect(rotationOfferFloor(10)).toBe(100);
  });

  it("never asks for less than the smallest pool's floor", () => {
    // Two live listings is the state today. Rotation among two is alternation,
    // so the floor must not quietly shrink to meet it.
    expect(rotationOfferFloor(2)).toBe(rotationOfferFloor(ROTATION_MIN_LISTINGS));
    expect(rotationOfferFloor(0)).toBe(50);
  });

  it("tells a failed read apart from an empty one", () => {
    /*
     * Rule 6 on the one screen built to say how much is known. "We could not
     * count" and "there is nothing to count" are different sentences, and the
     * second is a measurement.
     */
    expect(readiness(null, TRIAGE_OUTCOME_FLOOR)).toBeNull();
    expect(readiness(0, TRIAGE_OUTCOME_FLOOR)).toEqual({
      ready: false,
      have: 0,
      floor: 30,
      short: 30,
    });
  });
});

describe("every loop declares what one unit of evidence is", () => {
  it("names a unit and an anchor for each", () => {
    /*
     * A COUNT WITH NO DENOMINATOR IS WHAT `claimRateWorthReading` REFUSES, and
     * an anchor is what stops a floor being a guess that justifies itself. Both
     * are asserted as non-empty rather than left to review, because the failure
     * mode is somebody adding a fourth loop with a bare number.
     */
    for (const [name, entry] of Object.entries(TUNING_FLOORS)) {
      expect(entry.loop, `${name} names itself`).toBe(name);
      expect(entry.unit.length, `${name} has no unit`).toBeGreaterThan(10);
      expect(entry.anchor.length, `${name} has no anchor`).toBeGreaterThan(10);
      expect(entry.floor, `${name}'s floor is not a count`).toBeGreaterThan(0);
    }
  });

  it("keeps the rotation entry's floor equal to its own derivation", () => {
    // The declared number and the function must not drift: the table is what
    // the screen prints and the function is what a per-category check would
    // call, and two answers to one question is how a rule gets lost.
    expect(TUNING_FLOORS.rotation.floor).toBe(
      rotationOfferFloor(ROTATION_MIN_LISTINGS),
    );
  });
});
