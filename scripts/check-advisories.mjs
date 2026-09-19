#!/usr/bin/env node
/**
 * Dependency advisories, against a list of the ones already decided.
 *
 * WHY THIS IS NOT JUST `npm audit`. CI ran `npm audit --audit-level=critical`
 * and it did its job — until a CRITICAL advisory landed in Next 14 on
 * 2026-09-10, whose only fix is the Next 16 major upgrade. From that moment
 * every run was red at the sixth step, so lint, typecheck, the message and
 * transition checks, the tests, the build, the paint check and the flow check
 * ALL STOPPED RUNNING, for nine days, while the emails kept arriving. A check
 * that is always red is a check nobody reads, and it takes the checks below it
 * down with it.
 *
 * SO THE QUESTION IS NOT "IS THERE AN ADVISORY" BUT "IS THERE A NEW ONE". The
 * ones below are known, named in LAUNCH-BLOCKERS.md, and cannot be fixed
 * without a major version bump that is its own phase. They are printed on every
 * run so they never become invisible; anything NOT on this list fails.
 *
 * The same shape `check:blockers` uses: a decision somebody made, written down,
 * so the difference between "accepted" and "nobody looked" stays visible.
 *
 * WHEN NEXT 16 LANDS, delete the entries below. An accepted advisory that no
 * longer applies is a hole left open on purpose, so the list failing closed
 * matters: an id here that npm no longer reports is reported as stale.
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

/**
 * Known, decided, and tracked as the `next-14-advisories` launch blocker.
 *
 * Keyed by package, because npm reports 23 Next advisories under one entry and
 * they all resolve with the same upgrade — listing them individually would be a
 * list nobody maintains, and a new Next advisory changes nothing about the
 * decision while this version is pinned.
 */
const ACCEPTED = {
  next: {
    severity: "critical",
    why: "Fixed only by next@16, a major upgrade across next-intl and every route. Tracked as next-14-advisories.",
  },
  postcss: {
    severity: "high",
    why: "Transitive under next; resolves with the same upgrade.",
  },
};

function audit() {
  try {
    // Exits non-zero whenever anything is found, which is the normal case
    // here — the output is what matters, not the code.
    return execFileSync("npm", ["audit", "--json", "--omit=dev"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim()) {
      return error.stdout;
    }
    throw error;
  }
}

let report;
try {
  report = JSON.parse(audit());
} catch (error) {
  /*
   * NO ANSWER IS NOT A PASS. An unreachable registry or an unparseable report
   * means we do not know, and "we did not look" must never read as "nothing
   * found" — the same rule `/api/health` keeps with `unknown`.
   */
  console.error("\nDependency advisories");
  console.error(`  Could not read npm audit — ${error.message}`);
  console.error("  This is NOT a pass. Run it again with a working registry.\n");
  process.exit(2);
}

/*
 * A REPORT THAT IS NOT A REPORT.
 *
 * This is the hole the first version of this file shipped with, and it gave a
 * false green within two days of being written. `npm audit --json` can exit
 * ZERO, emit valid JSON, and have that JSON be an HTTP error envelope rather
 * than a result — `{statusCode, error, message, body, headers, method, uri}`
 * with no `vulnerabilities` key at all. "Invalid package tree" does exactly
 * that. `report.vulnerabilities ?? {}` then read it as an empty set of
 * findings, printed "0 accepted, nothing new" and exited 0, on a project with
 * a known unpatched critical.
 *
 * The exit-2 path below already said "no answer is not a pass" and it was
 * right; it just only covered JSON that would not parse. Parsing fine and
 * meaning nothing is the same event, so it gets the same answer.
 */
if (!report || typeof report !== "object" || !("vulnerabilities" in report)) {
  const why =
    typeof report?.message === "string" && report.message
      ? report.message
      : `npm returned ${report?.statusCode ?? "no findings and no error"}`;
  console.error("\nDependency advisories");
  console.error(`  npm audit did not return a report — ${why}`);
  console.error("  This is NOT a pass. Fix the tree and run it again.\n");
  process.exit(2);
}

const found = report.vulnerabilities ?? {};
const unexpected = [];
const accepted = [];

for (const [name, entry] of Object.entries(found)) {
  const known = ACCEPTED[name];
  if (known && known.severity === entry.severity) {
    accepted.push({ name, severity: entry.severity, why: known.why });
  } else {
    unexpected.push({
      name,
      severity: entry.severity,
      // A known package whose severity has gone UP is not an accepted
      // advisory any more. The decision was made about a severity, not about
      // a package name.
      escalated: Boolean(known),
    });
  }
}

const stale = Object.keys(ACCEPTED).filter((name) => !(name in found));

console.log("\nDependency advisories");

for (const row of accepted) {
  console.log(`  known  ${row.name} (${row.severity}) — ${row.why}`);
}

for (const name of stale) {
  console.log(
    `  STALE  ${name} is on the accepted list and npm no longer reports it.`,
  );
  console.log("         Remove it from scripts/check-advisories.mjs.");
}

if (unexpected.length === 0) {
  console.log(
    `  ${accepted.length} accepted, nothing new.${
      stale.length > 0 ? ` ${stale.length} stale entry to remove.` : ""
    }\n`,
  );
  // A stale entry is a note to tidy, not a reason to stop a phase.
  process.exit(0);
}

console.error("");
for (const row of unexpected) {
  console.error(
    row.escalated
      ? `  ESCALATED  ${row.name} is now ${row.severity}, above what was accepted.`
      : `  NEW  ${row.name} (${row.severity}) — nobody has decided about this one.`,
  );
}
console.error(
  "\n  Decide it: fix it, or add it to ACCEPTED in scripts/check-advisories.mjs",
);
console.error("  with a reason and an entry in LAUNCH-BLOCKERS.md.\n");
process.exit(1);
