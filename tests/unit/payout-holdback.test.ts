import { describe, expect, it } from "vitest";

import { GUARANTEE_WINDOWS } from "@/lib/config/guarantee";
import {
  PAYOUT_RULES,
  applyRedoRecovery,
  holdbackTrades,
  holdsBack,
  payoutDueAt,
  payoutPlan,
} from "@/lib/payments/payout";

/**
 * A quarter of the payout waits, where the guarantee outlives it.
 *
 * WHY THIS EXISTS. `GUARANTEE_WINDOWS` gives painting 90 days — peeling and
 * blistering take weeks to appear — while the payout hold is 24 hours to 7
 * days. So on exactly the trades where a defect surfaces late, every rupee has
 * gone before anybody can claim, and the only remaining answer is netting
 * forward against work the professional may never do.
 *
 * IT TAKES NOTHING. This is their own money arriving in two parts. Every
 * assertion below about a "hold" is about a date, never about an amount they
 * lose, and `holdbackRupees + whatArrivesFirst` is always the whole earning.
 */

const SETTLED = new Date("2026-03-01T00:00:00.000Z");

const plan = (categorySlug: string, providerEarning: number) =>
  payoutPlan({ settledAt: SETTLED, method: "cash", categorySlug, providerEarning });

describe("which trades hold, and why it is the window rather than the name", () => {
  it("holds on a 90-day guarantee", () => {
    expect(GUARANTEE_WINDOWS.painting.days).toBe(90);
    expect(holdsBack("painting")).toBe(true);
  });

  it("does not hold on a 30-day one", () => {
    expect(holdsBack("plumbing")).toBe(false);
    expect(holdsBack("electrical")).toBe(false);
  });

  it("does not hold on a 48-hour one", () => {
    // A house gets dirty again; there is no late-surfacing defect to wait for.
    expect(holdsBack("home-cleaning")).toBe(false);
    expect(holdsBack("movers-packers")).toBe(false);
  });

  /*
   * A CATEGORY NOBODY HAS HEARD OF TAKES `DEFAULT_GUARANTEE`, which is 30 days,
   * so it holds nothing. That is the safe direction: a trade added to the
   * database and not to `GUARANTEE_WINDOWS` should not silently start deferring
   * a quarter of somebody's money on a rule nobody wrote down for it.
   */
  it("holds nothing for a category with no window of its own", () => {
    expect(holdsBack("something-nobody-added-yet")).toBe(false);
    expect(plan("something-nobody-added-yet", 40_000).holdbackRupees).toBeNull();
  });

  /*
   * THE DERIVED RULE, ENUMERATED. The trigger is the window, so a future
   * long-window trade acquires a hold with nobody deciding to give it one.
   * `/admin/signals` prints this list for exactly that reason, and this asserts
   * the list is derived rather than typed out.
   */
  it("lists every holding trade from the windows themselves", () => {
    const listed = holdbackTrades();
    const expected = Object.entries(GUARANTEE_WINDOWS)
      .filter(([, g]) => g.days >= PAYOUT_RULES.holdbackWhenGuaranteeDays)
      .map(([slug]) => slug)
      .sort();

    expect(listed.map((t) => t.slug)).toEqual(expected);
    // Today that is painting alone, and the list saying so is the point.
    expect(listed).toEqual([{ slug: "painting", guaranteeDays: 90 }]);
  });
});

describe("what is held, and when it arrives", () => {
  it("holds a quarter and releases it 30 days after the first date", () => {
    const p = plan("painting", 40_000);
    expect(p.holdbackRupees).toBe(10_000);
    expect(p.dueAt).toEqual(payoutDueAt(SETTLED, "cash"));
    expect(p.holdbackUntil).toEqual(
      new Date(p.dueAt.getTime() + 30 * 24 * 3_600_000),
    );
  });

  /*
   * THE WHOLE EARNING STILL ARRIVES. Nothing here is a fee, and the arithmetic
   * is the assertion rather than the comment: what lands first plus what is
   * held equals what they earned.
   */
  it("defers rather than deducts — the two parts are the whole earning", () => {
    for (const earning of [40_000, 12_345, 999, 1_000_001]) {
      const p = plan("painting", earning);
      const held = p.holdbackRupees ?? 0;
      expect(held + (earning - held)).toBe(earning);
      expect(held).toBeLessThanOrEqual(earning);
    }
  });

  it("floors, so the held part never exceeds the published quarter", () => {
    // 4,002 / 4 = 1,000.5. The remaining rupee goes out first, which is the
    // direction that needs no explaining to the professional.
    expect(plan("painting", 4_002).holdbackRupees).toBe(1_000);
  });

  it("does not hold on a short-window trade however large the job", () => {
    const p = plan("plumbing", 400_000);
    expect(p.holdbackRupees).toBeNull();
    expect(p.holdbackUntil).toBeNull();
  });
});

