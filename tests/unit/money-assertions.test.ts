import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MONEY_ASSERTIONS,
  assertionFor,
  assertsMoneyMoved,
} from "@/lib/config/money-assertions";

/**
 * A past-tense money column must have something that actually pays it.
 *
 * THE CLASS THIS CATCHES, which has now happened three times: `owedRupees`,
 * `applyRedoRecovery`, and `no_show_claims.trip_rupees_paid` — the last written as
 * 350 for five phases under a column comment reading "What we paid the professional",
 * with no ledger row anywhere. Each time a column recorded a decision and everybody
 * read it as money.
 *
 * SO THE GUARD IS ON THE SCHEMA, not on any one function. A new `*_paid` column
 * cannot be added without somebody declaring what backs it, which forces the question
 * "and what pays this?" at the moment the column is invented rather than five phases
 * later. `tests/db/money-assertions.test.ts` is the other half: it checks the backing
 * rows are really there.
 */

const DIR = new URL("../../supabase/migrations/", import.meta.url);

/** Every `table.column` the migrations define, by reading the create-table blocks. */
function columnsInSchema(): string[] {
  const out: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(file, DIR), "utf8");

    // Columns declared at create time.
    for (const table of Array.from(
      sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi),
    )) {
      const [, name, body] = table;
      for (const line of body.split("\n")) {
        const column = line.match(/^\s{2}(\w+)\s+(?:integer|numeric|bigint|boolean|timestamptz|text|uuid|date)/i);
        if (column) out.push(`${name}.${column[1]}`);
      }
    }

    /*
     * And columns bolted on later, which is how half this schema grew.
     *
     * STATEMENT BY STATEMENT, because a regex spanning the whole file matched an
     * `alter table` from one statement against an `add column` from a later one and
     * attributed the column to the wrong table — found by the break-test, which
     * reported `provider_ledger.bonus_paid` for a column added to `bookings`. The
     * detection was right and the name was wrong, which is worse than a miss: it
     * sends whoever has to fix it to a table that does not have the problem.
     */
    for (const statement of sql.split(";")) {
      const table = statement.match(/alter table public\.(\w+)/i);
      if (!table) continue;
      for (const added of Array.from(
        statement.matchAll(/add column (?:if not exists )?(\w+)/gi),
      )) {
        out.push(`${table[1]}.${added[1]}`);
      }
    }
  }
  return Array.from(new Set(out));
}

describe("a column that says money moved", () => {
  /*
   * THE CASE THAT DOES THE WORK. Everything else here is about the list being
   * sensible; this is the one that goes red when somebody adds `payout_sent` or
   * `bonus_paid` and nothing pays it.
   */
  it("is declared with the row that backs it", () => {
    const undeclared = columnsInSchema()
      .filter((qualified) =>
        assertsMoneyMoved(qualified.split(".")[1] ?? "", qualified),
      )
      .filter((qualified) => assertionFor(qualified) === null);

    expect(
      undeclared,
      `these columns claim money moved and nothing says what pays them — ` +
        `declare each in lib/config/money-assertions.ts, or rename it if it is ` +
        `recording a decision rather than a payment`,
    ).toEqual([]);
  });

  /*
   * The scanner has to actually see the schema. If the regexes ever stop matching —
   * a formatting change, a new column syntax — the case above would pass on an empty
   * list, which is the "a checker that has quietly stopped checking" failure this
   * project writes self-tests for everywhere else.
   */
  it("can see the schema at all", () => {
    const columns = columnsInSchema();
    expect(columns.length).toBeGreaterThan(100);
    expect(columns).toContain("no_show_claims.trip_rupees_paid");
    expect(columns).toContain("bookings.final_amount");
  });

  /*
   * Attribution, pinned. `bookings.band_revision_id` and `bookings.payout_due_at`
   * were both added by a later `alter table`, so if the scanner ever goes back to
   * matching across statements it will name somebody else's table for them.
   */
  it("attributes a bolted-on column to the right table", () => {
    const columns = columnsInSchema();
    expect(columns).toContain("bookings.band_revision_id");
    expect(columns).toContain("bookings.payout_due_at");
    expect(columns).not.toContain("provider_ledger.band_revision_id");
  });

  it("recognises the shape it is looking for, and only that shape", () => {
    expect(assertsMoneyMoved("trip_rupees_paid")).toBe(true);
    expect(assertsMoneyMoved("commission_refunded")).toBe(true);
    expect(assertsMoneyMoved("payout_sent")).toBe(true);
    // A price is not a payment. Sweeping these in makes the list unreadable,
    // which is how trip_rupees_paid survived in plain sight.
    expect(assertsMoneyMoved("final_amount")).toBe(false);
    expect(assertsMoneyMoved("quoted_min")).toBe(false);
    // The bare name still does not match the pattern...
    expect(assertsMoneyMoved("refund_rupees")).toBe(false);
    // ...and the qualified one is caught by name, which is the narrow fix.
    expect(
      assertsMoneyMoved("refund_rupees", "guarantee_claims.refund_rupees"),
    ).toBe(true);
    // A different table's identically-named column is NOT caught, deliberately:
    // the list names columns, not words, so it cannot quietly widen.
    expect(assertsMoneyMoved("refund_rupees", "payments.refund_rupees")).toBe(
      false,
    );
  });

  it("gives every declaration a backing row and a reason", () => {
    expect(MONEY_ASSERTIONS.length).toBeGreaterThan(0);
    for (const assertion of MONEY_ASSERTIONS) {
      expect(assertion.column).toMatch(/^\w+\.\w+$/);
      expect(assertion.backedBy.length).toBeGreaterThan(3);
      // A reason somebody can weigh, not a word. "mayLag" especially: that is the
      // claim a never-arriving payment would hide behind.
      expect(assertion.why.length).toBeGreaterThan(40);
    }
  });
});
