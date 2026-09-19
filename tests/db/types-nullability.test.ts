import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * `types/supabase.ts` is hand-written, and it drifts.
 *
 * WHAT THIS WOULD HAVE CAUGHT, and did not, because it did not exist:
 * `bookings.band_min` was declared `number` while the survey-quotes migration
 * had dropped its not-null months earlier. Every reader therefore believed a
 * figure was always there — and `Number(null)` is 0, which is the exact bug
 * class that migration existed to prevent. It was found by tripping over it
 * while writing something else, which is not a way of finding things.
 *
 * THE DANGEROUS DIRECTION IS ONE-WAY. A type that says `string | null` when
 * the column is NOT NULL costs a needless null check. A type that says
 * `string` when the column is nullable is a lie the compiler enforces: it
 * silences the very check that would have caught the null. So this asserts
 * both directions but says which is which, because they are not the same bug.
 *
 * AGAINST THE HARNESS, WHICH IS THE TREE. The harness applies every migration
 * in `supabase/migrations`, so this compares the types against the schema the
 * repository describes. It cannot see production — that axis belongs to
 * `/api/health`, and a live-only drift is exactly how all ten categories came
 * to be missing their Nepali copy while the tree said the columns were
 * not-null.
 */

let pg: Harness;

/**
 * Columns whose `information_schema` nullability is not the whole story.
 *
 * A GENERATED column is reported nullable because its expression could in
 * principle yield null. `providers.is_available` is
 * `generated always as (availability = 'now') stored` over a NOT NULL column,
 * so in practice it never is — and nothing in TypeScript reads it anyway.
 * Listed rather than silently skipped, so the next generated column is a
 * decision instead of a surprise.
 */
const EXPLAINED: Record<string, string> = {
  "providers.is_available":
    "Generated column over a NOT NULL source; reported nullable by information_schema but never null in practice.",
};

type Declared = { table: string; column: string; type: string; nullable: boolean };

/**
 * Pull the `Row` shape of every table out of the hand-written types.
 *
 * Deliberately a small regex scan rather than the TypeScript compiler API: the
 * file is generated-shaped and stable, and a parser big enough to need its own
 * tests would be a second thing to keep in step.
 */
function declaredColumns(): Declared[] {
  const src = readFileSync("types/supabase.ts", "utf8");
  const out: Declared[] = [];

  // `exec` in a loop rather than `matchAll`: the tsconfig target predates
  // downlevel iteration of a RegExp iterator, same reason `makeReference` in
  // lib/data/bookings.ts indexes its byte array instead of iterating it.
  const tableRe = /\n {6}(\w+): \{\n/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(src)) !== null) {
    const table = m[1];
    const rowAt = src.indexOf("Row: {", m.index);
    if (rowAt === -1) continue;

    let depth = 0;
    let i = src.indexOf("{", rowAt);
    const open = i;
    for (; i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    for (const line of src.slice(open + 1, i).split("\n")) {
      const c = /^\s*(\w+)\??:\s*(.+?);\s*$/.exec(line);
      if (!c) continue;
      out.push({
        table,
        column: c[1],
        type: c[2],
        nullable: /\bnull\b/.test(c[2]),
      });
    }
  }
  return out;
}

beforeAll(async () => {
  pg = await startPostgres();
}, 120_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the hand-written types match the schema the migrations build", () => {
  it("declares nothing non-null that the schema allows to be null", async () => {
    const { rows } = await pg.admin.query(
      `select table_name, column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public'`,
    );

    const live = new Map<string, boolean>();
    for (const r of rows as { table_name: string; column_name: string; is_nullable: string }[]) {
      live.set(`${r.table_name}.${r.column_name}`, r.is_nullable === "YES");
    }

    const lies: string[] = [];
    for (const d of declaredColumns()) {
      const key = `${d.table}.${d.column}`;
      if (key in EXPLAINED) continue;
      const liveNullable = live.get(key);
      if (liveNullable === undefined) continue; // column-manifest owns that
      if (liveNullable && !d.nullable) {
        lies.push(`${key} is nullable in the schema but typed \`${d.type}\``);
      }
    }

    expect(lies).toEqual([]);
  });

  it("declares nothing nullable that the schema guarantees", async () => {
    /*
     * The cheap direction: a needless null check rather than a missing one.
     * Still worth failing on, because a type that is wrong in the safe
     * direction today is a type nobody trusts tomorrow.
     */
    const { rows } = await pg.admin.query(
      `select table_name, column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public'`,
    );

    const live = new Map<string, boolean>();
    for (const r of rows as { table_name: string; column_name: string; is_nullable: string }[]) {
      live.set(`${r.table_name}.${r.column_name}`, r.is_nullable === "YES");
    }

    const overCautious: string[] = [];
    for (const d of declaredColumns()) {
      const key = `${d.table}.${d.column}`;
      if (key in EXPLAINED) continue;
      const liveNullable = live.get(key);
      if (liveNullable === undefined) continue;
      if (!liveNullable && d.nullable) {
        overCautious.push(`${key} is NOT NULL but typed \`${d.type}\``);
      }
    }

    expect(overCautious).toEqual([]);
  });

  it("reads a useful number of columns, so a broken scan cannot pass", async () => {
    // A regex that stopped matching would make both cases above trivially
    // green. The count is the canary.
    expect(declaredColumns().length).toBeGreaterThan(300);
  });
});
