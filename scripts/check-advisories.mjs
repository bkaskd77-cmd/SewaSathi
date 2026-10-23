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
 *
 * THREE PASSES NOW, AND THE AUDIT IS THE LAST OF THEM, because asking npm turned
 * out to be the weakest of the three. On 2026-10-22 this script was measured
 * against the thing it exists to catch and it had missed it by eight days:
 * GHSA-2464-fhr4-w9xw, an unauthenticated RCE in the Next image optimiser,
 * critical, published 2026-10-14 alongside the `next@16.4.1` that fixes it,
 * while CI's advisories job passed on the 15th, 16th, 17th, 18th and 19th on a
 * known-affected `next@16.3.8`. And `next@16.4.1`'s release notes name THREE
 * advisories where npm's feed carries two — GHSA-673q-mjm6-r5xr, also a
 * critical RCE, is absent from `npm audit` to this day. So the feed is late and
 * the feed is incomplete, and a gate resting on it alone is a gate that reports
 * clean while a critical hole is open.
 *
 *   1. FLOORS       `scripts/dependency-floors.mjs` — the minimum version per
 *                   package, with the advisories that say so, read from the
 *                   lockfile. No network, so it cannot lag and cannot be
 *                   incomplete.
 *   2. INSTALL      `scripts/install-scripts.mjs` — every dependency allowed to
 *      SCRIPTS      run code at install time, declared with its reason. The
 *                   shortest path from a compromised package to our deploy, and
 *                   a thing `npm audit` says nothing about.
 *   3. AUDIT        npm's own feed, which is what finds the advisories nobody
 *                   here has heard of. Still worth asking; no longer trusted
 *                   on its own.
 *
 * THE ORDER IS THE POINT. The two free passes run FIRST, so a registry outage
 * or an HTTP envelope in place of a report cannot stop them being answered —
 * the failure mode that already produced one false green in this file.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

import { installedVersions, judgeFloors } from "./dependency-floors.mjs";
import {
  INSTALL_SCRIPTS_EXPECTED,
  judgeInstallScripts,
} from "./install-scripts.mjs";

/**
 * Advisories this project has looked at and decided to live with, for now.
 *
 * EMPTY, AND IT GOT THERE BY THE UPGRADE RATHER THAN BY A DECISION TO STOP CARING.
 * `next` (critical, 23 advisories under one entry) and `postcss` (high, transitive
 * beneath it) sat here for phases because the only fix was `next@16`; that upgrade has
 * landed, `npm audit --omit=dev` reports neither, and the stale-entry check named both
 * by name on the first run afterwards — which is what it is for. An accepted entry that
 * no longer applies is a hole propped open on purpose, and this list going empty is the
 * point rather than an oddity.
 *
 * Keyed by package when it has entries, because npm groups many advisories under one
 * and they usually resolve with a single upgrade — listing them individually would be a
 * list nobody maintains.
 */
