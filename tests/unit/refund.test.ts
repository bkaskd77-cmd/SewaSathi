import { describe, expect, it } from "vitest";

import {
  isRefundStale,
  judgeRefund,
  refundCeiling,
  refundFunding,
  refundRail,
  REFUND_PAYMENT_DAYS,
} from "@/lib/payments/refund";
import { PAYOUT_RULES } from "@/lib/payments/payout";

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

  /*
   * THE RULE REVERSED, AND THIS TEST IS WHY IT SURVIVED SO LONG. It used to
   * assert the LOWER of the two figures, on the reading that the cash screen's
   * "up to the amount you enter" was a ceiling. It is a floor: somebody who
   * handed over 3,000 and mistyped 1,800 is covered for what was actually paid
   * once a person has established it.
   *
   * The database was changed to cap at `final_amount` and this file was not.
   * A green assertion of the old rule is exactly what let the two diverge
   * unnoticed — the test agreed with the code and neither agreed with Postgres.
   * `tests/unit/refund-ceiling.test.ts` now pins the rule and
   * `tests/db/guarantee-claims.test.ts` pins the same numbers against the
   * trigger, so the comparison exists rather than being nobody's job.
   *
   * What stops somebody naming a figure and being refunded it is unchanged and
   * lives elsewhere: a customer's typed amount reaches `final_amount` only
   * when an admin adjudicates, and no browser can write that column.
   */
  it("is the settled figure even when the customer typed a different one", () => {
    expect(
      refundCeiling({ ...settled, customerReportedAmount: 1800 }),
    ).toEqual({ ok: true, ceiling: 3000 });
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

describe("which rail the money goes back on", () => {
  it("khalti with a key is the only automatic one", () => {
    expect(refundRail({ method: "khalti", configured: true })).toEqual({
      automatic: true,
      reason: null,
    });
  });

  it("eSewa is manual because ePay v2 has no merchant-initiated refund", () => {
    const rail = refundRail({ method: "esewa", configured: true });
    expect(rail.automatic).toBe(false);
    expect(rail.reason).toBe("esewaHasNoApi");
  });

  it("cash is manual by nature, configured or not", () => {
    for (const configured of [true, false]) {
      const rail = refundRail({ method: "cash", configured });
      expect(rail.automatic).toBe(false);
      expect(rail.reason).toBe("cashByHand");
    }
  });

  /*
   * ABSENT IS NOT WORKING. With no Khalti secret the refund call returns
   * `notConfigured`, so a screen that had already said "we will send this
   * automatically" would be promising on a setting nobody checked — and the
   * refund would sit there while everyone assumed it had gone.
   */
  it("says a missing key is a missing key, not just 'manual'", () => {
    const rail = refundRail({ method: "khalti", configured: false });
    expect(rail.automatic).toBe(false);
    expect(rail.reason).toBe("gatewayNotConfigured");
  });
});

describe("an approved refund that has not been sent", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it("is not stale the day it is approved", () => {
    expect(isRefundStale({ requestedAt: daysAgo(0), now })).toBe(false);
    expect(isRefundStale({ requestedAt: daysAgo(1), now })).toBe(false);
  });

  it("is stale once it passes the published number of days", () => {
    expect(isRefundStale({ requestedAt: daysAgo(REFUND_PAYMENT_DAYS), now })).toBe(
      true,
    );
    expect(isRefundStale({ requestedAt: daysAgo(30), now })).toBe(true);
  });

  /*
   * The number is argued from what we already pay ourselves: a professional's
   * money is held 24 hours on digital and seven days on cash, and a customer
   * we have agreed to pay back must not wait longer than the slowest thing we
   * do for our own side.
   */
  it("flags sooner than the slowest payout hold", () => {
    expect(REFUND_PAYMENT_DAYS).toBeLessThan(PAYOUT_RULES.cashHoldHours / 24);
  });

  it("treats an unreadable date as not stale rather than as stale", () => {
    // A parse failure is not evidence that anything is overdue. Reading it as
    // stale would put a warning on a row nobody can act on.
    expect(isRefundStale({ requestedAt: "not a date", now })).toBe(false);
  });
});
