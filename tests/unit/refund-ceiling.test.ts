import { describe, expect, it } from "vitest";

import {
  MATERIALS_CEILING_SHARE_BPS,
  materialsRead,
  refundCeiling,
} from "@/lib/payments/refund";

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
    expect(refundCeiling(SETTLED)).toEqual({
      ok: true,
      ceiling: 3000,
      settled: 3000,
      materials: null,
    });
  });

  it("is the settled figure when the customer never typed one", () => {
    expect(
      refundCeiling({ ...SETTLED, customerReportedAmount: null }),
    ).toEqual({ ok: true, ceiling: 3000, settled: 3000, materials: null });
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
    expect(refundCeiling(RESOLVED)).toEqual({
      ok: true,
      ceiling: 3000,
      settled: 3000,
      materials: null,
    });
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

/* ------------------------------------------------------------------ *
 * The parts are not the labour
 * ------------------------------------------------------------------ */

/**
 * THE GUARANTEE IS ON THE WORKMANSHIP. A tap the professional bought, fitted
 * correctly, and left in the wall is the customer's tap; refunding its cost as
 * though it were labour charges somebody for a part that never failed.
 *
 * Every case below is also asserted against `enforce_claim_refund` in
 * `tests/db/guarantee-claims.test.ts` on the same fixture, because this is the
 * second time a refund rule has existed in two places and the first time the
 * two were compared.
 */
describe("what the parts cost does to the ceiling", () => {
  const withParts = (
    materialsRupees: number | null,
    partsFailed: boolean | null,
    settled = 6000,
  ) =>
    refundCeiling({
      ...SETTLED,
      finalAmount: settled,
      customerReportedAmount: settled,
      materialsRupees,
      partsFailed,
    });

  it("comes off when the parts were sound", () => {
    expect(withParts(2000, false)).toEqual({
      ok: true,
      ceiling: 4000,
      settled: 6000,
      materials: { entered: 2000, deducted: 2000, capped: false, why: "deducted" },
    });
  });

  /*
   * The parts failing is the claim. Deducting them would refuse to pay back
   * the one thing that went wrong.
   */
  it("stays whole when the parts themselves failed", () => {
    expect(withParts(2000, true)).toEqual({
      ok: true,
      ceiling: 6000,
      settled: 6000,
      materials: { entered: 2000, deducted: 0, capped: false, why: "partsFailed" },
    });
  });

  /*
   * RULE 6, AND IT POINTS ONLY ONE WAY HERE. The deduction needs somebody to
   * have said the parts were sound. A claim from before the question existed
   * reads null, and null is not a "no" — it must not quietly cost a customer
   * the price of the parts on an answer nobody gave.
   */
  it("deducts nothing when nobody recorded whether the parts failed", () => {
    expect(withParts(2000, null)).toEqual({
      ok: true,
      ceiling: 6000,
      settled: 6000,
      materials: { entered: 2000, deducted: 0, capped: false, why: "notRecorded" },
    });
  });

  /*
   * A ZERO IS AN ANSWER AND A NULL IS NOT. "No parts on this job" is a thing
   * somebody said; it reads as a materials line of nothing rather than as an
   * absent one, so a screen can tell the two apart.
   */
  it("tells 'no parts' apart from 'nobody said'", () => {
    expect(withParts(0, false)).toMatchObject({
      materials: { entered: 0, deducted: 0, why: "deducted" },
    });
    expect(withParts(null, false)).toMatchObject({
      ceiling: 6000,
      materials: null,
    });
  });
});

/**
 * THE ANTI-INFLATION GATE, AND IT BITES HERE BEFORE IT BITES COMMISSION.
 *
 * Nothing evidences the materials figure — no receipts exist in this product —
 * and it now reduces what a professional can be asked to pay back. Uncapped,
 * "materials Rs 5,999 on a Rs 6,000 job" turns a full refund into one rupee
 * and every other guard waves it through, because each of them is about the
 * total.
 */
describe("the share a materials line may take off a refund", () => {
  it("never reduces the ceiling below half the settled figure", () => {
    const read = materialsRead(6000, 5999, false)!;
    expect(read.entered).toBe(5999);
    expect(read.deducted).toBe(3000);
    expect(read.capped).toBe(true);
  });

  it("reports what was entered as well as what came off", () => {
    // A silent clamp would hide the one signal that says somebody may be
    // inflating the line. The adjudicator sees both numbers.
    expect(
      refundCeiling({
        ...SETTLED,
        finalAmount: 6000,
        customerReportedAmount: 6000,
        materialsRupees: 5999,
        partsFailed: false,
      }),
    ).toEqual({
      ok: true,
      ceiling: 3000,
      settled: 6000,
      materials: { entered: 5999, deducted: 3000, capped: true, why: "deducted" },
    });
  });

  it("leaves an ordinary materials-heavy job under the cap", () => {
    // A compressor at 40% of a Rs 10,000 appliance job is not the case this
    // gate is for, and it must not read as one.
    const read = materialsRead(10000, 4000, false)!;
    expect(read.deducted).toBe(4000);
    expect(read.capped).toBe(false);
  });

  it("truncates the cap the way Postgres integer division does", () => {
    // `(final_amount * 5000) / 10000` on integers truncates. The two halves of
    // this rule have to round the same way or they disagree by a rupee on
    // every odd amount — which is exactly how a ceiling drifts unnoticed.
    expect(materialsRead(4001, 4000, false)!.deducted).toBe(2000);
  });

  it("is the published share, not a number invented here", () => {
    expect(MATERIALS_CEILING_SHARE_BPS).toBe(5000);
  });
});
