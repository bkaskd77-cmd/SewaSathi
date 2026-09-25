import { describe, expect, it } from "vitest";

import { judgeMismatchResolution } from "@/lib/payments/pricing";

/**
 * Which figure a settled mismatch settles at.
 *
 * WHY THE RULE IS PURE AND TESTED HERE. It decides an amount of money a person
 * will be charged and another person paid, from a screen that did not exist
 * until now. Everything around it — the queue, the widget, the settlement —
 * can be rebuilt; this is the part that must not quietly change.
 *
 * The band throughout is 1,000–1,500, so the hard ceiling is 3,000.
 */

const QUOTE = { min: 1000, max: 1500 };

describe("picking one of the two figures", () => {
  it("takes the professional's when that is the decision", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "provider" },
        recorded: 1500,
        reported: 2000,
        quote: QUOTE,
      }),
    ).toEqual({ ok: true, amount: 1500, source: "provider", note: null });
  });

  it("takes the customer's when that is the decision", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "customer" },
        recorded: 1500,
        reported: 2000,
        quote: QUOTE,
      }),
    ).toEqual({ ok: true, amount: 2000, source: "customer", note: null });
  });

  /*
   * A customer who never typed a figure — they declined to confirm rather than
   * disagreeing — leaves nothing to pick. Saying so beats settling silently on
   * the only number present, which would be the professional's.
   */
  it("refuses the customer's figure when there is not one", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "customer" },
        recorded: 1500,
        reported: null,
        quote: QUOTE,
      }),
    ).toEqual({ ok: false, reason: "noCustomerFigure" });
  });
});

describe("a third figure", () => {
  it("settles at the number a person arrived at", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "adjudicated", amount: 1800, note: "agreed on the phone" },
        recorded: 1500,
        reported: 2000,
        quote: QUOTE,
      }),
    ).toEqual({
      ok: true,
      amount: 1800,
      source: "adjudicated",
      note: "agreed on the phone",
    });
  });

  it("needs a reason", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "adjudicated", amount: 1800, note: "   " },
        recorded: 1500,
        reported: 2000,
        quote: QUOTE,
      }),
    ).toEqual({ ok: false, reason: "reasonRequired" });
  });

  it("asks for the reason before it judges the amount", () => {
    // Both are wrong. The one worth saying is the one the adjudicator can fix
    // without re-deciding the case.
    expect(
      judgeMismatchResolution({
        choice: { source: "adjudicated", amount: 99999, note: "" },
        recorded: 1500,
        reported: 2000,
        quote: QUOTE,
      }),
    ).toEqual({ ok: false, reason: "reasonRequired" });
  });
});

describe("the 2x ceiling applies to whichever figure is chosen", () => {
  /*
   * THE HOLE THIS CLOSES. Nothing checks what a customer types into the blind
   * cash box — it is evidence, not an instruction. If the ceiling applied only
   * to an adjudicated figure, an admin could settle a 1,500 job at any amount
   * at all simply by choosing "the customer's number" instead of typing one.
   * The ceiling is a customer protection, so it cannot be escaped by picking a
   * party rather than naming a figure.
   */
  it("refuses the customer's figure above 2x the quoted max", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "customer" },
        recorded: 1500,
        reported: 3001,
        quote: QUOTE,
      }),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("refuses a third figure above it too", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "adjudicated", amount: 3001, note: "they insist" },
        recorded: 1500,
        reported: 2000,
        quote: QUOTE,
      }),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("allows the ceiling itself", () => {
    const ruling = judgeMismatchResolution({
      choice: { source: "adjudicated", amount: 3000, note: "two rooms, not one" },
      recorded: 1500,
      reported: 2000,
      quote: QUOTE,
    });
    expect(ruling.ok).toBe(true);
  });

  /*
   * An over-band figure is exactly what this screen exists to settle, and
   * `needs-approval` means "a human must agree" — which is what is happening.
   * Refusing it would leave the honest overrun unsettleable.
   */
  it("allows an over-band figure, because a person is the approval", () => {
    const ruling = judgeMismatchResolution({
      choice: { source: "customer" },
      recorded: 1500,
      reported: 2200,
      quote: QUOTE,
    });
    expect(ruling).toEqual({ ok: true, amount: 2200, source: "customer", note: null });
  });
});

describe("amounts that are not amounts", () => {
  it("refuses one below the minimum", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "adjudicated", amount: 50, note: "barely anything" },
        recorded: 1500,
        reported: 2000,
        quote: QUOTE,
      }),
    ).toEqual({ ok: false, reason: "tooLow" });
  });

  it("refuses a fraction", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "adjudicated", amount: 1800.5, note: "split it" },
        recorded: 1500,
        reported: 2000,
        quote: QUOTE,
      }),
    ).toEqual({ ok: false, reason: "notANumber" });
  });

  /*
   * A SURVEY-PRICED JOB NOBODY PRICED. There is no band, so there is no
   * ceiling — and a missing band is not a lenient one. Same reasoning as
   * `judgeFinalAmount`, which this defers to rather than re-deriving.
   */
  it("refuses when there is no band to judge against", () => {
    expect(
      judgeMismatchResolution({
        choice: { source: "provider" },
        recorded: 1500,
        reported: 2000,
        quote: { min: null, max: null },
      }),
    ).toEqual({ ok: false, reason: "notSurveyed" });
  });
});
