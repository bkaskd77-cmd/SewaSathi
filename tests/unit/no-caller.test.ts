import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every exported function in `lib/` is reached from production code, or says why not.
 *
 * THIS IS THIS REPOSITORY'S MOST-REPEATED FAILURE AND NOTHING CHECKED FOR IT.
 * The list is long enough to be a pattern rather than a run of bad luck:
 *
 *   - `applyRedoRecovery` — written, tested and documented in three places with
 *     no caller for four phases, while `/providers/standards` already promised
 *     professionals a balance "you can watch going down". It only ever went up.
 *   - `proposeBand` — the statistic that proposes a price, with no caller for
 *     four phases, while the only way to move a band was a migration.
 *   - `mode: "correction"` on it — written, commented at length, passed by
 *     nothing, and a test asserted the branch, so a green suite proved a
 *     parameter the product never sent.
 *   - `setCategoryContent`, `publishDocument`, `documentVersions` — a whole
 *     phase's data layer with one of three screens.
 *   - `dispatchPauseFor` — no caller, and a comment claiming a test asserted
 *     its safety. No such test existed.
 *   - `logTriage` returning void — every individual link of the triage-to-booking
 *     join built, and the chain never closed.
 *
 * Every one was found by a person reading, months later. A function nothing
 * calls is not merely dead: it reads as a feature, gets cited in comments and
 * in the standing notes as though it were in force, and the promise it appears
 * to keep is the thing that turns out to be false.
 *
 * SO THE SCAN IS THE GUARD AND THE WAIVERS ARE THE DECISIONS. An export with no
 * production reader fails here unless it is listed below with a reason, which
 * is `routes-reachable`'s arrangement — and the same answer to the same
 * objection: a maintained list of things-to-check has the blind spot it is
 * meant to close, so the list is of EXCEPTIONS and the scan finds the rest.
 *
 * A TEST IS NOT A CALLER, which is the whole point. `mode: "correction"` had
 * tests. `applyRedoRecovery` had tests. Being exercised is not being reached,
 * so test files are excluded from the scan and the waiver has to say why
 * nothing in the product needs it.
 */

function walk(p: string): string[] {
  /* `fs.globSync` exists at runtime and not in this Node's TS types — green
     under vitest and red under tsc, a trap this repo has already stepped in. */
  if (statSync(p).isFile()) return /\.(ts|tsx|mjs)$/.test(p) ? [p] : [];
  return readdirSync(p).flatMap((entry) => walk(path.join(p, entry)));
}

/**
 * Comments stripped before anything is counted.
 *
 * Naming a function in order to explain it is documentation, not a call — the
 * distinction `provider-money-one-source` and `unarmed-levers` both make. Worse
 * than useless without it: this repo's comments are long and cross-reference
 * everything, so every orphan above would have looked reached.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const PRODUCTION = [
  "lib",
  "app",
  "components",
  "scripts",
  "i18n",
  "types",
  "middleware.ts",
].flatMap(walk);

const SOURCES = new Map(
  PRODUCTION.map((file) => [file, withoutComments(readFileSync(file, "utf8"))]),
);

/**
 * Exports with no production reader, each with the reason it has none.
 *
 * THE REASON HAS TO SAY WHY NOTHING NEEDS IT, not what it does. "A helper" is
 * not a reason; "the one place that decides X asks Y instead, and these two
 * cannot disagree because both read Z" is.
 */