const ACCEPTED = {
  /*
   * THE ESLINT 9 GROUP. `eslint-config-next@14.2.35` sits in a Next 16 project,
   * and the fix npm names is `eslint-config-next@16.4.2`, which peers on
   * `eslint >=9`. We are on eslint 8 with a `.eslintrc.json`, so taking it
   * means the flat-config migration — and that config is what carries
   * `no-restricted-imports`, the rule enforcing every module boundary in
   * ARCHITECTURE.md. Porting it is a phase with its own break-tests, not a
   * dependency bump, so it is a decision rather than an omission:
   * LAUNCH-BLOCKERS.md § eslint-9-flat-config.
   *
   * All three are DEV-ONLY and none is reachable by a customer: a quadratic
   * brace expansion and a `glob` CLI flag nothing in this repository invokes.
   */
  "@next/eslint-plugin-next": {
    tree: "dev",
    severity: "high",
    why: "ESLint 9 flat-config migration — LAUNCH-BLOCKERS § eslint-9-flat-config. Dev-only, DoS class.",
  },
  "eslint-config-next": {
    tree: "dev",
    severity: "high",
    why: "Same bump, same migration. Dev-only.",
  },
  glob: {
    tree: "dev",
    severity: "high",
    why: "Command injection via the glob CLI's -c/--cmd flag, which nothing here runs; it arrives under eslint-config-next and leaves with it. Dev-only.",
  },

  /*
   * THE TAILWIND 4 GROUP. `tailwindcss@3.4.x` and its PostCSS chain. The fix is
   * Tailwind 4, which changes the CSS pipeline — and `styles/globals.css` is
   * the single source of truth for every design token in this product, with a
   * contrast pass per component riding on it. That is a phase:
   * LAUNCH-BLOCKERS.md § tailwind-4.
   *
   * Every one is a quadratic-time DoS in a BUILD-TIME CSS parser, reachable
   * only by whoever already controls the source tree. Dev-only, and
   * `tailwindcss` is a devDependency.
   *
   * THIS GROUP WAS SEVEN ENTRIES AND IS THREE, OFF AN UNCHANGED LOCKFILE —
   * which is the second measured instance of npm's feed moving under a static
   * tree, and the reason the floors pass exists. On 2026-10-23 `npm audit`
   * stopped reporting `braces`, `micromatch`, `fast-glob` and `chokidar` — the
   * Tailwind 3 file-watcher chain — and began routing `tailwindcss`' finding
   * through `postcss-selector-parser` (GHSA-rj75-hqrm-r3gf) alone, taking it
   * from high to moderate. `git status` on `package-lock.json` was clean
   * across it. Nothing about this product's exposure changed; what changed is
   * what one feed says about it, in both directions at once. The four were
   * removed rather than kept "just in case", because a stale acceptance is a
   * hole propped open for whatever takes that package's name next.
   */
  tailwindcss: {
    tree: "dev",
    severity: "moderate",
    why: "Tailwind 4 migration — LAUNCH-BLOCKERS § tailwind-4. Dev-only, build-time DoS. Reported high until 2026-10-23 and moderate since, off an unchanged lockfile: it now carries only the postcss chain below, the watcher findings having left npm's feed.",
  },
  "tailwindcss-animate": {
    tree: "dev",
    severity: "moderate",
    why: "Rides on tailwindcss; leaves with the same migration.",
  },
  "postcss-nested": {
    tree: "dev",
    severity: "moderate",
    why: "Tailwind 3's PostCSS plugin chain.",
  },
  "postcss-selector-parser": {
    tree: "dev",
    severity: "moderate",
    why: "Same chain. No fix published; it leaves with Tailwind 4.",
  },
};

/*
 * THE LOCKFILE, READ ONCE FOR BOTH FREE PASSES.
 *
 * AN UNREADABLE LOCKFILE IS NOT A PASS, which is this file's own standing rule
 * for npm returning nothing: "we did not look" must never read as "nothing
 * found". Exit 2 is what `check:deployed` and `check:drift` use for the same
 * meaning, so a monitor can tell "could not look" from "found something".
 */
let lock;
try {
  lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
} catch (error) {
  console.error("\nDependency advisories");
  console.error(`  Could not read package-lock.json — ${error.message}`);
  console.error("  This is NOT a pass. The floors and the install-script");
  console.error("  inventory are both read from it.\n");
  process.exit(2);
}

/* Collected rather than exited on, so one run reports every pass. A gate that
   stops at the first failure makes the second one cost another round trip. */
const failures = [];

console.log("\nDependency floors");

const floors = judgeFloors(installedVersions(lock));
for (const row of floors) {
  if (row.verdict === "ok") {
    console.log(`  ok     ${row.package} ${row.version} >= ${row.minimum}`);
    continue;
  }
  failures.push(`${row.package} floor`);
  if (row.verdict === "below") {
    console.error(
      `  BELOW  ${row.package} ${row.version} is under the floor of ${row.minimum}`,
    );
  } else {
    console.error(`  UNREAD ${row.package} — ${row.detail}`);
  }
  console.error(`         ${row.advisories.join(", ")}`);
  console.error(`         ${row.why}`);
}
if (failures.length === 0) {
  console.log(
    `  ${floors.length} floors hold. npm's feed is late and incomplete — see the`,
  );
  console.log("  header; this pass is what does not depend on it.");
}

console.log("\nInstall scripts");

