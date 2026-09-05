import { describe, expect, it } from "vitest";

import {
  blindCashEntry,
  commissionBasis,
  commissionBpsFor,
  payoutDueAt,
  settleSplit,
  COMMISSION_BPS,
  PAYOUT_RULES,
} from "@/lib/payments/client";
import {
  needsBandReview,
  BAND_REVIEW_THRESHOLD_PCT,
  type PricingSignal,
} from "@/lib/data/pricing-signals";
import {
  hasBaseline,
  mixByCategory,
  mixByMonth,
  mixByWard,
  overallMix,
  type PaymentMixRow,
} from "@/lib/data/payment-mix";

/**
 * Under-reporting, and the four things that make it not worth doing.
 *
 * The attack these defend against: a professional takes Rs 2,000 in cash and
 * records 1,000. Nothing in this product can see the notes change hands, and
 * in the collusive case nobody in the room is lying to anybody in the room —
 * so validating the number harder cannot work. The mechanisms below remove the
 * payoff instead, and every one of them has an honest case it must not punish.
 */

describe("the fee is charged on the floor, so reporting less earns nothing", () => {
  const band = { min: 900, max: 4000 };

  it("charges on the amount when the job is inside the band", () => {
    expect(commissionBasis(1500, band.min)).toBe(1500);
  });

  it("charges on the published minimum when the report is below it", () => {
    // The whole mechanism in one line. Recording 400 on a job whose floor is
    // 900 does not reduce the fee, so there is nothing to gain by doing it —
    // and therefore no reason for anybody to ask a customer to go along.
    expect(commissionBasis(400, band.min)).toBe(900);
  });

  it("makes under-reporting strictly worse than the truth", () => {
    const honest = settleSplit({ amount: 2000, quotedMin: band.min });
    const cheated = settleSplit({ amount: 1000, quotedMin: band.min });

    // Same fee on both, so the only thing under-reporting changes is that the
    // professional is recorded as having earned less.
    expect(cheated.platformFee).toBe(
      settleSplit({ amount: 1000, quotedMin: 1000 }).platformFee,
    );
    expect(cheated.providerEarning).toBeLessThan(honest.providerEarning);
  });

  it("never bills a professional more than they collected", () => {
    // A tiny reported amount against a high floor. The fee is capped at what
    // was taken: they keep nothing that time and are told why, but a platform
    // that hands somebody an invoice for having done a job is a platform
    // people leave.
    const split = settleSplit({ amount: 200, quotedMin: 4000 });
    expect(split.providerEarning).toBeGreaterThanOrEqual(0);
    expect(split.platformFee).toBeLessThanOrEqual(200);
  });

  it("always reconciles to the rupee", () => {
    for (const amount of [999, 1001, 1333, 2500, 7777]) {
      const split = settleSplit({ amount, quotedMin: 900 });
      expect(split.platformFee + split.providerEarning).toBe(amount);
    }
  });

  it("flags when the floor was what lifted the basis", () => {
    // What the professional's card reads to decide whether to mention it. A
    // rule that is invisible until it takes money is the kind that loses the
    // honest half of the supply.
    expect(settleSplit({ amount: 400, quotedMin: 900 }).floorApplied).toBe(true);
    expect(settleSplit({ amount: 1500, quotedMin: 900 }).floorApplied).toBe(false);
  });

  it("comes off entirely when support upholds an appeal", () => {
    const waived = settleSplit({ amount: 400, quotedMin: 900, floorWaived: true });
    expect(waived.basis).toBe(400);
    expect(waived.platformFee).toBe(
      Math.round((400 * COMMISSION_BPS) / 10_000),
    );
  });
});

describe("a category that keeps landing under its floor is our pricing bug", () => {
  const signal = (over: Partial<PricingSignal> = {}): PricingSignal => ({
    categorySlug: "plumbing",
    settledJobs: 100,
    belowFloorJobs: 30,
    belowFloorPct: 30,
    aboveBandJobs: 2,
    quotedMin: 900,
    quotedMax: 4000,
    medianFinal: 1200,
    p25Final: 700,
    p75Final: 2100,
    ...over,
  });

  it("asks for a band review when jobs bunch under the minimum", () => {
    expect(needsBandReview(signal())).toBe(true);
  });

  it("says nothing about a category that sits inside its band", () => {
    expect(needsBandReview(signal({ belowFloorJobs: 2, belowFloorPct: 2 }))).toBe(
      false,
    );
  });

  it("refuses to draw a conclusion from a handful of jobs", () => {
    // Acting on noise is how a correct band gets "corrected" into a wrong one.
    expect(
      needsBandReview(signal({ settledJobs: 4, belowFloorJobs: 3, belowFloorPct: 75 })),
    ).toBe(false);
  });

  it("has a threshold that is a review trigger, not an automatic change", () => {
    expect(BAND_REVIEW_THRESHOLD_PCT).toBeGreaterThan(0);
    expect(BAND_REVIEW_THRESHOLD_PCT).toBeLessThan(100);
  });
});

describe("the customer is the witness, but only where their answer is evidence", () => {
  it("hides the figure on a cash job settled inside the band", () => {
    // Nothing has shown them a number yet, so what they type is independent.
    expect(
      blindCashEntry({ method: "cash", finalAmount: 1500, quotedMax: 4000 }),
    ).toBe(true);
  });

  it("shows it when they have already approved that exact amount", () => {
    // Over-band figures go through an explicit approval, so the customer knows
    // the number. Hiding it then is theatre, and it punishes the honest
    // overrun the approval flow exists for.
    expect(
      blindCashEntry({ method: "cash", finalAmount: 5000, quotedMax: 4000 }),
    ).toBe(false);
  });

  it("never applies to a gateway payment", () => {
    // eSewa and Khalti tell us the figure themselves; there is nothing to
    // witness.
    expect(
      blindCashEntry({ method: "esewa", finalAmount: 1500, quotedMax: 4000 }),
    ).toBe(false);
  });

  it("does not ask before the professional has recorded anything", () => {
    expect(
      blindCashEntry({ method: "cash", finalAmount: null, quotedMax: 4000 }),
    ).toBe(false);
  });
});

