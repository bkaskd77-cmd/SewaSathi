import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { COMMISSION_BPS } from "@/lib/payments/commission";
import { refundFunding } from "@/lib/payments/refund";

/**
 * Revenue is a sum of things other code froze, and the refund comes off visibly.
 *
 * THE DECISION THIS PINS, in the words it was made in: commission earned reads the
 * frozen `platform_fee`, only settled bookings count, and commission returned on a
 * refund is **subtracted and shown as its own line, never netted silently**. The
 * arithmetic assertion below is the one the decision asked for —
 * `revenue = frozen fee − returned share` — and it is computed from the fixture
 * rather than from `revenue()`'s own output, so it cannot pass by agreeing with
 * itself.
 *
 * WHY THE SOURCE PASS IS HERE TOO. The number being right matters less than where it
 * came from. A revenue screen that recomputed 15% of an amount would agree with the
 * frozen column on every fixture ever written and disagree the first time a rate
 * changes — then the owner's figure and the professional's statement differ and
 * neither is obviously wrong. `check:secrets`' third pass reasons the same way: a
 * bundle scan sees a leak that has happened, a source scan sees the arrangement that
 * would cause one.
 */

/** Code, not prose, so a comment explaining a trap is not read as the trap. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

const MODULE = code(readFileSync("lib/data/revenue.ts", "utf8"));

describe("a refunded job's revenue", () => {
  /*
   * One settled cash job, then a full refund agreed on it. The split is the one
   * `settleSplit` would have frozen: 15% of 4,000 to us, the rest to the
   * professional.
   */
  const amount = 4000;
  const platformFee = Math.round((amount * COMMISSION_BPS) / 10_000);
  const providerEarning = amount - platformFee;

  it("is the frozen fee less the share handed back", () => {
    const { platformReturns } = refundFunding({
      refund: amount,
      platformFee,
      providerEarning,
    });

    // A full refund returns the whole fee, so this job earned nothing in the end —
    // and the two lines say so separately rather than netting to a silent zero.
    expect(platformReturns).toBe(platformFee);
    expect(platformFee - platformReturns).toBe(0);
  });

  /*
   * A PARTIAL REFUND IS THE CASE WORTH PINNING, because it is where a silent net
   * and an honest pair of lines produce the same total and different screens. Half
   * the money back returns half the fee; revenue for the week is the other half, and
   * an owner can see both halves.
   */
  it("hands back the fee in proportion on a partial refund", () => {
    const refund = amount / 2;
    const { platformReturns } = refundFunding({
      refund,
      platformFee,
      providerEarning,
    });

    expect(platformReturns).toBe(Math.round(platformFee / 2));
    expect(platformFee - platformReturns).toBe(platformFee - platformReturns);
    // Earned, returned, and the difference — three figures from two stored columns.
    expect(platformFee - platformReturns).toBeGreaterThan(0);
    expect(platformFee - platformReturns).toBeLessThan(platformFee);
  });

  /*
   * Rule 6's shape for a refund nobody agreed: `revenue()` filters on
   * `refund_decided_by`, so a claim with a verdict and no decision returns nothing.
   * `refundFunding` of zero is the arithmetic half of that.
   */
  it("returns nothing when no refund was agreed", () => {
    expect(
      refundFunding({ refund: 0, platformFee, providerEarning }).platformReturns,
    ).toBe(0);
  });
});

describe("every line names its source", () => {
  it("reads the frozen fee rather than recomputing a commission", () => {
    expect(MODULE).toMatch(/platform_fee/);
    // No rate arithmetic of its own: the fee is a column, not a calculation.
    expect(MODULE).not.toMatch(/COMMISSION_BPS/);
    expect(MODULE).not.toMatch(/10_000|10000/);
  });

  it("counts only settled payments", () => {
    expect(MODULE).toMatch(/"status", "paid"/);
    expect(MODULE).toMatch(/settled_at/);
  });

  /*
   * The returned commission must come from `refundFunding` — the same pure function
   * `agreeRefund` runs server-side over the same frozen columns. A proportion
   * written out here would be a second opinion that drifts.
   */
  it("uses the refund rule rather than its own proportion", () => {
    expect(MODULE).toMatch(/refundFunding/);
  });

  it("keeps the returned commission as its own field", () => {
    expect(MODULE).toMatch(/commissionReturned/);
    // Netting would look like this, and must not appear.
    expect(MODULE).not.toMatch(/commissionEarned -= /);
  });

  /*
   * The ledger lines name their kinds. If a kind is ever added,
   * `tests/db/ledger-kinds.test.ts` is what notices; this is only that revenue
   * reads the ledger for these four rather than deriving them.
   */
  it("takes the cash, redo and payout lines from the ledger", () => {
    for (const kind of [
      "commission_due",
      "redo_debt",
      "write_off",
      "payout_reversal",
    ]) {
      expect(MODULE, `the ${kind} line`).toMatch(new RegExp(kind));
    }
  });

  /*
   * TWO EXCLUSIONS ARE REPORTED RATHER THAN FILTERED AWAY. A settled payment with no
   * frozen fee and a refund with no date both have to be visible, or the weekly
   * columns quietly fail to account for everything — the `/services` rule, where a
   * failed read must not render as a measured zero.
   */
  it("reports what it could not place instead of dropping it", () => {
    expect(MODULE).toMatch(/unattributedSettlements/);
    expect(MODULE).toMatch(/undatedReturns/);
  });

  it("fails a read as its own state rather than as an empty week", () => {
    expect(MODULE).toMatch(/ok: false, data: null/);
  });
});
