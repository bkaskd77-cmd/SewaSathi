import { describe, expect, it } from "vitest";

import { judgeRefund, refundCeiling, refundFunding } from "@/lib/payments/refund";

/**
 * The last two rungs of the guarantee, and the ceiling they cannot pass.
 *
 * A refund is the expensive half of this policy and the only half that moves
 * real money, so every branch here is a branch somebody could otherwise reach
 * by asking nicely.
 */

const settled = {
  finalAmount: 3000,
  customerReportedAmount: 3000,
  amountMismatchAt: null,
  paymentStatus: "paid",
};

describe("what a booking can ever pay back", () => {
  it("is the recorded amount when both figures agree", () => {
    expect(refundCeiling(settled)).toEqual({ ok: true, ceiling: 3000 });
  });

  it("takes the lower figure when they differ", () => {
    /*
     * The cash screen promises "up to the amount you enter", so the customer's
     * own number is part of the ceiling — but taking the HIGHER of the two
     * would let somebody name a figure and be refunded it.
     */
    expect(
      refundCeiling({ ...settled, customerReportedAmount: 1800 }),
    ).toEqual({ ok: true, ceiling: 1800 });
    expect(
      refundCeiling({ ...settled, finalAmount: 1800, customerReportedAmount: 3000 }),
    ).toEqual({ ok: true, ceiling: 1800 });
  });

  it("refuses entirely while the two figures are in dispute", () => {
    /*
     * A standing mismatch means a person is already deciding which number is
     * true. Refunding against either would pick a side silently.
     */
    expect(
      refundCeiling({ ...settled, amountMismatchAt: "2026-09-19T10:00:00Z" }),
    ).toEqual({ ok: false, reason: "amount-disputed" });
  });

  it("refuses on a job nobody has paid for", () => {
    expect(refundCeiling({ ...settled, paymentStatus: "unpaid" })).toEqual({
      ok: false,
      reason: "not-settled",
    });
  });

  it("refuses when no amount was ever recorded", () => {
    expect(refundCeiling({ ...settled, finalAmount: null })).toEqual({
      ok: false,
      reason: "no-amount",
    });
  });
});

describe("judging one proposed refund", () => {
  const judge = (amount: number, over = {}) =>
    judgeRefund({ amount, subject: { ...settled, ...over }, alreadyRefunded: 0 });

  it("calls the whole recorded amount full labour", () => {
    expect(judge(3000)).toEqual({ outcome: "full-labour", amount: 3000 });
  });

  it("calls anything under it partial", () => {
    expect(judge(1200)).toEqual({
      outcome: "partial-labour",
      amount: 1200,
      ceiling: 3000,
    });
  });

  it("refuses a rupee over the ceiling", () => {
    expect(judge(3001)).toEqual({ outcome: "above-ceiling", ceiling: 3000 });
  });

  it("refuses zero and negatives", () => {
    expect(judge(0)).toEqual({ outcome: "invalid", reason: "not-positive" });
    expect(judge(-500)).toEqual({ outcome: "invalid", reason: "not-positive" });
  });

  it("refuses a fraction of a rupee", () => {
    expect(judge(1200.5)).toEqual({ outcome: "invalid", reason: "not-a-number" });
  });

  it("never pays twice on one claim", () => {
    /*
     * Checked BEFORE any arithmetic, so a second payout cannot fall through
     * into a branch that would approve it — the same ordering rule
     * `judgeFinalAmount` keeps for `blocked`.
     */
    expect(
      judgeRefund({ amount: 500, subject: settled, alreadyRefunded: 1200 }),
    ).toEqual({ outcome: "already-refunded", paid: 1200 });
  });

  it("reports the booking's own refusal rather than an amount error", () => {
    // "That amount is invalid" would be the wrong sentence for a job that
    // simply has not settled yet.
    expect(judge(1000, { paymentStatus: "unpaid" })).toEqual({
      outcome: "unavailable",
      reason: "not-settled",
    });
  });
});

describe("who funds it", () => {
  it("returns the platform's fee in proportion and charges the rest forward", () => {
    // 3,000 collected at 15%: fee 450, earning 2,550.
    const full = refundFunding({ refund: 3000, platformFee: 450, providerEarning: 2550 });
    expect(full).toEqual({
      customerReceives: 3000,
      platformReturns: 450,
      providerOwes: 2550,
    });
  });

  it("returns only part of the fee on a partial refund", () => {
    const half = refundFunding({ refund: 1500, platformFee: 450, providerEarning: 2550 });
    expect(half.customerReceives).toBe(1500);
    expect(half.platformReturns).toBe(225);
    expect(half.providerOwes).toBe(1275);
  });

  it("never returns more fee than was taken", () => {
    const over = refundFunding({ refund: 9000, platformFee: 450, providerEarning: 2550 });
    expect(over.platformReturns).toBe(450);
  });

  it("always reconciles to the amount the customer receives", () => {
    for (const refund of [1, 250, 999, 1500, 3000]) {
      const f = refundFunding({ refund, platformFee: 450, providerEarning: 2550 });
      expect(f.platformReturns + f.providerOwes).toBe(f.customerReceives);
    }
  });
});
