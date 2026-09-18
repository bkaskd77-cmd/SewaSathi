import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";
// Plain ESM with no types. A .d.ts would be a second thing to keep in step
// with a scanner this small, so the shape is asserted at each use instead.
import { columnManifest } from "../../scripts/column-manifest.mjs";

/**
 * Every column the code selects has to exist in the schema the migrations build.
 *
 * WHAT THIS WOULD HAVE CAUGHT. `crew_count` renamed a column while
 * `lib/data/capacity.ts` and `lib/data/categories.ts` still selected the old
 * name. Both reads failed, and the product did exactly what it is designed to
 * do — capacity returned nothing, the catalogue fell back to the seed — so every
 * page rendered perfectly and nothing failed. It was found by a person reading
 * HTML an hour later.
 *
 * `check:migrations` refuses to let a destructive migration go out without
 * saying so. This is the earlier half: it fails while the migration is still
 * being WRITTEN, against the schema the harness builds from the migrations
 * themselves, before anything reaches a database anybody uses.
 *
 * It reads the selects out of the source rather than a list somebody maintains,
 * for the same reason the RLS coverage tests read `pg_catalog`: a list is a
 * thing that stops matching on the day somebody adds a query.
 */

let pg: Harness;

/**
 * Tables the scan finds that the schema does not have.
 *
 * Empty, and it should stay that way. An entry here means either a table that
 * lives outside `public` or a typo in a `.from()` call that has been failing
 * silently — both worth a sentence rather than a skip.
 */
const NOT_IN_PUBLIC: Record<string, string> = {};

/**
 * Selects the scanner genuinely cannot read, each with a reason.
 *
 * ONE ENTRY, AND IT SHOULD STAY THAT WAY. `getProvider` reuses the list
 * `listProviders` uses and drops the `!inner` so a provider with no category
 * row still loads — a computed string, which no static scan can follow. Its
 * columns are covered anyway, because the constant it derives from is read on
 * the call site next to it.
 *
 * The list is here rather than in the scanner so the exception is asserted
 * rather than silently swallowed, the same shape `UNGUARDED` uses in
 * tests/db/guard-clauses.test.ts.
 */
const UNREADABLE = [
  {
    starts: "SELECT.replace(",
    why: "lib/data/providers.ts derives one select from another at runtime; the base constant is scanned at the neighbouring call site.",
  },
];

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the code and the schema agree about columns", () => {
  it("finds every column the code selects", async () => {
    const { columns } = columnManifest() as {
      columns: Map<string, Set<string>>;
    };

    const { rows } = await pg.admin.query(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'`,
    );

    const schema = new Map<string, Set<string>>();
    for (const row of rows as Array<{ table_name: string; column_name: string }>) {
      if (!schema.has(row.table_name)) schema.set(row.table_name, new Set());
      schema.get(row.table_name)!.add(row.column_name);
    }

    const missing: string[] = [];
    // Array.from rather than for...of over a Map: the tsconfig target predates
    // downlevel iteration, the same limit that keeps the `u` flag off the regex
    // in lib/text/nepali.ts.
    for (const [table, wanted] of Array.from(columns)) {
      const have = schema.get(table);
      if (!have) {
        if (NOT_IN_PUBLIC[table]) continue;
        missing.push(`${table} (whole table)`);
        continue;
      }
      for (const column of Array.from(wanted) as string[]) {
        if (!have.has(column)) missing.push(`${table}.${column}`);
      }
    }

    expect(
      missing,
      `the code selects columns the migrations do not create:\n  ${missing.join("\n  ")}\n` +
        `Either the migration dropped or renamed something still in use, or the ` +
        `select has a typo that has been failing quietly.`,
    ).toEqual([]);
  });

  it("can read every select in the codebase", async () => {
    /*
     * A SCAN THAT SILENTLY SKIPS WHAT IT CANNOT PARSE is a coverage figure of
     * zero wearing a green tick, which is the same failure shape as the seed
     * fallback this whole thing exists to expose. So the unreadable ones are
     * the assertion: add the pattern to the scanner, or name the file here with
     * a reason.
     */
    const { unresolved } = columnManifest() as {
      unresolved: Array<{ file: string; table: string; expression: string }>;
    };
    const undeclared = unresolved.filter(
      (u) => !UNREADABLE.some((d) => u.expression.startsWith(d.starts)),
    );
    expect(
      undeclared.map((u) => `${u.file}: ${u.table} <- ${u.expression}`),
    ).toEqual([]);
  });

  it("covers the tables a booking actually touches", async () => {
    // A guard whose coverage silently collapsed to two tables would still pass
    // the assertions above. These are the ones on the money and booking paths.
    const { columns } = columnManifest() as { columns: Map<string, Set<string>> };
    for (const table of ["bookings", "providers", "payments", "categories"]) {
      expect(columns.has(table), `${table} is not covered`).toBe(true);
    }
    expect(columns.get("bookings")!.size).toBeGreaterThan(30);
  });
});
