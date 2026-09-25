import { describe, expect, it } from "vitest";

import {
  claimRateWorthReading,
  CLAIM_RATE_ATTENTION,
  CLAIM_RATE_MIN_JOBS,
} from "@/lib/config/guarantee";
import { PAYOUT_RULES, refundFunding } from "@/lib/payments/client";

/**
 * The two things the refund screen says before somebody presses the button.
 *
 * NEITHER OF THEM DECIDES ANYTHING, and that is the property worth testing.
 * The signals are context for a person; the consequence preview is arithmetic
 * the server repeats. A test that let either become an input to the refund
 * would be testing the wrong product.
 */

describe("a customer's claim rate", () => {
  /*
   * RULE 6, AND THE DENOMINATOR IS THE WHOLE RULE. A first-ever job that went
   * wrong is a 100% claim rate and means nothing at all — reporting it as a
   * rate is how a signal starts crying wolf, which is exactly what makes the
   * real ones get skimmed.
   */
  it("has no rate at all below the minimum number of jobs", () => {
    for (let jobs = 0; jobs < CLAIM_RATE_MIN_JOBS; jobs += 1) {
      const read = claimRateWorthReading({ claims: jobs, completedBookings: jobs });
      expect(read.rate).toBeNull();
      expect(read.worthReading).toBe(false);
    }
  });

  it("reads a real rate once there are enough jobs", () => {
    const read = claimRateWorthReading({
      claims: 3,
      completedBookings: CLAIM_RATE_MIN_JOBS,
    });
    expect(read.rate).toBe(1);
    expect(read.worthReading).toBe(true);
  });

  it("leaves an ordinary customer alone", () => {
    // Two claims across forty jobs is somebody who has had two bad jobs.
    const read = claimRateWorthReading({ claims: 2, completedBookings: 40 });
    expect(read.rate).toBeCloseTo(0.05);
    expect(read.worthReading).toBe(false);
  });

  it("says nothing when the job count could not be read", () => {
    // Not looking must never render as measured — least of all here, where a
    // fabricated rate would sit beside a decision about somebody's money.
    expect(
      claimRateWorthReading({ claims: 9, completedBookings: null }),
    ).toEqual({ rate: null, worthReading: false });
    // Zero claims on an unreadable denominator is still no rate, not 0%.
    expect(
      claimRateWorthReading({ claims: 0, completedBookings: null }),
    ).toEqual({ rate: null, worthReading: false });
  });

  /**
   * THE PROPERTY, BECAUSE THE UNIT CASES CANNOT ISOLATE THE NULL CHECK.
   *
   * `null < CLAIM_RATE_MIN_JOBS` coerces to `0 < 3` and is true, so while the
   * floor is above zero the explicit null check can be deleted with every case
   * above still green — proven by deleting it. This asserts the thing that
   * must hold whatever the floor is set to: a rate is a real number or it is
   * null, and never Infinity or NaN on a screen deciding somebody's money.
   */
  it("never produces a rate that is not a real number", () => {
    const inputs = [
      { claims: 0, completedBookings: 0 },
      { claims: 5, completedBookings: 0 },
      { claims: 5, completedBookings: null },
      { claims: 0, completedBookings: null },
      { claims: 1, completedBookings: 10 },
    ];
    for (const input of inputs) {
      const { rate } = claimRateWorthReading(input);
      expect(rate === null || Number.isFinite(rate)).toBe(true);
    }
  });

  it("is a published threshold rather than a number in a component", () => {
    expect(CLAIM_RATE_ATTENTION).toBe(0.5);
    expect(CLAIM_RATE_MIN_JOBS).toBe(3);
  });
});

/**
 * What the button will do, computed before it is pressed.
 *
 * THE SAME FUNCTION THE SERVER RUNS, on the same frozen split — that is the
 * only reason a preview is honest rather than a second opinion that can drift.
 * `agreeRefund` calls `refundFunding` with `booking.platform_fee` and
 * `booking.provider_earning`; the screen calls it with the same two columns
 * carried onto the claim row.
 */
describe("the consequence shown before agreeing", () => {
  // 6,000 collected at 15%: fee 900, earning 5,100.
  const split = { platformFee: 900, providerEarning: 5100 };

  it("always reconciles to what the customer receives", () => {
    for (const refund of [1, 250, 1500, 3000, 6000]) {
      const f = refundFunding({ refund, ...split });
      expect(f.platformReturns + f.providerOwes).toBe(f.customerReceives);
    }
  });

  it("returns the whole commission on a full refund", () => {
    // The line that lets us say we do not profit from failed work.
    expect(refundFunding({ refund: 6000, ...split })).toEqual({
      customerReceives: 6000,
      platformReturns: 900,
      providerOwes: 5100,
    });
  });

  it("returns commission in proportion on a partial one", () => {
    const half = refundFunding({ refund: 3000, ...split });
    expect(half.platformReturns).toBe(450);
    expect(half.providerOwes).toBe(2550);
  });

  /**
   * THE LINE THAT KEEPS "OWES Rs 5,100" HONEST. It is not money we will have:
   * it is a debt netted forward at a quarter of each payout and never chased
   * backward. The screen turns it into a number of jobs, and this is the
   * arithmetic it uses.
   */
  it("turns the debt into a number of payouts of this size", () => {
    const owed = refundFunding({ refund: 6000, ...split }).providerOwes;
    const perPayout =
      (split.providerEarning * PAYOUT_RULES.redoRecoveryCapBps) / 10000;
    expect(perPayout).toBe(1275);
    expect(Math.ceil(owed / perPayout)).toBe(4);
  });

  it("recovers a quarter of a payout and no more", () => {
    // Half was considered and refused: no week should go to zero.
    expect(PAYOUT_RULES.redoRecoveryCapBps).toBe(2500);
  });
});
