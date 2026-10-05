import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  BUILD,
  NON_BLOCKING,
  SKIP,
  decideFromResponse,
  decideFromRuns,
} from "../../scripts/vercel-ignore-build.mjs";

/**
 * The two scripts that decide whether anything reaches production.
 *
 * WHY THESE CASES EXIST AT ALL. Neither script runs in CI and neither runs in the sandbox:
 * the gate runs once inside a Vercel build, and the trigger runs on the production branch
 * only. Their whole output is a line in a log nobody opens unless something is already
 * wrong — which is exactly how the gate skipped four consecutive green commits without
 * anybody noticing production had stopped moving. `check-deployed.mjs` is in the same
 * position and got the same answer.
 */
describe("the deploy gate", () => {
  const SHA = "ac84b9b1c9014f7ec98bdc7a111c574b83d13983";

  /*
   * THE CASE THAT CAUSED THE OUTAGE. Vercel starts building seconds after a push, before
   * GitHub has registered one check run — so this is what the gate saw on all four
   * commits, and it is right to skip. The fix is not here; it is that CI triggers the
   * deploy instead of the push.
   */
  it("skips a commit with no checks reported yet", () => {
    expect(decideFromRuns([], SHA).code).toBe(SKIP);
    expect(decideFromRuns([], SHA).message).toContain("No checks reported");
  });

  it("skips while a check is still running", () => {
    const decision = decideFromRuns(
      [{ name: "verify", status: "in_progress", conclusion: null }],
      SHA,
    );
    expect(decision.code).toBe(SKIP);
    expect(decision.message).toContain("verify");
  });

  it("skips a commit whose checks failed", () => {
    const decision = decideFromRuns(
      [{ name: "verify", status: "completed", conclusion: "failure" }],
      SHA,
    );
    expect(decision.code).toBe(SKIP);
    expect(decision.message).toContain("failure");
  });

  it("builds a green commit", () => {
    const decision = decideFromRuns(
      [
        { name: "verify", status: "completed", conclusion: "success" },
        { name: "advisories", status: "completed", conclusion: "success" },
      ],
      SHA,
    );
    expect(decision.code).toBe(BUILD);
    expect(decision.message).toContain("verify");
  });

  /*
   * THE PAIR THAT MATTERS MOST, and nothing could have caught it before these cases.
   * `ci.yml` splits the advisories into their own job so a check that cannot pass is
   * unable to silence the checks that can — a CRITICAL advisory in Next 14, fixable only
   * by the Next 16 upgrade, left nine days of everything-else-unrun. If a red advisory
   * also froze production, that incident comes back with nothing shipping for nine days
   * on top of it. It must wave past; a red `verify` beside it must not.
   */
  it("builds when only the advisories are red, and says so", () => {
    const decision = decideFromRuns(
      [
        { name: "verify", status: "completed", conclusion: "success" },
        { name: "advisories", status: "completed", conclusion: "failure" },
      ],
      SHA,
    );
    expect(decision.code).toBe(BUILD);
    expect(decision.message).toContain("advisories is failure and does not block");
    // Named as the one check that had to pass, so the waved job is not mistaken for one.
    expect(decision.message).toContain("— verify.");
  });

  it("still skips when the advisories are red and verify is too", () => {
    expect(
      decideFromRuns(
        [
          { name: "verify", status: "completed", conclusion: "failure" },
          { name: "advisories", status: "completed", conclusion: "failure" },
        ],
        SHA,
      ).code,
    ).toBe(SKIP);
  });

  /*
   * BLOCKING IS THE DEFAULT. A pattern match would quietly exempt a future check whose
   * name happened to contain "advisor", and the one direction this must never fail in is
   * "waved something through".
   */
  it("waves past nothing but the one named job", () => {
    expect([...NON_BLOCKING]).toEqual(["advisories"]);

    const decision = decideFromRuns(
      [
        { name: "verify", status: "completed", conclusion: "success" },
        { name: "advisories-extra", status: "completed", conclusion: "failure" },
      ],
      SHA,
    );

    expect(decision.code).toBe(SKIP);
    /*
     * THE REASON, NOT JUST THE CODE. The first version of this case asserted only SKIP,
     * and a break-test rewriting the set as `/advisor/i` left it green: the near-named job
     * vanished from the blocking set, `ours` came back empty, and the answer was still SKIP
     * — for the wrong reason, and only because no other check was in the fixture. Asserting
     * that the job is NAMED as the failure is what distinguishes "blocked by it" from
     * "quietly exempted and then blocked by its absence".
     */
    expect(decision.message).toContain("advisories-extra (failure)");
  });

  /* Vercel's own check is the deployment being decided about, so it cannot be evidence. */
  it("ignores Vercel's own check run", () => {
    expect(
      decideFromRuns([{ name: "Vercel", status: "in_progress", conclusion: null }], SHA)
        .message,
    ).toContain("No checks reported");
  });

  /*
   * A 403 AND A 404 NEED DIFFERENT REMEDIES, so they do not collapse into one sentence.
   * Rate limiting wants a token; a 404 on a repository that used to answer means it went
   * private. Both skip — a deploy nobody has verified is the thing this prevents.
   */
  it("names the remedy for each refusal from GitHub", () => {
    expect(decideFromResponse(429, SHA).message).toContain("GITHUB_TOKEN");
    expect(decideFromResponse(404, SHA).message).toContain("private");
    expect(decideFromResponse(500, SHA).code).toBe(SKIP);
  });
});

/**
 * The other half: what asks Vercel to build once CI is green.
 *
 * SPAWNED RATHER THAN IMPORTED, because the behaviour worth asserting is the exit code —
 * a silent success here is production frozen behind a green tick, which is the state this
 * script exists to end.
 */
describe("the deploy trigger", () => {
  const run = (env: Record<string, string>) =>
    spawnSync("node", ["scripts/trigger-deploy.mjs"], {
      env: { ...process.env, VERCEL_DEPLOY_HOOK: "", ...env },
      encoding: "utf8",
    });

  it("does nothing on a branch that is not production", () => {
    const result = run({ GITHUB_REF_NAME: "some/other-branch" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to deploy");
  });

  /*
   * RED, NOT A WARNING. Warning and carrying on leaves a green tick beside a production
   * that stopped moving, which is precisely the failure that produced this script.
   */
  it("fails loudly on the production branch with no hook configured", () => {
    const result = run({
      GITHUB_REF_NAME: "claude/sewax-roadmap-foundation-e4byl9",
      GITHUB_SHA: "ac84b9b1c9014f7ec98bdc7a111c574b83d13983",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PRODUCTION DID NOT DEPLOY");
    expect(result.stderr).toContain("VERCEL_DEPLOY_HOOK");
    // The remedy, not just the symptom.
    expect(result.stderr).toContain("Deploy Hooks");
  });
});
