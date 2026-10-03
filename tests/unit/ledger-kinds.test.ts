import { describe, expect, it } from "vitest";

import {
  CROSS_KINDS,
  GUARANTEE_KINDS,
  LEDGER_KINDS,
  MONEY_KINDS,
  isLedgerKind,
} from "@/lib/config/ledger";

/**
 * The kinds and the check constraint are one list written twice.
 *
 * They do not fail in a suite when they drift — they fail on the first
 * production write that produces the new value, losing the row to a rejected
 * insert. On this table that row is somebody's money. So this reads the
 * migration, the same arrangement as `LOGGABLE_REASONS` and `CRON_JOBS`.
 */
describe("the ledger kinds match the column's check constraint", () => {
  /*
   * THE LAST DEFINITION WINS, AND NAMING ONE FILE WAS THE TRAP. This read used to
   * open `20260929000001_ledger_kinds.sql` by name. The day `trip_compensation` was
   * added the constraint's authoritative definition moved to a later migration, and
   * this case failed while the schema was perfectly consistent — pointing at the
   * wrong file and reporting the list as drifted.
   *
   * It is the same trap CLAUDE.md records for policies ("breaking one to test it
   * means editing its LAST definition"), one object type over, and here it bit the
   * test rather than a break-test. So the kinds are read from the last migration
   * that defines the constraint, in filename order — which is the order Postgres
   * applied them in, so the last definition is what the database has.
   */
  it("permits exactly the same kinds in TypeScript and in SQL", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const dir = new URL("../../supabase/migrations/", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

    let inSql: string[] | null = null;
    let from = "";
    for (const file of files) {
      const sql = await readFile(new URL(file, dir), "utf8");
      if (!sql.includes("provider_ledger_kind_check")) continue;
      // `[\s\S]` rather than the `s` flag: this project targets an older ES
      // level and tsc refuses `/s` outright.
      const list = sql.match(/check \(kind in \(([\s\S]*?)\)\)/)?.[1];
      if (list === undefined) continue;
      inSql = (list.match(/'[a-z_]+'/g) ?? [])
        .map((quoted) => quoted.slice(1, -1))
        .sort();
      from = file;
    }

    // A list nobody defines is not a passing state: it would mean the constraint
    // has been deleted, and this case would otherwise go green on null.
    expect(inSql, "no migration defines provider_ledger_kind_check").not.toBeNull();
    expect(inSql, `the list in ${from}`).toEqual([...LEDGER_KINDS].sort());
  });

  it("matches the hand-written database types as well", async () => {
    /*
     * ONE LIST WRITTEN THREE TIMES, not two. `types/supabase.ts` is
     * hand-maintained to mirror the database, and it carried the original three
     * kinds for a day after the constraint grew to eight — the migration and
     * the constant agreed with each other while the type disagreed with both,
     * which is the exact shape `CRON_JOBS` has a three-way test for.
     *
     * A stale union here does not fail a build: it makes TypeScript reject a
     * legitimate write at the call site, in the payout run that does not exist
     * yet, months from now, looking like a bug in the run.
     */
    const { readFile } = await import("node:fs/promises");
    const types = await readFile(
      new URL("../../types/supabase.ts", import.meta.url),
      "utf8",
    );

    const block = types.match(
      /provider_ledger: \{[\s\S]*?kind:([\s\S]*?);/,
    )?.[1];
    const inTypes = ((block ?? "").match(/"[a-z_]+"/g) ?? [])
      .map((quoted) => quoted.slice(1, -1))
      .sort();

    expect(inTypes).toEqual([...LEDGER_KINDS].sort());
  });

  it("splits every kind into exactly one of the two accounts", () => {
    /*
     * A KIND COUNTED BY NEITHER FUNCTION IS THE FAILURE THIS CATCHES, and it
     * is silent: the row inserts, the constraint passes, and both balances
     * ignore it. Money that exists and appears nowhere.
     *
     * Asserted as a partition rather than as two memberships, because the
     * interesting case is the kind somebody adds to `LEDGER_KINDS` and forgets
     * to file — which two independent `toContain` checks would never notice.
     */
    const guarantee = new Set<string>(GUARANTEE_KINDS);
    const money = new Set<string>(MONEY_KINDS);

    /*
     * THE OVERLAP IS NAMED, NOT EMPTY — and asserting it IS `CROSS_KINDS` is
     * stronger than asserting it is empty was. `recovery` belongs to both
     * accounts because it is two facts at once: the debt shrinks, and so does
     * what we owe them, since we settled it against their own account instead of
     * sending it to their bank. Counting it on one side only left every
     * recovered rupee on the books for ever as money still owed.
     *
     * A second kind added to both lists by accident fails here rather than
     * quietly joining the exception.
     */
    const overlap = LEDGER_KINDS.filter((k) => guarantee.has(k) && money.has(k));
    expect(overlap, "the kinds on both accounts are not the declared ones").toEqual([
      ...CROSS_KINDS,
    ]);

    const unfiled = LEDGER_KINDS.filter(
      (k) => !guarantee.has(k) && !money.has(k),
    );
    expect(unfiled, "a kind counted by neither account").toEqual([]);

    expect(guarantee.size + money.size - CROSS_KINDS.length).toBe(
      LEDGER_KINDS.length,
    );
  });

  it("refuses a kind that is not in the list", () => {
    // `commission_returned` by name: it is the kind `lib/data/claims.ts`
    // considered and rejected when the catch-all `else` made it unsafe. It is
    // still not a kind, and the reason is now different — a returned
    // commission is the platform's side of a refund, not a movement on the
    // professional's account.
    expect(isLedgerKind("commission_returned")).toBe(false);
    expect(isLedgerKind("")).toBe(false);
    expect(isLedgerKind(undefined)).toBe(false);
  });
});