const scripts = judgeInstallScripts(lock);
for (const one of scripts.actual) {
  const known = INSTALL_SCRIPTS_EXPECTED[one.name];
  if (known && known.scope === one.scope) {
    console.log(`  ok     ${one.name} (${one.scope}) — via ${known.pulledBy}`);
  }
}
for (const one of scripts.undeclared) {
  failures.push(`${one.name} install script`);
  console.error(
    `  NEW    ${one.name} (${one.scope}) runs code at install time and nobody`,
  );
  console.error("         has decided about it. It runs with the privileges of");
  console.error("         whoever typed `npm ci` — on CI that is a token that can");
  console.error("         push here and a hook that can deploy. Declare it in");
  console.error("         scripts/install-scripts.mjs with what pulls it in, or");
  console.error("         remove the dependency.");
}
for (const one of scripts.misclassified) {
  failures.push(`${one.name} install script scope`);
  console.error(
    `  MOVED  ${one.name} is declared ${INSTALL_SCRIPTS_EXPECTED[one.name].scope}` +
      ` and is now ${one.scope}.`,
  );
  console.error("         A dev install script reaching the production tree is a");
  console.error("         different decision from the one that was made.");
}
for (const name of scripts.stale) {
  failures.push(`${name} install-script entry`);
  console.error(`  STALE  ${name} is declared and the lockfile no longer runs a`);
  console.error("         script for it. Remove the entry — it would otherwise");
  console.error("         waive whatever takes that package's name next.");
}

