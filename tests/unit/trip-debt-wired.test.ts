import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The recovery is reached from the one place that records a final amount.
 *
 * WHY THIS TEST EXISTS AND WHY IT READS SOURCE. The arithmetic is `tripDebtOnBill`,
 * pure and covered in `trip-protection.test.ts`. The database behaviour — a quarter
 * taken once, a cash collector billed, a dispute holding everything off — is covered
 * in `tests/db/customer-risk.test.ts`, where a local helper performs the same writes
 * because the db suite speaks raw SQL and `recordFinalAmount` needs a Supabase client.
 *
 * THAT LEAVES EXACTLY ONE GAP, and it is the one this repository keeps falling into:
 * both halves can be perfect while the real function does not call either. It is
 * `bookings.triage_log_id` — a column, a zod field, an insert and a page, every link
 * built and the chain never joined — and `applyRedoRecovery`, tested and documented
 * with no caller for four phases. A per-link test passed throughout in both cases.
 *
 * So these cases assert the ENDS on the source of `lib/data/payments.ts`: that the
 * rule is consulted, that the column is written in the SAME update as `final_amount`,
 * and that the cash side is settled afterwards. Comments are stripped first, because
 * naming a function in order to explain it is documentation and not a call — the
 * `check:secrets` source pass makes the same distinction.
 */
const SOURCE = readFileSync("lib/data/payments.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("the trip-debt recovery is wired to the settlement", () => {
  it("consults the rule rather than restating it", () => {
    expect(SOURCE).toMatch(/tripDebtOnBill\(/);
    expect(SOURCE).toMatch(/from "@\/lib\/abuse"/);
  });

  /*
   * ONE UPDATE, AND THIS IS THE CASE WITH TEETH. Two statements — the amount, then the
   * column — leave a window where a crash records a bill carrying a recovery that the
   * next settlement would take again. The guarantee is that the figure and the record
   * of what was added to it land together or not at all.
   */
  it("writes the recovery in the same update as the final amount", () => {
    /* Anchored on the assignment, not the name: `final_amount` also appears in the
       row type above and in the select list, and matching one of those would prove
       nothing about the write. */
    const at = SOURCE.indexOf("final_amount: input.amount");
    expect(at).toBeGreaterThan(-1);
    const update = SOURCE.slice(at, at + 600);
    expect(update).toMatch(/trip_debt_added_rupees/);
  });

  it("settles the balance and the cash collector only after that write", () => {
    const column = SOURCE.indexOf("trip_debt_added_rupees: recovery.rupees");
    const settle = SOURCE.indexOf("await settleTripDebt(");
    expect(column).toBeGreaterThan(-1);
    expect(settle).toBeGreaterThan(column);
  });

  /*
   * AND IT MUST NOT BE ABLE TO FAIL THE SETTLEMENT. The professional is standing in
   * somebody's kitchen; an anti-fraud read that cannot be made is not a reason to
   * refuse their figure. The column stays null and the next booking recovers instead.
   */
  it("cannot fail the settlement it is recovering from", () => {
    const read = SOURCE.slice(SOURCE.indexOf("async function tripDebtToAdd"));
    expect(read.slice(0, read.indexOf("async function settleTripDebt"))).toMatch(
      /catch \(thrown\)/,
    );
  });
});
