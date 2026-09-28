import { describe, expect, it } from "vitest";

// Plain ESM with no types, like `scripts/column-manifest.mjs` — a .d.ts would be
// a second thing to keep in step with a script this small. The shape is
// asserted at each use instead.
import { STEPS, definedScripts, runSteps, unknownSteps } from "../../scripts/verify.mjs";

/**
 * The gate says whether it passed, in its last line.
 *
 * WHAT THIS EXISTS BECAUSE OF. A verify run was reported green off a completion
 * notification while the suite inside it was red. The exit code was right the
 * whole time — `npm run test` exits 1 and the `&&` chain stopped — so nothing
 * was broken in the mechanism. What was broken is that a failed run and a
 * passing one END THE SAME WAY: a chain stops at the failing step, so the tail
 * is test output either way and nothing states the verdict. A verdict you have
 * to remember to ask for is one that gets skipped.
 *
 * So the contract under test is not "does it exit non-zero" — it is **the last
 * line says which**, and there is nothing after it. That is what a tail, a
 * truncated log or a glance actually lands on.
 *
 * THE SPAWNER IS INJECTED, so these cases run in milliseconds rather than
 * shelling out to a five-minute gate. What they cannot prove is that the real
 * run behaves the same, which is why the commit also breaks a real test and
 * shows the real banner.
 */

type Step = { name: string; script: string };

/** A fake runner: every script in `failing` exits 1, everything else 0. */
function spawner(failing: string[] = []) {
  const ran: string[] = [];
  const run = async (step: Step) => {
    ran.push(step.script);
    return failing.includes(step.script) ? 1 : 0;
  };
  return { run, ran };
}

function capture() {
  const lines: string[] = [];
  return { log: (line: string) => lines.push(line), lines };
}

const THREE: Step[] = [
  { name: "first", script: "one" },
  { name: "second", script: "two" },
  { name: "third", script: "three" },
];

describe("the verdict is the last line", () => {
  it("ends a failed run with VERIFY FAILED, naming the step", async () => {
    const { run } = spawner(["two"]);
    const out = capture();

    const result = await runSteps(THREE, run, out.log);

    expect(result.code).toBe(1);
    // The LAST line, not merely somewhere in the output. Anything printed after
    // a verdict is a chance to read the wrong thing.
    expect(out.lines[out.lines.length - 1]).toBe(
      "VERIFY FAILED — second (npm run two) exited 1",
    );
  });

  it("ends a clean run with VERIFY PASSED", async () => {
    const { run } = spawner();
    const out = capture();

    const result = await runSteps(THREE, run, out.log);

    expect(result.code).toBe(0);
    expect(out.lines[out.lines.length - 1]).toMatch(/^VERIFY PASSED — 3 steps in /);
  });

  it("never prints both verdicts", async () => {
    const { run } = spawner(["three"]);
    const out = capture();
    await runSteps(THREE, run, out.log);

    const verdicts = out.lines.filter((l) => l.startsWith("VERIFY "));
    expect(verdicts).toHaveLength(1);
  });

  it("carries the failing step's own exit code, not a flat 1", async () => {
    const out = capture();
    const result = await runSteps(
      [{ name: "only", script: "one" }],
      async () => 2,
      out.log,
    );

    // `check:deployed` exits 2 for "could not reach the site", which is a
    // different fact from "the check failed". Flattening every code to 1 would
    // lose that the moment such a step joins the list.
    expect(result.code).toBe(2);
  });
});

describe("fail-fast, and a step that never ran says so", () => {
  it("stops at the first failure", async () => {
    const { run, ran } = spawner(["two"]);
    await runSteps(THREE, run, capture().log);

    expect(ran).toEqual(["one", "two"]);
  });

  it("prints 'not run' rather than leaving the rest blank", async () => {
    const out = capture();
    await runSteps(THREE, spawner(["two"]).run, out.log);

    // "not run" and "passed" must not look the same — that is the same rule as
    // a default never reading as a measurement, one level up.
    const third = out.lines.find((l) => l.endsWith("third"));
    expect(third).toMatch(/^\s+--\s+third$/);
    expect(third).not.toMatch(/ok/);
  });
});

describe("the step list is the only copy", () => {
  it("names only scripts package.json defines", () => {
    // The check that catches a rename. It reads package.json rather than a
    // second list, so the two cannot drift.
    expect(unknownSteps(STEPS, definedScripts())).toEqual([]);
  });

  it("refuses a step whose script does not exist", () => {
    expect(
      unknownSteps([{ name: "typo", script: "check:mesages" }], definedScripts()),
    ).toEqual(["check:mesages"]);
  });

  it("still runs the checks CI runs", () => {
    /*
     * `verify` and `.github/workflows/ci.yml` were different sets and neither
     * was a superset: CI ran `check:transitions` and `check:blockers` and this
     * did not. `check:transitions` is the one that mattered — it is what stops
     * the TypeScript and SQL booking status machines disagreeing, and it had
     * never run locally while CLAUDE.md treated verify as THE gate.
     */
    const scripts = STEPS.map((s: Step) => s.script);
    for (const required of [
      "lint",
      "typecheck",
      "check:messages",
      "check:keys",
      "check:transitions",
      "test",
      "check:blockers",
      "build",
      "check:paint",
      "check:flows",
    ]) {
      expect(scripts, `verify no longer runs ${required}`).toContain(required);
    }
  });

  it("runs the tests before the build, so a red suite is not buried", () => {
    const scripts = STEPS.map((s: Step) => s.script);
    expect(scripts.indexOf("test")).toBeLessThan(scripts.indexOf("build"));
  });
});
