#!/usr/bin/env node
/**
 * Every check, in order, and a last line that says whether the run passed.
 *
 * WHY THIS IS A SCRIPT AND NOT A CHAIN OF `&&`. The chain was correct — a
 * failing step stops it and npm exits non-zero — and it still let a green be
 * reported off a run that was red. The failure mode was not the exit code; it
 * was that a failed run and a passing one LOOK THE SAME from the tail. A chain
 * ends at the step that failed, so the last thing on screen is test output, the
 * same scrolling wall a passing run ends with, and nothing anywhere states what
 * it meant for the run as a whole. An exit code somebody has to remember to ask
 * for is a verdict that can be skipped.
 *
 * So the contract is: **the last line is the verdict, and there is nothing
 * after it.** A truncated log, a tail, a notification, somebody glancing at a
 * terminal — all of them land on `VERIFY PASSED` or `VERIFY FAILED`. It costs a
 * few lines of output and removes a whole class of misreading.
 *
 * FAIL-FAST IS KEPT, deliberately. A broken typecheck makes every step after it
 * meaningless, and a wall of consequential failures buries the one that matters.
 * The summary names the steps that never ran, so "not run" and "passed" are not
 * the same blank.
 *
 * THE LIST IS THE ONLY COPY. It used to be a string in `package.json`; the
 * scripts it names are verified to exist before anything runs, and
 * `tests/unit/verify-runner.test.ts` asserts the same against `package.json`,
 * so a renamed script fails in a test rather than five minutes into a run.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The gate, in order.
 *
 * TWO OF THESE WERE ONLY EVER IN CI. Comparing this list against
 * `.github/workflows/ci.yml` — the thing that actually runs on a push — they
 * were different sets and neither was a superset: CI ran `check:transitions`
 * and `check:blockers` and this did not, while this runs `check:duration`,
 * `check:migrations` and `check:advisories` and CI does not (advisories is a
 * job of its own there, so a dependency nobody can fix cannot take the rest
 * down with it). `check:transitions` is the one that mattered: it is what stops
 * the TypeScript and SQL booking status machines disagreeing, and it had never
 * run locally. So "verify green" and "CI green" were two different claims while
 * CLAUDE.md treated this as THE gate.
 */
export const STEPS = [
  { name: "lint", script: "lint" },
  { name: "typecheck", script: "typecheck" },
  { name: "messages", script: "check:messages" },
  { name: "message keys", script: "check:keys" },
  { name: "status transitions", script: "check:transitions" },
  { name: "durations", script: "check:duration" },
  { name: "migrations", script: "check:migrations" },
  { name: "advisories", script: "check:advisories" },
  { name: "tests", script: "test" },
  { name: "launch blockers", script: "check:blockers" },
  { name: "build", script: "build" },
  /*
   * THE BUNDLE BUDGET IS ITS OWN STEP NOW, AFTER THE BUILD AND BEFORE PAINT. It used
   * to run inside `build`, parsing the route table Next printed — Next 16 deleted
   * those columns under both builders, so it measures script transferred in a real
   * Chromium instead. That needs a browser, which Vercel's builder has not, so the
   * budget no longer gates a deploy by itself: CI runs it on every push, and
   * `LAUNCH-BLOCKERS.md § ci-gates-deploy` carries the question of making a red push
   * unable to deploy.
   */
  { name: "bundle budget", script: "check:bundle" },
  { name: "paint", script: "check:paint" },
  { name: "booking flows", script: "check:flows" },
];

/** The scripts `package.json` actually defines. */
export function definedScripts(root = process.cwd()) {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  return Object.keys(pkg.scripts ?? {});
}

/**
 * Steps naming a script that does not exist.
 *
 * Checked BEFORE anything runs. A renamed script would otherwise surface as an
 * npm error four minutes into a five-minute run, which reads exactly like a
 * real failure and sends somebody looking in the wrong place.
 */
export function unknownSteps(steps, defined) {
  return steps.filter((s) => !defined.includes(s.script)).map((s) => s.script);
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Run the steps and return what happened. Pure enough to test: the child
 * process spawner is injected, so the unit tests never shell out to a real run.
 */
export async function runSteps(steps, run, log = console.log) {
  const results = [];
  let failure = null;
  const startedAt = Date.now();

  for (const step of steps) {
    if (failure) {
      results.push({ ...step, state: "not run" });
      continue;
    }

    const at = Date.now();
    const code = await run(step);
    const ms = Date.now() - at;

    if (code === 0) {
      results.push({ ...step, state: "ok", ms });
    } else {
      results.push({ ...step, state: "FAILED", ms, code });
      failure = { step, code };
    }
  }

  const total = Date.now() - startedAt;

  /*
   * THE SUMMARY FIRST, THE VERDICT LAST. The table is what tells somebody which
   * step went and which never ran; the banner is what cannot be misread. In
   * that order, because whatever truncates the output keeps the end.
   */
  log("");
  log("Verify");
  for (const r of results) {
    // `--` for a step the failure stopped, never a blank: "did not run" and
    // "passed" must not look the same, which is the rule about a default never
    // reading as a measurement, one level up from the data.
    const marker = { ok: "ok", FAILED: "FAIL", "not run": "--" }[r.state];
    const timing = r.ms === undefined ? "" : `  ${seconds(r.ms)}`;
    log(`  ${marker.padEnd(4)} ${r.name}${timing}`);
  }
  log("");

  if (failure) {
    log(`VERIFY FAILED — ${failure.step.name} (npm run ${failure.step.script}) exited ${failure.code}`);
  } else {
    log(`VERIFY PASSED — ${results.length} steps in ${seconds(total)}`);
  }

  return { code: failure ? failure.code : 0, results, failure };
}

/** Spawn `npm run <script>`, inheriting stdio so each check prints as it always did. */
function npmRun(step) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", step.script], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  const missing = unknownSteps(STEPS, definedScripts());
  if (missing.length > 0) {
    console.log("");
    console.log(`VERIFY FAILED — no such npm script: ${missing.join(", ")}`);
    process.exit(1);
  }

  const { code } = await runSteps(STEPS, npmRun);
  process.exit(code);
}

// Importable by the tests without running the whole gate.
if (process.argv[1] && process.argv[1].endsWith("verify.mjs")) {
  await main();
}