function audit(args) {
  try {
    // Exits non-zero whenever anything is found, which is the normal case
    // here — the output is what matters, not the code.
    return execFileSync("npm", ["audit", "--json", ...args], {
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

/*
 * BOTH TREES, AND `--omit=dev` IS GONE FROM THE ONLY CALL THAT HAD IT.
 *
 * It was there for a defensible reason — a build-time DoS in a file watcher is
 * not the same risk as an unauthenticated RCE in the image optimiser — and the
 * cost was that the dev tree was INVISIBLE. On 2026-10-22 that meant two
 * CRITICAL advisories nobody here could see: `tinypool` (prototype-pollution
 * gadget to RCE in worker options) and `vitest`, both reachable on a CI runner
 * holding a token that can push to this repository and a hook that can deploy.
 * The gate reported "0 accepted, nothing new" over them.
 *
 * So the dev tree is read too, and reported SEPARATELY rather than merged: the
 * two really are different risks, and a flat list would either make every
 * watcher DoS look like a customer-facing RCE or teach somebody to skim the
 * section where the RCE will appear. Separate sections, both failing, each
 * acceptable on its own terms.
 */
let report;
let prodReport;
try {
  report = JSON.parse(audit([]));
  prodReport = JSON.parse(audit(["--omit=dev"]));
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
/* BOTH reports, because an envelope for one tree and a result for the other
   would read as "that tree is clean" — which is the same false green with half
   the coverage. */
for (const [which, candidate] of [
  ["both trees", report],
  ["the production tree", prodReport],
]) {
  if (candidate && typeof candidate === "object" && "vulnerabilities" in candidate) {
    continue;
  }
  const why =
    typeof candidate?.message === "string" && candidate.message
      ? candidate.message
      : `npm returned ${candidate?.statusCode ?? "no findings and no error"}`;
  console.error("\nDependency advisories");
  console.error(`  npm audit did not return a report for ${which} — ${why}`);
  console.error("  This is NOT a pass. Fix the tree and run it again.\n");
  process.exit(2);
}

const found = report.vulnerabilities ?? {};
const inProd = new Set(Object.keys(prodReport.vulnerabilities ?? {}));

/*
 * WHICH TREE A FINDING IS IN IS THE `--omit=dev` RUN'S OWN ANSWER, not a guess
 * from the lockfile's `dev` flags. A package reachable both ways is production,
 * which is what the prod run reporting it means.
 */
const treeOf = (name) => (inProd.has(name) ? "prod" : "dev");

const unexpected = [];
const accepted = [];

for (const [name, entry] of Object.entries(found)) {
  const known = ACCEPTED[name];
  const tree = treeOf(name);
  /*
   * AN ACCEPTANCE IS FOR ONE SEVERITY IN ONE TREE. The severity clause was
   * already here — a decision is about a severity, not a package name — and the
   * tree clause is the same rule for the move that matters more: a dev-only
   * build-time DoS accepted with "nothing a customer can reach" stops being
   * true the moment that package appears in the production tree, and nothing
   * else would have said so. `ACKNOWLEDGED_FAILURES`' rule, one gate over: an
   * entry for one thing must not forgive another.
   */
  if (known && known.severity === entry.severity && known.tree === tree) {
    accepted.push({ name, tree, severity: entry.severity, why: known.why });
  } else {
    unexpected.push({
      name,
      tree,
      severity: entry.severity,
      reseverity: Boolean(known) && known.severity !== entry.severity,
      acceptedSeverity: known?.severity ?? null,
      moved: Boolean(known) && known.severity === entry.severity && known.tree !== tree,
      declaredTree: known?.tree ?? null,
    });
  }
}

const stale = Object.keys(ACCEPTED).filter((name) => !(name in found));

console.log("\nDependency advisories");

/*
 * THE TWO TREES ARE PRINTED SEPARATELY AND IN THIS ORDER. A production finding
 * is what can reach a customer; a dev one reaches a CI runner holding a push
 * token, which is serious and is not the same thing. One merged list would
 * either flatten that or bury the production line under the watcher DoSes.
 */
for (const tree of ["prod", "dev"]) {
  const rows = accepted.filter((row) => row.tree === tree);
  if (rows.length === 0) continue;
  console.log(
    tree === "prod"
      ? "  production tree — accepted:"
      : "  dev tree (CI runners and developer machines) — accepted:",
  );
  for (const row of rows) {
    console.log(`    known  ${row.name} (${row.severity}) — ${row.why}`);
  }
}

for (const name of stale) {
  console.log(
    `  STALE  ${name} is on the accepted list and npm no longer reports it.`,
  );
  console.log("         Remove it from scripts/check-advisories.mjs.");
}

if (unexpected.length === 0) {
  const prodCount = accepted.filter((row) => row.tree === "prod").length;
  console.log(
    `  ${accepted.length} accepted (${prodCount} production, ` +
      `${accepted.length - prodCount} dev), nothing new.${
        stale.length > 0 ? ` ${stale.length} stale entry to remove.` : ""
      }`,
  );
  // A stale entry is a note to tidy, not a reason to stop a phase.
  if (failures.length === 0) {
    console.log("");
    process.exit(0);
  }
  /* The audit found nothing and a free pass did. That combination is exactly
     what the floors exist for — npm reported clean on a known-affected `next`
     for eight days — so it has to fail loudly rather than inherit this pass. */
  console.error(`\n  ${failures.length} failing: ${failures.join(", ")}.`);
  console.error("  npm audit found nothing new, which is not the same as nothing");
  console.error("  being wrong — see the header.\n");
  process.exit(1);
}

console.error("");
for (const row of unexpected) {
  const where = row.tree === "prod" ? "PRODUCTION tree" : "dev tree";
  if (row.reseverity) {
    /*
     * THE DIRECTION IS NAMED, because this said "above what was accepted" for a
     * severity that had gone DOWN — `tailwindcss` accepted at high and reported
     * moderate — which sends the reader looking for a worsening that did not
     * happen. The `dependency-floors` unreadable-side fix is the same lesson: a
     * diagnostic naming the wrong value costs exactly what the check saved.
     *
     * EITHER DIRECTION STILL FAILS, deliberately. An acceptance is a decision
     * about one severity, and npm re-scoping a finding means the chain it came
     * through has changed — which is the thing worth re-reading, whichever way
     * the label moved.
     */
    const rank = ["info", "low", "moderate", "high", "critical"];
    const now = rank.indexOf(row.severity);
    const was = rank.indexOf(row.acceptedSeverity);
    const direction = now > was ? "up from" : now < was ? "down from" : "changed from";
    console.error(
      `  SEVERITY   ${row.name} is now ${row.severity} in the ${where}, ` +
        `${direction} the ${row.acceptedSeverity} that was accepted.`,
    );
  } else if (row.moved) {
    /* The move that matters: a build-time DoS accepted as unreachable by a
       customer, now in the tree a customer's request runs through. */
    console.error(
      `  MOVED      ${row.name} was accepted in the ${row.declaredTree} tree and is now in the ${where}.`,
    );
  } else {
    console.error(
      `  NEW        ${row.name} (${row.severity}) in the ${where} — nobody has decided about this one.`,
    );
  }
}
console.error(
  "\n  Decide it: fix it, or add it to ACCEPTED in scripts/check-advisories.mjs",
);
console.error("  with a reason and an entry in LAUNCH-BLOCKERS.md.");
if (failures.length > 0) {
  console.error(`  Also failing: ${failures.join(", ")}.`);
}
console.error("");
process.exit(1);
