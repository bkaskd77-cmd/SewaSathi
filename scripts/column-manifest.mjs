#!/usr/bin/env node
/**
 * Which columns the code actually selects, read from the code.
 *
 * WHAT THIS IS FOR. `crew_count` renamed a column while the deployed build
 * still selected the old name. Two reads failed and the product did what it is
 * designed to do — `providerCapacity` returned nothing, the catalogue fell back
 * to the seed — so every page looked perfect and nothing failed. A person found
 * it by reading HTML.
 *
 * `check:migrations` stops a destructive migration being applied before its
 * deploy. This is the other half: it stops one being WRITTEN while the code
 * still needs the column, by failing `npm run verify` locally, against the
 * schema the harness builds from the migrations themselves.
 *
 * READ FROM THE CODE, NOT MAINTAINED. A hand-written list of columns is a list
 * that stops matching the day somebody adds a select — the same reason
 * `tests/db/booking-rls.test.ts` reads the catalog rather than a list. So this
 * scans `.from("table").select("…")` and resolves the module-level constants a
 * few big reads use.
 *
 * WHAT IT CANNOT READ, IT REPORTS. A scan that silently skips what it cannot
 * parse is a coverage number of zero wearing a green tick. Anything unreadable
 * comes back in `unresolved` and the test declares each one with a reason, the
 * same shape `UNGUARDED` uses in the guard manifest.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * Split a select list at the TOP LEVEL only.
 *
 * PostgREST embeds a relation as `alias:table(a, b, c)`, and a naive split on
 * commas hands `b` and `c` to the parent table. That is not a theoretical
 * worry: it attributed eleven `provider_stats` columns to `providers` on the
 * first run, every one of which would have read as a schema mismatch.
 */
function topLevelPieces(list) {
  const out = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    /*
     * QUOTE-AWARE, and it was not at first. Used on the argument list, a
     * splitter that ignores quoting cuts `"id, full_name"` into `"id` and
     * `full_name"` — which turned 234 readable columns into 95 and 5
     * unreadable selects into 79, all of them reported as parse failures on
     * code that was perfectly ordinary.
     */
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += list[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/** An embed or a rename: `alias:column`, `table(cols)`. Not a plain column. */
const EMBED = /[:(]/;

function sourceFiles() {
  return execSync(
    `grep -rl '\\.from("' lib app components --include=*.ts --include=*.tsx`,
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
}

/** `const NAME = "a, b, c";` at module scope, so a big select can be named. */
function constants(src) {
  const out = new Map();
  const re = /^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*\n?\s*"((?:[^"\\]|\\.)*)"\s*;/gm;
  let m;
  while ((m = re.exec(src))) out.set(m[1], m[2]);
  return out;
}

/**
 * The text between `.select(` and its matching `)`.
 *
 * A REAL SCAN RATHER THAN A REGEX, because both regexes before it were wrong in
 * opposite directions: a strict one silently lost a `.select(buildColumns())`
 * from the scan entirely, and a loose one swallowed the closing quote and the
 * next two lines. Parentheses nest inside a PostgREST embed and the argument
 * can be a literal containing either character, so the only thing that reads it
 * correctly is a walk that tracks depth and quoting.
 */
function selectArgument(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) return src.slice(from, i);
      depth -= 1;
    }
  }
  return null;
}

export function columnManifest() {
  /** table -> Set(column) */
  const columns = new Map();
  const unresolved = [];

  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    const consts = constants(src);

    const re = /\.from\(\s*"([a-z_]+)"\s*\)([\s\S]{0,300}?)\.select\(/g;
    let m;
    while ((m = re.exec(src))) {
      const table = m[1];
      // Prettier writes a trailing comma on a wrapped argument list, which is
      // not part of the literal and anchored every match against it.
      const raw = (selectArgument(src, m.index + m[0].length) ?? "")
        .trim()
        .replace(/,$/, "")
        .trim();

      // `.select()` with no argument is every column, the same as "*".
      if (raw === "") continue;

      /*
       * `.select("id", { count: "exact", head: true })` — the column list is
       * the FIRST argument and the options object is not one. Split at the top
       * level so a brace or a nested paren in the options cannot confuse it.
       */
      const first = topLevelPieces(raw)[0].trim();

      let list = null;
      const literal =
        first.match(/^"((?:[^"\\]|\\.)*)"$/s) ?? first.match(/^`([^`]*)`$/s);
      if (literal) list = literal[1];
      else if (consts.has(first)) list = consts.get(first);

      if (list === null) {
        unresolved.push({ file, table, expression: raw.slice(0, 60) });
        continue;
      }
      if (list.trim() === "*") continue;

      for (const piece of topLevelPieces(list)) {
        const name = piece.trim();
        // An embedded relation, a rename or a count — not a plain column.
        if (!name || EMBED.test(name)) continue;
        if (!/^[a-z_][a-z0-9_]*$/.test(name)) continue;
        if (!columns.has(table)) columns.set(table, new Set());
        columns.get(table).add(name);
      }
    }
  }

  return { columns, unresolved };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { columns, unresolved } = columnManifest();
  const total = [...columns.values()].reduce((n, s) => n + s.size, 0);
  console.log(`\nColumn manifest`);
  console.log(`  ${columns.size} tables, ${total} columns read from the code`);
  for (const [t, s] of [...columns].sort()) {
    console.log(`    ${t.padEnd(26)} ${s.size}`);
  }
  if (unresolved.length) {
    console.log(`\n  ${unresolved.length} selects could not be read:`);
    for (const u of unresolved) {
      console.log(`    ${u.file}: ${u.table} <- ${u.expression}`);
    }
  }
}
