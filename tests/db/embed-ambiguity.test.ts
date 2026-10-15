import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * A PostgREST embed is refused when two tables are joined by more than one
 * foreign key, and the refusal arrives as a FAILED READ.
 *
 * WHAT THIS COST. `provider_reviews` reaches `profiles` by three foreign keys —
 * `customer_id`, `excluded_by`, `homepage_hidden_by` — so `profiles(full_name)`
 * is ambiguous and PostgREST answers "more than one relationship was found"
 * rather than rows. Three reads were written that way in one day: the
 * professional's own reviews list, the homepage review wall, and
 * `/admin/reviews`. On the live profile page the result was a listing with a
 * 4.5 (1) rating and the words "No written reviews yet" underneath it.
 *
 * NOTHING COULD HAVE CAUGHT IT. The db suite speaks to Postgres directly, where
 * the ambiguity does not exist — it is PostgREST's rule, not SQL's.
 * `column-manifest.mjs` skips embeds by design. Every unit fixture builds its
 * own rows. The only surface that fails is a live HTTP read.
 *
 * SO THE PAIRS ARE DERIVED FROM THE SCHEMA, never listed. Any (child, parent)
 * joined more than once is ambiguous by construction, and every embed of that
 * parent in our selects must name its constraint — `profiles!…_fkey(…)`, the
 * form `recentActivity` already used a hundred lines above the one that broke.
 *
 * TO SEE IT BITE: drop the `!provider_reviews_customer_id_fkey` from any of the
 * three selects.
 */

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

/** Files that run a PostgREST query. */
function sourceFiles(): string[] {
  return execSync(`grep -rl '\\.from("' lib app components --include=*.ts --include=*.tsx`, {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
}

/** The text between `.select(` and its matching `)`, quoting-aware. */
function selectArguments(src: string): { table: string; list: string }[] {
  const out: { table: string; list: string }[] = [];
  const re = /\.from\(\s*"([a-z_]+)"\s*\)((?:(?!\.from\()[\s\S]){0,400}?)\.select\(/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src))) {
    const rest = src.slice(m.index + m[0].length);
    // No `s` flag: the tsconfig target predates it, and the class already
    // excludes a newline because a select literal is one line.
    const literal = rest.match(/^\s*"((?:[^"\\]|\\.)*)"/);
    if (literal) out.push({ table: m[1], list: literal[1] });
  }
  return out;
}

/** `alias:table!constraint(cols)` → the embedded table, and whether it is named. */
function embeds(list: string): { table: string; qualified: boolean }[] {
  const found: { table: string; qualified: boolean }[] = [];
  // Top level only: a nested embed's own parens are inside the match.
  let depth = 0;
  let current = "";
  const pieces: string[] = [];

  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      pieces.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  pieces.push(current);

  for (const piece of pieces) {
    const m = piece.trim().match(/^(?:[a-z_]+:)?([a-z_]+)(!([a-z_]+))?\s*\(/);
    if (m) found.push({ table: m[1], qualified: Boolean(m[3]) });
  }
  return found;
}

describe("every ambiguous embed names its foreign key", () => {
  it("refuses an unqualified embed of a table joined more than once", async () => {
    /*
     * The pairs, out of the catalog. A parent reachable from one child by two
     * or more constraints cannot be embedded by name alone.
     */
    const { rows } = await pg.admin.query(`
      select c.conrelid::regclass::text as child,
             c.confrelid::regclass::text as parent,
             count(*) as links
        from pg_constraint c
        join pg_class r on r.oid = c.conrelid
        join pg_namespace n on n.oid = r.relnamespace
       where c.contype = 'f' and n.nspname = 'public'
       group by 1, 2
      having count(*) > 1
    `);

    const ambiguous = new Map<string, Set<string>>();
    for (const row of rows) {
      const child = String(row.child).replace(/^public\./, "");
      const parent = String(row.parent).replace(/^public\./, "");
      if (!ambiguous.has(child)) ambiguous.set(child, new Set());
      ambiguous.get(child)!.add(parent);
    }

    // The schema really does carry some, or this test proves nothing.
    expect(ambiguous.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      for (const { table, list } of selectArguments(src)) {
        const parents = ambiguous.get(table);
        if (!parents) continue;
        for (const embed of embeds(list)) {
          if (parents.has(embed.table) && !embed.qualified) {
            offenders.push(`${file}: .from("${table}") embeds ${embed.table}(…) unqualified`);
          }
        }
      }
    }

    expect(
      offenders,
      "PostgREST refuses an ambiguous embed and the read fails. Name the " +
        "constraint: profiles!provider_reviews_customer_id_fkey(…).",
    ).toEqual([]);
  });

  it("has a parser that still sees a bare embed and a named one", () => {
    // The scanner self-tests: one that stopped matching reads exactly like a
    // tree with nothing wrong in it.
    expect(embeds("id, profiles(full_name)")).toEqual([
      { table: "profiles", qualified: false },
    ]);
    expect(embeds("id, profiles!provider_reviews_customer_id_fkey(full_name)")).toEqual([
      { table: "profiles", qualified: true },
    ]);
    // A nested embed must not be read as a second top-level one.
    expect(embeds("id, bookings(category_slug, addresses(city))")).toEqual([
      { table: "bookings", qualified: false },
    ]);
  });
});
