import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  ABOUT_A_DEPLOYMENT,
  BUILD,
  CANNOT_PASS,
  NON_BLOCKING,
  SKIP,
  decideFromResponse,
  decideFromRuns,
  parseOverride,
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
   * A RED ADVISORIES JOB NOW STOPS THE DEPLOY, AND THIS CASE USED TO ASSERT THE
   * OPPOSITE. It read "builds when only the advisories are red, and says so", for a
   * reason that was sound when it was written: `ci.yml` splits the advisories into a job
   * of their own so a check that CANNOT pass is unable to silence the ones that can, and
   * a critical Next 14 advisory fixable only by the Next 16 major upgrade had already
   * left nine days of everything-else-unrun. Freezing production on top of that would
   * have been the same incident with a worse blast radius.
   *
   * WHAT CHANGED IS THAT THE JOB CAN PASS AGAIN. `ACCEPTED` went empty with the Next 16
   * upgrade, and `check-advisories.mjs` does not fail on a DECIDED advisory — it prints
   * it as `known` and exits 0. So red no longer means "nobody can fix this"; it means
   * nobody has decided, which is a statement about whether this commit is safe to ship.
   *
   * AND THE OLD BEHAVIOUR WAS MEASURED COSTING SOMETHING ON 2026-10-22: run 341's
   * advisories job failed on a critical unauthenticated RCE in the Next image optimiser
   * (GHSA-2464-fhr4-w9xw, CVSS 9.5), this gate waved it past, and the build deployed.
   *
   * THE ESCAPE FOR AN UNFIXABLE ADVISORY IS `ACCEPTED` PLUS A LAUNCH-BLOCKERS ENTRY,
   * which is a decision somebody wrote down rather than a blanket exemption nobody had
   * to justify per advisory.
   */
  it("skips when the advisories are red, even with everything else green", () => {
    const decision = decideFromRuns(
      [
        { name: "verify", status: "completed", conclusion: "success" },
        { name: "advisories", status: "completed", conclusion: "failure" },
      ],
      SHA,
    );
    expect(decision.code).toBe(SKIP);
    expect(decision.message).toContain("advisories");
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
  /*
   * `deploy` IS WAVED PAST FOR A DIFFERENT REASON FROM `advisories`, and it is the
   * structural one: that job POSTs the hook that starts the very build this gate decides
   * about, so counting it asks whether a commit deployed before letting it deploy. It is
   * also still in progress when Vercel evaluates the gate — on its own that would skip
   * every build for ever, which is the outage this whole arrangement exists to end.
   */
  it("builds while the deploy job that triggered it is still running", () => {
    const decision = decideFromRuns(
      [
        { name: "verify", status: "completed", conclusion: "success" },
        { name: "deploy", status: "in_progress", conclusion: null },
      ],
      SHA,
    );
    expect(decision.code).toBe(BUILD);
  });

  it("waves past nothing but the named jobs", () => {
    /*
     * PINNED AS TWO SETS, because the reasons are not interchangeable: one was about a
     * check that could not pass whatever the commit was, and the other three are answers
     * about a deployment. A single list would let the next reader move a name between
     * them without noticing that it also changes the argument for exempting it.
     *
     * `CANNOT_PASS` IS EMPTY AND IS ASSERTED EMPTY. It held `advisories` and no longer
     * does — see the case above for why, and why the set survives its own emptiness: the
     * argument for it is the kind that gets re-made under pressure, so the name leaving
     * has to be visible rather than silent.
     */
    expect([...CANNOT_PASS]).toEqual([]);
    expect([...ABOUT_A_DEPLOYMENT]).toEqual(["deploy", "fingerprints", "deployed"]);
    expect([...NON_BLOCKING]).toEqual(["deploy", "fingerprints", "deployed"]);

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
   * THE DEADLOCK, AS IT ACTUALLY HAPPENED ON 2026-10-17, and the case that would have
   * caught it. `fingerprints` is `after-deploy.yml`'s drift check; it went red because the
   * serving deployment had no `HEALTH_SECRET`, which only a NEW BUILD can give it — and
   * this gate then refused every build of that commit, the fixing one included. A dummy
   * commit was what got production moving again.
   *
   * ASSERTED ON THE EXACT FIXTURE THE LIVE COMMIT PRESENTED, conclusions and all, rather
   * than on a one-check stand-in: `verify` green beside a red post-deploy check is the
   * whole shape, and a fixture without the green one would pass for the wrong reason.
   */
  it("builds although the post-deploy checks are red, which is the deadlock", () => {
    const decision = decideFromRuns(
      [
        { name: "verify", status: "completed", conclusion: "success" },
        { name: "advisories", status: "completed", conclusion: "success" },
        { name: "deploy", status: "completed", conclusion: "failure" },
        { name: "fingerprints", status: "completed", conclusion: "failure" },
        { name: "deployed", status: "completed", conclusion: "success" },
      ],
      SHA,
    );

    expect(decision.code).toBe(BUILD);
    /* Loud, not silent: a red drift tick deploying without a word is its own fault. */
    expect(decision.message).toContain("fingerprints is failure and does not block");
    /* And the checks that had to pass are named. `advisories` is among them now that it
       is no longer waved past, which is what makes the green one in this fixture
       load-bearing rather than decoration. */
    expect(decision.message).toContain("advisories");
    expect(decision.message).toContain("verify");
  });

  it("still skips when a post-deploy check is red and verify is too", () => {
    expect(
      decideFromRuns(
        [
          { name: "verify", status: "completed", conclusion: "failure" },
          { name: "fingerprints", status: "completed", conclusion: "failure" },
        ],
        SHA,
      ).code,
    ).toBe(SKIP);
  });

  /*
   * THE RECOVERY PATH. The exemption above fixes the one deadlock that happened; this is
   * for the next one, where a check nobody exempted goes red for a reason only a deploy
   * can clear. The whole value is that it is narrower than a dummy commit, so every case
   * here is about what it REFUSES.
   */
  describe("DEPLOY_GATE_OVERRIDE", () => {
    const red = [
      { name: "verify", status: "completed", conclusion: "success" },
      { name: "secrets", status: "completed", conclusion: "failure" },
    ];

    it("lets a named check through on the commit it names", () => {
      const decision = decideFromRuns(red, SHA, `${SHA.slice(0, 10)}:secrets`);
      expect(decision.code).toBe(BUILD);
      expect(decision.message).toContain("OVERRIDDEN");
      expect(decision.message).toContain("secrets (failure)");
      /* The way out has to be on the screen, or the variable stays set for ever. */
      expect(decision.message).toContain("Remove the variable");
      /*
       * AND IT MUST NOT CLAIM THE COMMIT WAS GREEN. The first version printed "forgave
       * secrets (failure)" and "CI green — verify, secrets" in one line: a sentence
       * contradicting itself on the one line that records a deploy nobody signed off.
       */
      expect(decision.message).not.toContain("CI green");
      expect(decision.message).toContain("passed: verify");
    });

    it("forgives nothing on a different commit", () => {
      const decision = decideFromRuns(red, SHA, "0123456:secrets");
      expect(decision.code).toBe(SKIP);
      expect(decision.message).toContain("forgiving nothing");
    });

    it("forgives only the checks it names", () => {
      const decision = decideFromRuns(
        [...red, { name: "flows", status: "completed", conclusion: "failure" }],
        SHA,
        `${SHA.slice(0, 10)}:secrets`,
      );
      expect(decision.code).toBe(SKIP);
      expect(decision.message).toContain("flows (failure)");
      /* It says what it DID forgive, so a half-covered override is not read as inert. */
      expect(decision.message).toContain("does not cover these");
    });

    /*
     * THE ONE THAT MATTERS MOST. "Let this commit through" must not be expressible, because
     * that is the gate turned off with a green tick over it.
     */
    it("refuses a wildcard", () => {
      for (const wild of ["*", "all", "any", "everything"]) {
        const decision = decideFromRuns(red, SHA, `${SHA.slice(0, 10)}:${wild}`);
        expect(decision.code).toBe(SKIP);
        expect(decision.message).toContain("name every check");
      }
    });

    /*
     * IT FORGIVES A VERDICT, NEVER AN ABSENCE — rule 6's shape for a gate. Otherwise a
     * set variable would make "CI has not finished" deployable, which is the four
     * cancelled commits all over again.
     */
    it("cannot wave past a check that has not reported", () => {
      expect(
        decideFromRuns(
          [{ name: "verify", status: "in_progress", conclusion: null }],
          SHA,
          `${SHA.slice(0, 10)}:verify`,
        ).code,
      ).toBe(SKIP);

      expect(decideFromRuns([], SHA, `${SHA.slice(0, 10)}:verify`).code).toBe(SKIP);
    });

    it("refuses a sha prefix too short to identify a commit", () => {
      const decision = decideFromRuns(red, SHA, `${SHA.slice(0, 4)}:secrets`);
      expect(decision.code).toBe(SKIP);
      expect(decision.message).toContain("at least 7 characters");
    });

    /*
     * A MALFORMED VALUE IS SAID OUT LOUD AND FORGIVES NOTHING. Silence here is the worst
     * of both: somebody believes the override is in force, the build skips, and the log
     * reads exactly as it did before they set anything.
     */
    it("names a value it could not read, and still skips", () => {
      for (const bad of ["secrets", `${SHA.slice(0, 10)}:`, `${SHA.slice(0, 10)}: ,`]) {
        const decision = decideFromRuns(red, SHA, bad);
        expect(decision.code).toBe(SKIP);
        expect(decision.message).toContain("DEPLOY_GATE_OVERRIDE");
      }
    });

    it("is absent by default, and absence is not an error", () => {
      expect(parseOverride(undefined, SHA)).toBeNull();
      expect(parseOverride("   ", SHA)).toBeNull();
      expect(decideFromRuns(red, SHA).message).not.toContain("DEPLOY_GATE_OVERRIDE");
    });
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
