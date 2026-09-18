#!/usr/bin/env node
/**
 * Two ways a migration goes wrong that nothing else here catches.
 *
 * WHAT PROMPTED THIS, both from the same phase and both shipped to production:
 *
 *   1. A RENAME APPLIED AHEAD OF ITS CODE. `crew_count` renamed a column while
 *      the deployed build still selected the old name. Two reads failed, the
 *      booking screen stopped greying full rows and the catalogue silently fell
 *      back to the seed. Additive migrations had been safe every other time and
 *      the destructive one went out on the same reflex.
 *
 *   2. A FUNCTION REBUILT FROM A STALE DEFINITION. `create or replace` takes
 *      the text you paste, not the text that is there. `freeze_booking_band`
 *      has three definitions in this tree and the newest is authoritative; it
 *      was rebuilt from the oldest and lost both of its survey guards.
 *      `enforce_slot_capacity` lost an advisory lock the same way earlier.
 *      Ten functions here have more than one definition and
 *      `enforce_booking_immutability` has ten.
 *
 * THE GUARD MANIFEST DOES NOT COVER THIS. It asserts that clauses SOMEBODY
 * CHOSE TO PIN are still present. A rebuild from the wrong version can keep
 * every pinned clause and still revert everything nobody thought to pin —
 * which is exactly what happened, after the manifest existed.
 *
 * So this works from what is actually there rather than from a list: every
 * redefinition is diffed against the current authoritative body, and any line
 * that disappears has to be acknowledged. Adding to a function stays free;
 * taking something out of one requires saying so. Across the whole history that
 * is nine declarations on twenty-two redefinitions — and both incidents above
 * appear in those nine.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DIR = path.join(process.cwd(), "supabase/migrations");

/**
 * Operations that cannot be applied before the code that stops needing them.
 *
 * `set not null` and a type change are here for the same reason a drop is: the
 * deployed build is still writing rows the new shape refuses.
 */
const DESTRUCTIVE = [
  { re: /\balter\s+table\s+[^;]*?\bdrop\s+column\b/is, what: "drop column" },
  { re: /\balter\s+table\s+[^;]*?\brename\s+column\b/is, what: "rename column" },
  { re: /\bdrop\s+table\b(?!\s+if\s+exists\s+pg_temp)/is, what: "drop table" },
  { re: /\balter\s+column\s+\S+\s+set\s+not\s+null\b/is, what: "set not null" },
  { re: /\balter\s+column\s+\S+\s+type\b/is, what: "column type change" },
];

/** The header that says a destructive migration knows what it is. */
const AFTER_DEPLOY = /^--\s*AFTER-DEPLOY:\s*\S/m;
/**
 * The header that acknowledges lines leaving a function body.
 *
 * IT NAMES THE FUNCTION, and the first version did not — which made one header
 * silence every removal in the file. A migration that legitimately trims one
 * function would then have waved through a stale rebuild of another sitting
 * beside it, which is the precise failure this whole script exists to catch.
 *
 *   -- REMOVES: sync_booking_quote_floor — the two category reads, replaced by
 *   --   booking_band_bounds.
 */
const REMOVES = /^--\s*REMOVES:\s*([a-z_]+)\b/gm;

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const failures = [];
const notes = [];

/**
 * Every `create or replace function`, in filename order.
 *
 * The LAST one for a name is the authoritative body — that is what Postgres
 * ends up holding on a fresh project, and therefore what a rewrite has to be
 * built from.
 */
const definitions = new Map();

