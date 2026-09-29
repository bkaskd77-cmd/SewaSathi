import { describe, expect, it } from "vitest";

import {
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
  it("permits exactly the same kinds in TypeScript and in SQL", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      new URL(
        "../../supabase/migrations/20260929000001_ledger_kinds.sql",
        import.meta.url,
      ),
      "utf8",
    );

    // `[\s\S]` rather than the `s` flag: this project targets an older ES
    // level and tsc refuses `/s` outright.
    const list = sql.match(/check \(kind in \(([\s\S]*?)\)\)/)?.[1] ?? "";
    const inSql = (list.match(/'[a-z_]+'/g) ?? [])
      .map((quoted) => quoted.slice(1, -1))
      .sort();

    expect(inSql).toEqual([...LEDGER_KINDS].sort());
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

    const overlap = GUARANTEE_KINDS.filter((k) => money.has(k));
    expect(overlap, "a kind counted by both accounts").toEqual([]);

    const unfiled = LEDGER_KINDS.filter(
      (k) => !guarantee.has(k) && !money.has(k),
    );
    expect(unfiled, "a kind counted by neither account").toEqual([]);

    expect(guarantee.size + money.size).toBe(LEDGER_KINDS.length);
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
