import { describe, expect, it } from "vitest";

import {
  QUOTE_VALID_HOURS,
  quoteExpiringSoon,
  quoteExpiryFrom,
  quoteState,
  surveyOutcome,
  workMayStart,
  type QuoteFacts,
} from "@/lib/booking";
import {
  blindCashEntry,
  canSettle,
  commissionBasis,
  judgeFinalAmount,
  settleSplit,
} from "@/lib/payments";

/**
 * A trade with no price until somebody has looked.
 *
 * TWO INDEPENDENT GUARDS, AND THIS FILE IS THE SECOND. `enforce_survey_quote`
 * in Postgres refuses to let a survey booking reach `in_progress` without an
 * approved band; `tests/db/survey-quote.test.ts` proves that half. These tests
 * prove the other: that every money function refuses a bandless booking on its
 * own, rather than coercing a missing band into zero and carrying on. The
 * database guard being correct is not a reason for the application to be wrong.
 */

const now = new Date("2026-09-16T06:00:00Z");

function survey(overrides: Partial<QuoteFacts> = {}): QuoteFacts {
  return {
    quoteModel: "survey",
    quotedMin: null,
    quotedMax: null,
    ...overrides,
  };
}

function priced(overrides: Partial<QuoteFacts> = {}): QuoteFacts {
  return survey({
    quotedMin: 12000,
    quotedMax: 20000,
    surveyedAt: now.toISOString(),
    quoteExpiresAt: quoteExpiryFrom(now).toISOString(),
    ...overrides,
  });
}

describe("where a surveyed price has got to", () => {
  it("is awaiting a survey while there is no band", () => {
    expect(quoteState(survey(), now)).toBe("awaiting-survey");
  });

  it("is awaiting a survey even when stamps exist but the band does not", () => {
    // A half-written row is not a priced job. Reading the timestamps first
    // would say "waiting on the customer" about a price nobody wrote.
    expect(
      quoteState(survey({ surveyedAt: now.toISOString() }), now),
    ).toBe("awaiting-survey");
  });

  it("waits on the customer once a band is recorded", () => {
    expect(quoteState(priced(), now)).toBe("awaiting-approval");
  });

  it("expires at the deadline, not a moment before", () => {
    const expires = quoteExpiryFrom(now);
    const facts = priced({ quoteExpiresAt: expires.toISOString() });

    const justBefore = new Date(expires.getTime() - 1);
    expect(quoteState(facts, justBefore)).toBe("awaiting-approval");
    expect(quoteState(facts, expires)).toBe("expired");
  });

  it("holds the price for exactly the published window", () => {
    expect(quoteExpiryFrom(now).getTime() - now.getTime()).toBe(
      QUOTE_VALID_HOURS * 60 * 60_000,
    );
  });

  it("keeps an approval after the window passes", () => {
    /*
     * ORDER MATTERS. The customer agreed inside the window and the job is
     * going ahead; re-reading it as "expired" the next day would strand a move
     * that was already booked, and `workMayStart` would start refusing a job
     * somebody is standing in the middle of.
     */
    const facts = priced({ quoteApprovedAt: now.toISOString() });
    const later = new Date(now.getTime() + 10 * 24 * 60 * 60_000);
    expect(quoteState(facts, later)).toBe("approved");
  });

  it("does not expire a quote whose deadline was never stamped", () => {
    // A missing stamp is a bug in the write path. Treating it as lapsed would
    // cancel somebody's move over it.
    expect(quoteState(priced({ quoteExpiresAt: null }), now)).toBe(
      "awaiting-approval",
    );
  });

  it("reminds once, near the end, and not before", () => {
    const expires = quoteExpiryFrom(now);
    const facts = priced({ quoteExpiresAt: expires.toISOString() });

    expect(quoteExpiringSoon(facts, now)).toBe(false);
    expect(
      quoteExpiringSoon(facts, new Date(expires.getTime() - 60 * 60_000)),
    ).toBe(true);
    // Past the deadline there is nothing left to remind anybody about.
    expect(quoteExpiringSoon(facts, expires)).toBe(false);
  });
});

describe("work cannot start on a price nobody agreed to", () => {
  it("refuses a survey job with no band", () => {
    expect(workMayStart(survey(), now)).toBe(false);
  });

  it("refuses a priced job the customer has not answered", () => {
    expect(workMayStart(priced(), now)).toBe(false);
  });

  it("allows it once they have", () => {
    expect(
      workMayStart(priced({ quoteApprovedAt: now.toISOString() }), now),
    ).toBe(true);
  });

  it("never applies to a banded booking", () => {
    // Which had its band from the moment it was made. Applying this rule there
    // would stop every ordinary job in the product.
    expect(
      workMayStart({ quoteModel: "band", quotedMin: 900, quotedMax: 4500 }, now),
    ).toBe(true);
  });
});