describe("digital is paid out sooner, and the levers stay off until chosen", () => {
  const settled = new Date("2026-09-05T06:00:00.000Z");

  it("pays a gateway settlement days before a cash one", () => {
    const digital = payoutDueAt(settled, "esewa").getTime();
    const cash = payoutDueAt(settled, "cash").getTime();
    expect(digital).toBeLessThan(cash);
  });

  it("takes the hold straight from the configured hours", () => {
    expect(payoutDueAt(settled, "khalti").getTime() - settled.getTime()).toBe(
      PAYOUT_RULES.digitalHoldHours * 3_600_000,
    );
  });

  it("discounts digital and leaves cash exactly where it was", () => {
    /*
     * The asymmetry is the decision, not an oversight. A discount on digital
     * and a surcharge on cash are arithmetically almost the same gap and
     * morally nothing alike: cash in Nepal is not a preference, it is the only
     * instrument a lot of people have, and taxing it would charge the poorest
     * customers for our fraud problem. A discount rewards a choice; a
     * surcharge punishes a circumstance.
     */
    expect(commissionBpsFor("cash", COMMISSION_BPS)).toBe(COMMISSION_BPS);
    expect(commissionBpsFor("esewa", COMMISSION_BPS)).toBe(
      COMMISSION_BPS - PAYOUT_RULES.digitalDiscountBps,
    );
    expect(PAYOUT_RULES.cashSurchargeBps).toBe(0);
  });

  it("passes the discount through to what the professional keeps", () => {
    // A lever nothing reads is a comment. Same job, same amount, two methods.
    const cash = settleSplit({
      amount: 2000,
      quotedMin: 900,
      commissionBps: commissionBpsFor("cash", COMMISSION_BPS),
    });
    const digital = settleSplit({
      amount: 2000,
      quotedMin: 900,
      commissionBps: commissionBpsFor("khalti", COMMISSION_BPS),
    });
    expect(digital.providerEarning).toBeGreaterThan(cash.providerEarning);
  });

  it("can never configure a rate outside 0-100%", () => {
    expect(commissionBpsFor("cash", 9_900)).toBeLessThanOrEqual(10_000);
    expect(commissionBpsFor("esewa", 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("the cash share, before any money is spent moving it", () => {
  const row = (over: Partial<PaymentMixRow> = {}): PaymentMixRow => ({
    categorySlug: "plumbing",
    areaKey: "lalitpur-4",
    month: "2026-09-01",
    settledJobs: 10,
    cashJobs: 6,
    cashPct: 60,
    gross: 20_000,
    cashGross: 12_000,
    ...over,
  });

  it("reports the share of money, not only the share of jobs", () => {
    /*
     * The two diverge in the direction that matters: cash tends to be the big
     * jobs. Here half the jobs are cash and three quarters of the money is —
     * a platform reading only the first number would think its exposure was
     * half what it is.
     */
    const rows = [
      row({ settledJobs: 5, cashJobs: 5, gross: 30_000, cashGross: 30_000 }),
      row({ settledJobs: 5, cashJobs: 0, gross: 10_000, cashGross: 0 }),
    ];
    const all = overallMix(rows);
    expect(all.cashPct).toBe(50);
    expect(all.cashValuePct).toBe(75);
  });

  it("splits by category and by ward, the two axes a decision is taken on", () => {
    const rows = [
      row({ categorySlug: "plumbing", areaKey: "lalitpur-4" }),
      row({ categorySlug: "painting", areaKey: "kathmandu-16", cashJobs: 1, cashGross: 2_000 }),
    ];
    expect(mixByCategory(rows).map((m) => m.key).sort()).toEqual([
      "painting",
      "plumbing",
    ]);
    expect(mixByWard(rows).map((m) => m.key).sort()).toEqual([
      "kathmandu-16",
      "lalitpur-4",
    ]);
  });

  it("orders by money at risk, so the biggest exposure is read first", () => {
    const rows = [
      row({ categorySlug: "small", gross: 10_000, cashGross: 1_000 }),
      row({ categorySlug: "big", gross: 10_000, cashGross: 9_000 }),
    ];
    expect(mixByCategory(rows)[0].key).toBe("big");
  });

  it("puts months in order, because a baseline is a before and an after", () => {
    const rows = [
      row({ month: "2026-10-01" }),
      row({ month: "2026-08-01" }),
      row({ month: "2026-09-01" }),
    ];
    expect(mixByMonth(rows).map((m) => m.key)).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ]);
  });

  it("refuses to call a handful of jobs a baseline", () => {
    // Spending real money against one or two customers' habits is how an
    // incentive gets credited with a change it did not cause.
    expect(hasBaseline(overallMix([row({ settledJobs: 8, cashJobs: 5 })]))).toBe(
      false,
    );
    expect(
      hasBaseline(overallMix([row({ settledJobs: 40, cashJobs: 25 })])),
    ).toBe(true);
  });

  it("says nothing rather than dividing by zero", () => {
    const empty = overallMix([]);
    expect(empty.cashPct).toBe(0);
    expect(empty.cashValuePct).toBe(0);
    expect(hasBaseline(empty)).toBe(false);
  });
});
