import { describe, expect, it } from "vitest";

import { refundCeiling } from "@/lib/payments/refund";

/**
 * The most a booking can pay back, and it is the SETTLED figure.
 *
 * WHY THIS TEST EXISTS. `enforce_claim_refund` in Postgres and `refundCeiling`
 * here are two implementations of one money rule, and they disagreed: the
 * migration that let a person settle a disputed amount changed the database to
 * cap at `final_amount` and left this file capping at
 * `min(final_amount, customer_reported_amount)`. The screen showed the
 * adjudicator the lower number; the database would have accepted the higher
 * one. Nothing failed, because nothing compared them.
 *
 * THE DIRECTION OF THE BUG IS THE POINT. `min()` re-imposes the customer's own
 * typed figure as their cover — including after a person established that they
 * really paid more. The cash screen's promise is a FLOOR on what they are
 * covered for, never a cap: somebody who handed over 3,000 and mistyped 1,800
 * is covered for what was actually paid once somebody has established it.
 *
 * `tests/db/guarantee-claims.test.ts` asserts the same numbers against the
 * trigger. Neither test alone would have caught this — the missing thing was
 * the comparison.
 */

const SETTLED = {
  finalAmount: 3000,
  customerReportedAmount: 3000,
  amountMismatchAt: null,
  amountMismatchResolvedAt: null,
  paymentStatus: "paid",
};

describe("when the two figures agree", () => {
  it("is the settled figure", () => {
    expect(refundCeiling(SETTLED)).toEqual({ ok: true, ceiling: 3000 });
  });

  it("is the settled figure when the customer never typed one", () => {
    expect(
      refundCeiling({ ...SETTLED, customerReportedAmount: null }),
    ).toEqual({ ok: true, ceiling: 3000 });
  });
});

describe("when a person has settled a disagreement", () => {
  const RESOLVED = {
    ...SETTLED,
    // What they originally typed, kept as evidence.
    customerReportedAmount: 1800,
    amountMismatchAt: "2026-09-20T10:00:00Z",
    amountMismatchResolvedAt: "2026-09-21T09:00:00Z",
  };

  /*
   * THE CASE THAT WAS WRONG. The adjudicator established 3,000 was handed
   * over; `min()` would have covered them for the 1,800 they mistyped.
   */
  it("covers the settled figure, not the customer's original", () => {
    expect(refundCeiling(RESOLVED)).toEqual({ ok: true, ceiling: 3000 });
  });

  /*
   * And the permanence bug: the stamp never clears, so reading it alone
   * refuses every future claim on a job that was settled weeks ago.
   */
  it("does not refuse for ever because the stamp is still set", () => {
    expect(refundCeiling(RESOLVED).ok).toBe(true);
  });
});

describe("when the disagreement is still open", () => {
  it("refuses outright, because refunding either figure picks a side", () => {
    expect(
      refundCeiling({
        ...SETTLED,
        customerReportedAmount: 1800,
        amountMismatchAt: "2026-09-20T10:00:00Z",
        amountMismatchResolvedAt: null,
      }),
    ).toEqual({ ok: false, reason: "amount-disputed" });
  });
});

describe("when there is nothing to refund from", () => {
  it("refuses an unsettled booking", () => {
    expect(refundCeiling({ ...SETTLED, paymentStatus: "unpaid" })).toEqual({
      ok: false,
      reason: "not-settled",
    });
  });

  it("refuses a booking with no recorded amount", () => {
    expect(refundCeiling({ ...SETTLED, finalAmount: null })).toEqual({
      ok: false,
      reason: "no-amount",
    });
  });
});