for (const file of files) {
  const src = readFileSync(path.join(DIR, file), "utf8");
  const declared = new Set(
    [...src.matchAll(REMOVES)].map((m) => m[1]),
  );

  // ---- Ordering -----------------------------------------------------------
  //
  // A drop-and-re-add of the same constraint in one file is how a CHECK is
  // widened; it takes nothing away and is not what this is looking for.
  const droppedConstraints = [...src.matchAll(/drop\s+constraint\s+(?:if\s+exists\s+)?(\w+)/gis)].map((m) => m[1]);
  const addedConstraints = new Set(
    [...src.matchAll(/add\s+constraint\s+(\w+)/gis)].map((m) => m[1]),
  );
  const orphanDrops = droppedConstraints.filter((c) => !addedConstraints.has(c));

  const hits = DESTRUCTIVE.filter((d) => d.re.test(src)).map((d) => d.what);
  if (orphanDrops.length) hits.push(`drop constraint (${orphanDrops.join(", ")})`);

  if (hits.length && !AFTER_DEPLOY.test(src)) {
    failures.push(
      `${file} is destructive (${hits.join("; ")}) and carries no "-- AFTER-DEPLOY:" header.\n` +
        `    A rename or a drop cannot be applied before the build that stops using it.\n` +
        `    Add a header saying what has to ship first, and apply this one AFTER that deploy.`,
    );
  }

  // ---- Stale rebuilds -----------------------------------------------------
  const re =
    /create or replace function public\.([a-z_]+)\s*\([\s\S]*?\)\s*returns[\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g;
  let m;
  while ((m = re.exec(src))) {
    const [name, body] = [m[1], m[2]];
    const previous = definitions.get(name);
    definitions.set(name, { file, body });
    if (!previous) continue;

    const before = new Set(meaningful(previous.body));
    const after = new Set(meaningful(body));
    const removed = [...before].filter((line) => !after.has(line));
    if (!removed.length) continue;

    if (declared.has(name)) {
      notes.push(`${name}: ${removed.length} lines removed in ${file} (declared)`);
      continue;
    }

    /*
     * ONE FILE, TWO DEFINITIONS OF THE SAME FUNCTION. Its own smell and its own
     * sentence: "removes a line that <this same file> had" reads as a parser
     * bug and sends the next person looking in the wrong place. The second
     * definition wins silently, so the first is dead text that looks live.
     */
    if (previous.file === file) {
      failures.push(
        `${file} defines ${name} twice, and the second one drops ${removed.length} line(s) from the first.\n` +
          `    Only the last one survives, so the earlier block is dead text that reads as live.\n` +
          `    Collapse them into one definition, or split them across two migrations.\n` +
          `    If the earlier one has to stay, declare it: "-- REMOVES: ${name} — <why>".`,
      );
      continue;
    }

    failures.push(
      `${file} redefines ${name} and removes ${removed.length} line(s) that ${previous.file} had.\n` +
        removed.slice(0, 4).map((l) => `      - ${l}`).join("\n") +
        (removed.length > 4 ? `\n      … and ${removed.length - 4} more` : "") +
        `\n    If that is deliberate, add a "-- REMOVES:" header saying why.\n` +
        `    If it is not, you rebuilt from an older copy — the current one is in ${previous.file}.`,
    );
  }
}

/**
 * Code, not prose.
 *
 * Comments and blank lines move around constantly and a check that fires on
 * them would be turned off within a week. Indentation is dropped too, because
 * re-indenting a block is not removing it.
 */
function meaningful(body) {
  return body
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
}

console.log("\nMigrations");
console.log(`  ${files.length} files, ${definitions.size} functions defined`);

const duplicated = [...definitions.keys()].filter((name) => {
  let count = 0;
  for (const file of files) {
    const src = readFileSync(path.join(DIR, file), "utf8");
    count += (src.match(new RegExp(`create or replace function public\\.${name}\\b`, "g")) ?? []).length;
  }
  return count > 1;
});

/*
 * THE INDEX IS THE POINT, not a statistic. "Rebuild from the current
 * definition" is only actionable if the current one is unambiguous, and with
 * ten copies of `enforce_booking_immutability` in the tree it was not.
 */
if (duplicated.length) {
  console.log(`  ${duplicated.length} functions have more than one definition — authoritative copy:`);
  for (const name of duplicated.sort()) {
    console.log(`    ${name.padEnd(34)} ${definitions.get(name).file}`);
  }
}
for (const note of notes) console.log(`  declared: ${note}`);

/*
 * THE FINGERPRINTS — what the tree says each function's body IS.
 *
 * The checks above police the tree against itself. This is the other axis: a
 * function whose LIVE definition no longer matches the tree, because somebody
 * applied something that was never committed, or edited it in a dashboard. The
 * agent applies migrations through an MCP connection from a sandbox that cannot
 * reach the database over HTTPS, so nothing local can compare the two —
 * `/api/health` runs in production and can, which turns a silent drift into a
 * URL anybody can read.
 *
 * Hashed on the MEANINGFUL lines only, the same normalisation the diff uses.
 * A comment edited in the live copy is not a behaviour change and a check that
 * fires on one gets ignored within a week.
 */
const fingerprints = {};
for (const [name, def] of [...definitions].sort()) {
  fingerprints[name] = {
    sha: createHash("sha256").update(meaningful(def.body).join("\n")).digest("hex").slice(0, 16),
    file: def.file,
  };
}

const FINGERPRINT_FILE = path.join(process.cwd(), "supabase/function-fingerprints.json");
const rendered = JSON.stringify(fingerprints, null, 2) + "\n";
const existing = (() => {
  try {
    return readFileSync(FINGERPRINT_FILE, "utf8");
  } catch {
    return null;
  }
})();

if (process.argv.includes("--write") || existing === null) {
  writeFileSync(FINGERPRINT_FILE, rendered);
  console.log(`  wrote ${Object.keys(fingerprints).length} function fingerprints`);
} else if (existing !== rendered) {
  failures.push(
    `supabase/function-fingerprints.json is stale.\n` +
      `    It is what /api/health compares production against, so a stale one means\n` +
      `    the live check is measuring against a schema nobody ships any more.\n` +
      `    Run: npm run check:migrations -- --write`,
  );
}

if (failures.length) {
  console.error("\nMigration check failed:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("");
  process.exit(1);
}

console.log("  Nothing destructive is unannounced and no function lost a line quietly.\n");
