import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The SQL and the JS must normalise a function body the same way.
 *
 * WHAT WENT WRONG. `/api/health` reported `db.functions: down` on its first
 * real run — "11 differ from this build … Something was applied or edited
 * outside supabase/migrations" — and took the whole endpoint red. Nothing had
 * been. Eleven of the fifty live functions carry CRLF line endings, `btrim(l)`
 * with no second argument trims spaces only, and every line kept a trailing
 * `\r` that the JS side's `trim()` had already stripped.
 *
 * WHY HAND-CHECKING FIVE FUNCTIONS MISSED IT, which is the lesson rather than
 * the bug. All five had been applied that same day over the MCP connection,
 * which writes LF — a sample drawn entirely from the half that could not
 * disagree. The harness has the same blind spot: it applies migrations from the
 * tree, so everything in it is LF and this cannot be reproduced here by
 * accident. So the test injects it.
 *
 * A false alarm on the URL that answers "can this serve a customer right now"
 * is worse than no check, because the next real one gets ignored.
 */

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

/** The JS half, character for character as scripts/check-migrations.mjs has it. */
function fingerprintInJs(body: string): string {
  const meaningful = body
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("--") &&
        !l.startsWith("*") &&
        !l.startsWith("/*") &&
        l !== "*/",
    );
  return createHash("sha256")
    .update(meaningful.join("\n"))
    .digest("hex")
    .slice(0, 16);
}

async function fingerprintInSql(name: string): Promise<string | null> {
  const { rows } = await pg.admin.query(
    "select sha from public.function_fingerprints() where name = $1",
    [name],
  );
  return rows.length ? (rows[0].sha as string) : null;
}

describe("the two normalisations agree", () => {
  it("agrees on a body with CRLF line endings", async () => {
    /*
     * THE ONE THAT FAILS BEFORE THE FIX. Eleven live functions look like this
     * and nothing in the tree does, which is exactly why five hand-checks and a
     * green suite all missed it.
     */
    const body =
      "\r\n  -- a comment that both sides drop\r\n  select 1;\r\n\r\n  select 2;\r\n";
    await pg.admin.query(
      `create or replace function public.crlf_fingerprint_probe()
       returns integer language sql immutable as $body$${body}$body$;`,
    );

    expect(await fingerprintInSql("crlf_fingerprint_probe")).toBe(
      fingerprintInJs(body),
    );
  });

  it("agrees on every function the migrations build", async () => {
    /*
     * The habit that produced the bug — checking a handful by hand — done
     * exhaustively and by machine instead. It cannot catch CRLF on its own,
     * which is what the case above is for; it catches everything else a change
     * to either normalisation could break.
     */
    const { rows } = await pg.admin.query(
      `select p.proname as name, p.prosrc as body
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'`,
    );

    const live = await pg.admin.query("select name, sha from public.function_fingerprints()");
    const sqlBy = new Map(
      (live.rows as Array<{ name: string; sha: string }>).map((r) => [r.name, r.sha]),
    );

    const disagreed: string[] = [];
    for (const row of rows as Array<{ name: string; body: string }>) {
      const js = fingerprintInJs(row.body);
      if (sqlBy.get(row.name) !== js) disagreed.push(row.name);
    }

    expect(disagreed, "SQL and JS hash these differently").toEqual([]);
    expect(rows.length).toBeGreaterThan(40);
  });

  it("still ignores comments and blank lines, on both sides", async () => {
    // A comment edited in the live copy is not a behaviour change, and a check
    // that fires on one gets switched off within a week.
    const bare = "\n  select 1;\n";
    const commented = "\n  -- why this is one\n\n  select 1;\n\n";
    expect(fingerprintInJs(bare)).toBe(fingerprintInJs(commented));

    for (const [name, body] of [
      ["fp_probe_bare", bare],
      ["fp_probe_commented", commented],
    ] as const) {
      await pg.admin.query(
        `create or replace function public.${name}()
         returns integer language sql immutable as $body$${body}$body$;`,
      );
    }
    expect(await fingerprintInSql("fp_probe_bare")).toBe(
      await fingerprintInSql("fp_probe_commented"),
    );
  });
});