const NO_CALLER_EXPECTED: Record<string, string> = {
  /* ---- state a test has to be able to reset ---------------------------- */
  "lib/server/rate-limit.ts:resetRateLimits":
    "In-process state with no other way to clear it. The limiter is a module-level map, so one test's requests would otherwise count against the next one's — and the product must never reset a live limiter, which is exactly why this has no caller.",
  "lib/server/ai-quota.ts:resetAiQuotas":
    "Same shape as `resetRateLimits`: per-instance counters a test needs a clean one of, and a production caller would be a way to hand somebody a fresh AI day.",
  "lib/server/triage-cache.ts:clearTriageCache":
    "Same again. A production caller would be a cache-bust endpoint nobody asked for; the cache is ten minutes and expires on its own.",

  /* ---- an accessor over a list the product reads directly -------------- */
  "lib/config/health.ts:isPublicCheck":
    "`PUBLIC_CHECKS` is the reasoning and the route's own array of pushed checks is what decides, which is the right shape — the public payload is built by which checks RUN, not by filtering a longer list. The two cannot drift: `tests/unit/health-public.test.ts` reads the route source and compares them in both directions. This predicate is the convenient form of a list nothing needs to ask about one name at a time.",
  "lib/config/cron.ts:isCronJob":
    "`CRON_JOBS` is one list written three times — here, `vercel.json` and the check constraint — and every production reader wants the whole list rather than one membership question. The comparison is what matters and it is asserted directly.",
  "lib/config/ledger.ts:isLedgerKind":
    "`MONEY_KINDS` and `GUARANTEE_KINDS` are what callers read, and the database's own check constraint is what refuses a bad kind. A TypeScript membership test in front of it would be a second guard that could disagree with the first.",
  "lib/config/admin-money.ts:moneyWriteFor":
    "`ADMIN_MONEY_WRITES` is scanned as a whole by the AST test that enforces it — the coverage half is the point, so nothing wants one entry by name.",
  "lib/config/money-assertions.ts:assertsMoneyMoved":
    "The declaration IS the product surface here: `MONEY_ASSERTIONS` exists to be scanned against the migrations, and the predicate is how its own test reads it.",
  "lib/config/money-assertions.ts:assertionFor":
    "`MONEY_ASSERTIONS` again, by column name rather than as a predicate. The product reads the whole list because the guard's value is coverage — a `*_paid` column nobody declared — and asking about one column at a time is what the test does when it reports which one failed.",

  /* ---- a second spelling of a rule, kept and stated -------------------- */
  "lib/retention/policy.ts:isExpired":
    "The per-row question, where the sweep asks the per-QUERY one: `cutoffFor` returns an instant a SQL comparison uses, which is what a delete needs. Both read `RETENTION[key].days`, so they cannot disagree about the window. Kept because the per-row form is what any future screen showing one row's countdown would ask, and because deleting it would leave the sweep's arithmetic unexplained.",
  "lib/retention/policy.ts:deletesEarlyOn":
    "The accessor over `EARLY_DELETION`, whose one obligation `lib/data/review.ts` honours directly at the moment of approval rather than by asking a predicate. The constant is the written record; this is how its test reads it.",
  "lib/security/secret-box.ts:isSealed":
    "A shape test over a stored envelope. Every production path either seals or opens — `seal` and `open` — and a caller that checked the shape first would be deciding whether to try, where `open` already answers that with the real question. It is what the tests assert the envelope format with.",
  "lib/security/secret-box.ts:sealingIsConfigured":
    "`/api/health` asks `sealingStatus()`, which is three-way (unset, wrong length, ready) because 'nobody set it' and 'somebody set it wrongly' are different jobs. This boolean collapses them, which is the thing that check exists not to do, so no production surface should use it.",

  /* ---- a branch of a rule whose caller is a screen, not a module ------- */
  "lib/ai/photo-retake.ts:photosFull":
    "The slot count is enforced where the slots are — `MAX_TRIAGE_PHOTOS` in the hero and `MAX_CLAIM_PHOTOS` by the unique slot key in SQL — so this is the rule stated beside `judgeRetake` for the day a screen needs to disable an add button, and the test is what keeps it honest until then.",
  "lib/content/prose-text.ts:editableSections":
    "`/admin/content/documents/[...slug]` builds its textareas from the document's own sections and `serializeBlocks`, one section at a time, because each needs its own id and heading field. This is the whole-document form, kept beside `documentLines` as the round-trip the format's invariant is tested through.",
  "lib/pwa/photo-queue.ts:hasQueuedPhoto":
    "The arrival panel reads the queue itself to show what is waiting, so it wants the rows rather than a boolean. Kept as the cheap question for a badge that does not exist yet.",
};

type Export = { name: string; file: string };

function exportsInLib(): Export[] {
  const found: Export[] = [];
  for (const [file, text] of SOURCES) {
    if (!file.startsWith("lib/")) continue;
    for (const match of text.matchAll(
      /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    )) {
      found.push({ name: match[1], file });
    }
  }
  return found;
}

/** How many times `name` appears in production code, excluding its own declaration. */
function productionUses(name: string, declaredIn: string): number {
  const pattern = new RegExp(`\\b${name}\\b`, "g");
  let uses = 0;
  for (const [file, text] of SOURCES) {
    const hits = (text.match(pattern) || []).length;
    uses += file === declaredIn ? Math.max(0, hits - 1) : hits;
  }
  return uses;
}

describe("no exported function in lib/ is unreachable by accident", () => {
  it("finds the exports, so a pattern that stopped matching fails", () => {
    /*
     * THE COUNT FIRST, for the reason `drift-token` records: a regex that
     * quietly stopped matching would make every case below pass over an empty
     * list, and a scanner that has stopped scanning prints the same tick as one
     * that found nothing wrong.
     */
    expect(exportsInLib().length).toBeGreaterThan(600);
    expect(SOURCES.size).toBeGreaterThan(300);
  });

  it("reaches every one from production code, or has a reason it cannot", () => {
    const orphans = exportsInLib().filter(
      ({ name, file }) => productionUses(name, file) === 0,
    );

    const undeclared = orphans
      .map(({ name, file }) => `${file}:${name}`)
      .filter((key) => !(key in NO_CALLER_EXPECTED));

    expect(
      undeclared,
      `No production code reaches:\n  ${undeclared.join("\n  ")}\n\n` +
        `A test is not a caller — \`applyRedoRecovery\` and ` +
        `\`mode: "correction"\` both had tests and neither had a caller. ` +
        `Either wire it up in this commit, delete it, or add it to ` +
        `NO_CALLER_EXPECTED with a reason saying why nothing in the product ` +
        `needs it.`,
    ).toEqual([]);
  });

  it("has no waiver for something that is now reached, or gone", () => {
    /*
     * A STALE WAIVER SILENTLY COVERS WHATEVER TAKES THAT NAME NEXT, which is
     * `routes-reachable`'s own rule for a stale exemption. And a waiver over a
     * function that HAS acquired a caller is worth deleting the moment it does:
     * the reason it was written has stopped being true.
     */
    const orphans = new Set(
      exportsInLib()
        .filter(({ name, file }) => productionUses(name, file) === 0)
        .map(({ name, file }) => `${file}:${name}`),
    );

    for (const key of Object.keys(NO_CALLER_EXPECTED)) {
      expect(
        orphans.has(key),
        `${key} is waived as having no caller, and either it has one now — ` +
          `delete the waiver, the reason has stopped being true — or the ` +
          `function is gone and the waiver would cover whatever takes its ` +
          `name next.`,
      ).toBe(true);
    }
  });

  it("gives every waiver a reason long enough to be one", () => {
    for (const [key, why] of Object.entries(NO_CALLER_EXPECTED)) {
      expect(why.length, `${key}'s reason`).toBeGreaterThan(80);
    }
  });
});