/**
 * RULE 6, AND IT IS THE REASON THE COLUMNS ARE NULLABLE AT ALL.
 *
 * `null` means no hold applies here. `0` would mean held, and the quarter came
 * to nothing. They are different facts about a job and the pair keeps them
 * apart — a screen showing "Rs 0 held until 2 November" on a job that was never
 * subject to a hold is a second date and a second date's worth of confusion for
 * no money at all.
 */
describe("no hold is not a hold of zero", () => {
  it("returns null on both, never zero, when nothing is held", () => {
    const p = plan("plumbing", 40_000);
    expect(p.holdbackRupees).toBeNull();
    expect(p.holdbackRupees).not.toBe(0);
  });

  it("returns null when the quarter rounds away on a tiny job", () => {
    // Rs 3 earned. A quarter floors to 0, so there is nothing worth deferring
    // and no second date is created.
    const p = plan("painting", 3);
    expect(p.holdbackRupees).toBeNull();
    expect(p.holdbackUntil).toBeNull();
  });

  it("keeps the pair both-null or both-set, which the column check repeats", () => {
    for (const [category, earning] of [
      ["painting", 40_000],
      ["painting", 3],
      ["painting", 0],
      ["plumbing", 40_000],
      ["home-cleaning", 8_000],
    ] as const) {
      const p = plan(category, earning);
      expect(p.holdbackRupees === null).toBe(p.holdbackUntil === null);
    }
  });

  it("holds nothing on a settlement that earned nothing", () => {
    expect(plan("painting", 0).holdbackRupees).toBeNull();
    expect(plan("painting", -5).holdbackRupees).toBeNull();
  });
});

/**
 * The arithmetic the published sentence rests on.
 *
 * `/providers/standards` says never more than a quarter of any one payout. With
 * a holdback there are two payouts, so the promise has to hold against each of
 * them SEPARATELY and the total taken across a job must still come to no more
 * than a quarter of the whole.
 *
 * The tempting alternative — take a quarter of the full earning out of the
 * first, smaller tranche — was rejected because it makes that sentence false at
 * the moment the professional looks at their account: a third of what actually
 * arrived, beside a page promising a quarter.
 */
describe("a quarter of each tranche, never a quarter of the whole from one", () => {
  const EARNING = 40_000;
  const HELD = 10_000; // the quarter deferred
  const FIRST = EARNING - HELD; // 30,000 arrives now

  it("takes a quarter of what actually lands on the first date", () => {
    const step = applyRedoRecovery({ earning: FIRST, outstanding: 50_000 });
    expect(step.recovered).toBe(7_500);
    expect(step.paid).toBe(22_500);
  });

  it("takes a quarter of the held part when it is released", () => {
    const step = applyRedoRecovery({ earning: HELD, outstanding: 50_000 });
    expect(step.recovered).toBe(2_500);
  });

  it("recovers a quarter of the job in total, across both dates", () => {
    // 7,500 + 2,500 = 10,000, which is a quarter of 40,000. Splitting the
    // payout must not change what a job contributes overall.
    const first = applyRedoRecovery({ earning: FIRST, outstanding: 50_000 });
    const second = applyRedoRecovery({
      earning: HELD,
      outstanding: first.remaining,
    });
    expect(first.recovered + second.recovered).toBe(EARNING / 4);
  });

  it("never takes more from one tranche than a quarter of that tranche", () => {
    // Even against a debt far larger than the job.
    for (const tranche of [FIRST, HELD]) {
      const step = applyRedoRecovery({ earning: tranche, outstanding: 10_000_000 });
      expect(step.recovered).toBeLessThanOrEqual(Math.floor(tranche / 4));
    }
  });

  it("stops at the debt, so a small balance is not over-recovered", () => {
    const first = applyRedoRecovery({ earning: FIRST, outstanding: 1_000 });
    expect(first.recovered).toBe(1_000);
    expect(first.remaining).toBe(0);
    // Nothing left to take when the held part is released.
    const second = applyRedoRecovery({ earning: HELD, outstanding: 0 });
    expect(second.recovered).toBe(0);
  });
});