describe("a decline costs the surveyor nothing and scores against nobody", () => {
  it("pays the visit fee when the customer says no", () => {
    expect(surveyOutcome("declined", true).payVisitFee).toBe(true);
  });

  it("pays it when nobody answers in time, for the same reason", () => {
    // The trip happened either way. Paying for one and not the other would
    // make a professional's earnings depend on how fast a stranger replies.
    expect(surveyOutcome("expired", true).payVisitFee).toBe(true);
  });

  it("pays nothing when the move goes ahead, because the survey is part of it", () => {
    expect(surveyOutcome("approved", true).payVisitFee).toBe(false);
  });

  it("pays nothing when nobody went", () => {
    /*
     * NO TRIP, NO FEE — the cheapest guard against farming this, and the one
     * that reuses machinery already here. A fee reimburses a journey, so
     * quoting high from the sofa has to earn nothing or the whole thing is a
     * payment for typing a number.
     */
    expect(surveyOutcome("declined", false).payVisitFee).toBe(false);
    expect(surveyOutcome("expired", false).payVisitFee).toBe(false);
  });

  it("errs toward not paying when nobody said", () => {
    // The default is the safe direction. `enforce_survey_visit_fee` refuses the
    // row outright anyway; this is what the screen says.
    expect(surveyOutcome("declined").payVisitFee).toBe(false);
  });

  it("never counts against the professional, whatever happened", () => {
    /*
     * A customer turning down a price is not a professional failing. Counting
     * it would teach surveyors to quote low enough to be accepted rather than
     * high enough to be true — the same shape as under-reporting a cash job,
     * with the sign flipped.
     */
    for (const state of [
      "awaiting-survey",
      "awaiting-approval",
      "approved",
      "declined",
      "expired",
    ] as const) {
      expect(surveyOutcome(state, true).countsAgainstProvider).toBe(false);
    }
  });
});

describe("every money surface refuses a booking with no band", () => {
  /*
   * GUARD TWO. The trigger should make all of this unreachable — and "should be
   * unreachable" is not a guarantee on the path where somebody is typing an
   * amount in a customer's kitchen.
   */

  it("judges nothing against a missing band", () => {
    expect(judgeFinalAmount(15000, { min: null, max: null }).outcome).toBe(
      "not-surveyed",
    );
  });

  it("refuses a half-written band as well", () => {
    expect(judgeFinalAmount(15000, { min: 12000, max: null }).outcome).toBe(
      "not-surveyed",
    );
    expect(judgeFinalAmount(15000, { min: null, max: 20000 }).outcome).toBe(
      "not-surveyed",
    );
  });

  it("does not let a missing band read as a lenient one", () => {
    /*
     * THE FAILURE THIS PREVENTS. `null * 2` is NaN, and every comparison
     * against NaN is false — so the blocked branch would stop blocking and an
     * absurd figure would fall through into "within band". A missing ceiling
     * must never be a high ceiling.
     */
    const absurd = judgeFinalAmount(9_999_999, { min: null, max: null });
    expect(absurd.outcome).not.toBe("within-band");
    expect(absurd.outcome).not.toBe("needs-approval");
  });

  it("cannot be settled, approved or not", () => {
    const verdict = judgeFinalAmount(15000, { min: null, max: null });
    expect(canSettle(verdict, false).ok).toBe(false);
    // Not even with an approval flag: there was no figure to approve.
    expect(canSettle(verdict, true).ok).toBe(false);
  });

  it("says the quote is the problem, not the amount", () => {
    // "That amount is invalid" tells somebody standing in a customer's kitchen
    // to retype a number that was never the fault.
    const outcome = canSettle(
      judgeFinalAmount(15000, { min: null, max: null }),
      false,
    );
    expect(!outcome.ok && outcome.reason).toBe("quoteNotApproved");
  });

  it("keeps cash entry blind when there is no band to compare against", () => {
    /*
     * THE SAFE DIRECTION, and not merely the cautious one. Blind entry is what
     * makes the customer's figure independent evidence; falling through would
     * SHOW them the professional's number on the one trade where the amounts
     * are largest.
     */
    expect(
      blindCashEntry({ method: "cash", finalAmount: 15000, quotedMax: null }),
    ).toBe(true);
  });

  it("charges the fee on what was collected rather than inventing a floor", () => {
    // NaN would make the fee and the earning both NaN. Charging on the amount
    // is the only option that cannot invent money in either direction.
    expect(commissionBasis(15000, null)).toBe(15000);

    const split = settleSplit({ amount: 15000, quotedMin: null });
    expect(Number.isFinite(split.platformFee)).toBe(true);
    expect(Number.isFinite(split.providerEarning)).toBe(true);
    expect(split.platformFee + split.providerEarning).toBe(15000);
  });
});
