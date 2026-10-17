import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every invocation of `check:drift` carries the token it needs.
 *
 * WHY THIS EXISTS, AND IT IS NOT A HYPOTHETICAL. `db.functions` moved behind the bearer
 * token in `6f37399`, when the public `/api/health` answer became `{ ok, clean, commit }`.
 * Two workflow steps run `scripts/check-drift.mjs`; one was given `HEALTH_SECRET` in that
 * commit and the other was not. The forgotten one then exited 2 — "could not look" — on
 * every run from that commit onward, and because `vercel-ignore-build.mjs` was counting
 * its red tick, it froze production: the failing check was preventing the deployment that
 * would have fixed it.
 *
 * SO THE INVOCATION IS ONE THING WRITTEN TWICE, which is the shape this repository has a
 * rule about. A comment in either file would have gone as stale as the one that did; this
 * reads the workflows, so a third copy added tomorrow is covered the day it exists.
 *
 * IT ASSERTS COVERAGE, NOT A LIST. The failure mode being guarded is an invocation nobody
 * remembered, so a named set of files would have the same blind spot as the comment —
 * every file is scanned and every match must carry the variable.
 */
const WORKFLOWS = join(process.cwd(), ".github", "workflows");

/** One entry per step that runs the script, with the `env:` block above it. */
function driftInvocations(): { file: string; step: string }[] {
  const found: { file: string; step: string }[] = [];

  for (const file of readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");

    /*
     * Split on the step marker rather than parsing YAML. A step's `env:` sits above its
     * `run:` inside the same `- name:` block, so the block is the unit that has to be
     * checked — and a parser would make this test depend on a dependency the workflows
     * themselves do not have.
     */
    for (const block of text.split(/^\s*- (?:name|uses):/m)) {
      if (/check-drift\.mjs/.test(block)) found.push({ file, step: block });
    }
  }

  return found;
}

describe("check:drift is never run without its token", () => {
  /*
   * THE COUNT IS ASSERTED FIRST, because a regex that silently stopped matching would make
   * every case below pass over an empty list — `ACTIVITY_FLOOR`'s blind tests, one tool
   * over. Two today: `ci.yml`'s deploy job and `after-deploy.yml`'s backstop.
   */
  it("finds the invocations at all", () => {
    const found = driftInvocations();
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(new Set(found.map((f) => f.file))).toEqual(
      new Set(["ci.yml", "after-deploy.yml"]),
    );
  });

  it("passes HEALTH_SECRET to every one of them", () => {
    for (const { file, step } of driftInvocations()) {
      expect(step, `${file} runs check-drift.mjs without HEALTH_SECRET`).toMatch(
        /HEALTH_SECRET:\s*\$\{\{\s*secrets\.HEALTH_SECRET\s*\}\}/,
      );
    }
  });

  /*
   * AND NEVER `CRON_SECRET` FROM A WORKFLOW. The script still falls back to it so the
   * split can be migrated without breaking anything, but handing a GitHub Actions job the
   * token that also opens the sweep moving a professional's money is the blast radius the
   * separation exists to avoid. The fallback is for a deployment, not for CI.
   */
  it("hands no workflow the money token for a read-only payload", () => {
    for (const { file, step } of driftInvocations()) {
      expect(step, `${file} passes CRON_SECRET to a read-only check`).not.toMatch(
        /CRON_SECRET:\s*\$\{\{\s*secrets\./,
      );
    }
  });

  /*
   * THE OTHER HALF OF THE SAME LESSON. `after-deploy.yml`'s header said "NO SECRET" for
   * three commits after it stopped being true, which is what let the broken step read as
   * deliberate. A comment cannot be tested for truth, but this one can be tested for
   * having been revisited.
   */
  it("does not still claim the drift job needs no secret", () => {
    const text = readFileSync(join(WORKFLOWS, "after-deploy.yml"), "utf8");
    expect(text).not.toMatch(/^# NO SECRET\./m);
  });
});
