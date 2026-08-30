import { describe, expect, it } from "vitest";

import {
  canSettle,
  judgeFinalAmount,
  PRICE_RULES,
  splitAmount,
  COMMISSION_BPS,
  canTransitionPayment,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  type PaymentStatus,
} from "@/lib/payments";

/**
 * The price integrity rules.
 *
 * This is the part of payments that matters most: the final figure is typed by
 * a professional standing in somebody's kitchen, and the landing page promises
 * there will be no surprises. These tests are that promise, asserted.
 *
 * The band used throughout is plumbing's real one — 900 to 4,500 — so the
 * numbers below are the ones a customer would actually see.
 */

const BAND = { min: 900, max: 4500 };
const CEILING = BAND.max * PRICE_RULES.hardCeilingMultiple; // 9,000

describe("an amount inside the quoted band", () => {
  it("is confirmed without asking again", () => {
    // Asking a customer to re-approve what they already agreed to teaches
    // them to tap through approvals without reading.
    for (const amount of [900, 2000, 4500]) {
      expect(judgeFinalAmount(amount, BAND)).toEqual({ outcome: "within-band" });
    }
  });

  it("allows less than the minimum quoted, with no approval flow", () => {
    // A job that turned out easier should not need ceremony to charge less.
    expect(judgeFinalAmount(500, BAND)).toEqual({ outcome: "within-band" });
  });

  it("treats the quoted maximum itself as inside", () => {
    expect(judgeFinalAmount(BAND.max, BAND).outcome).toBe("within-band");
  });
});

describe("an amount above the band", () => {
  it("needs the customer's approval", () => {
    expect(judgeFinalAmount(5000, BAND)).toEqual({
      outcome: "needs-approval",
      overBy: 500,
    });
  });

  it("cannot settle until they have given it", () => {
    const verdict = judgeFinalAmount(5000, BAND);
    expect(canSettle(verdict, false)).toEqual({
      ok: false,
      reason: "awaitingCustomerApproval",
    });
    expect(canSettle(verdict, true)).toEqual({ ok: true });
  });

  it("still needs approval one rupee over", () => {
    expect(judgeFinalAmount(BAND.max + 1, BAND).outcome).toBe("needs-approval");
  });
});

describe("an amount above the hard ceiling", () => {
  it("is blocked outright", () => {
    expect(judgeFinalAmount(CEILING + 1, BAND)).toEqual({
      outcome: "blocked",
      ceiling: CEILING,
    });
  });

  it("cannot be approved by the customer at all", () => {
    // The point of the ceiling: a tired customer who trusts the professional
    // in front of them must not be able to wave through a mistyped amount.
    const verdict = judgeFinalAmount(CEILING + 1, BAND);
    expect(canSettle(verdict, true)).toEqual({
      ok: false,
      reason: "aboveCeiling",
    });
  });

  it("catches the extra-zero typo", () => {
    // 1,500 mistyped as 15,000 is ten times the quoted max, and this is the
    // case the ceiling was chosen to catch.
    expect(judgeFinalAmount(15_000, BAND).outcome).toBe("blocked");
  });

  it("permits exactly the ceiling, with approval", () => {
    expect(judgeFinalAmount(CEILING, BAND).outcome).toBe("needs-approval");
  });
});

describe("nonsense amounts", () => {
  it("refuses anything below the floor", () => {
    expect(judgeFinalAmount(0, BAND)).toEqual({
      outcome: "invalid",
      reason: "too-low",
    });
    expect(judgeFinalAmount(-500, BAND).outcome).toBe("invalid");
  });

  it("refuses fractions", () => {
    // Every amount in this product is integer NPR.
    expect(judgeFinalAmount(1500.5, BAND)).toEqual({
      outcome: "invalid",
      reason: "not-a-number",
    });
  });

  it("never settles an invalid amount, approved or not", () => {
    const verdict = judgeFinalAmount(0, BAND);
    expect(canSettle(verdict, true).ok).toBe(false);
  });
});

describe("the commission split", () => {
  it("always sums back to what the customer paid", () => {
    // A payout report that does not reconcile to the rupee is a payout report
    // nobody trusts, so the fee is rounded and the provider takes the rest.
    for (const total of [900, 1234, 2500, 4500, 7777, 9000]) {
      const split = splitAmount(total);
      expect(split.platformFee + split.providerEarning).toBe(total);
    }
  });

  it("applies the stated rate", () => {
    expect(COMMISSION_BPS).toBe(1500);
    const split = splitAmount(2000);
    expect(split.platformFee).toBe(300);
    expect(split.providerEarning).toBe(1700);
  });

  it("records the rate it used, so a later change cannot restate it", () => {
    expect(splitAmount(2000, 1000).commissionBps).toBe(1000);
    expect(splitAmount(2000, 1000).platformFee).toBe(200);
  });
});

describe("the payment state machine", () => {
  it("lets cash settle without a gateway", () => {
    // No gateway to initiate with: the customer confirming receipt is what
    // settles it.
    expect(canTransitionPayment("pending", "paid")).toBe(true);
  });

  it("lets a failed payment be retried", () => {
    expect(canTransitionPayment("failed", "initiated")).toBe(true);
  });

  it("never un-settles a payment", () => {
    expect(canTransitionPayment("paid", "pending")).toBe(false);
    expect(canTransitionPayment("paid", "failed")).toBe(false);
    expect(canTransitionPayment("paid", "initiated")).toBe(false);
  });

  it("treats a full refund as final", () => {
    for (const to of PAYMENT_STATUSES) {
      expect(canTransitionPayment("refunded", to)).toBe(false);
    }
  });

  it("allows a partial refund to be topped up to a full one", () => {
    expect(canTransitionPayment("partially_refunded", "refunded")).toBe(true);
    expect(canTransitionPayment("partially_refunded", "partially_refunded")).toBe(
      true,
    );
  });

  it("only names statuses that exist", () => {
    for (const [from, targets] of Object.entries(PAYMENT_TRANSITIONS)) {
      expect(PAYMENT_STATUSES).toContain(from as PaymentStatus);
      for (const to of targets) expect(PAYMENT_STATUSES).toContain(to);
    }
  });
});
