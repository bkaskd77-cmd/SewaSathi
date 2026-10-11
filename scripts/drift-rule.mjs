/**
 * What a `/api/health` payload means for schema drift, as a pure function.
 *
 * ITS OWN MODULE FOR THE REASON `deployed-routes.mjs` IS ONE: a judgement that
 * lives inside a script's `main()` cannot be imported by a test without running
 * the script, and a rule nothing can reach is a rule that quietly stops biting.
 * `scripts/check-drift.mjs` is the runner; this is the decision.
 */
export const DRIFT_CHECK = "db.functions";
const CHECK = DRIFT_CHECK;

/**
 * What a payload means, as a pure function so it can be self-tested.
 *
 * Returns the exit code and the sentence. A judgement inside the fetch is a
 * judgement no run can check, which is the mistake this repository has paid
 * for four times.
 */
export function judgeDrift(payload) {
  if (!payload || !Array.isArray(payload.checks)) {
    return { code: 2, message: "The response carried no checks array." };
  }

  const check = payload.checks.find((c) => c && c.name === CHECK);
  if (!check) {
    /*
     * A DEPLOYMENT THAT DOES NOT REPORT IT IS A FAILURE, NOT A SKIP. The check
     * is unconditional in the route, so its absence means an older build is
     * live or somebody removed it — and "the drift check is gone" is exactly
     * the thing a drift gate must not shrug at.
     */
    return { code: 1, message: `No ${CHECK} check in the payload.` };
  }

  if (check.state === "ok") return { code: 0, message: check.detail };

  /*
   * `unknown` is "nobody looked" — no service role key on the deployment — and
   * it exits 2 with the rest of the could-not-look cases rather than passing.
   */
  if (check.state === "unknown") return { code: 2, message: check.detail };

  return { code: 1, message: check.detail };
}


/**
 * The rule proven to still bite, over the six payloads that matter.
 *
 * Exported so the script runs it before every request and the unit test runs it
 * too — a self-test only the script performs is one that stops being performed
 * the day the script stops being run, and this one runs in neither CI nor the
 * sandbox on its own.
 */
export const DRIFT_SELF_TEST = [
  [{ checks: [{ name: CHECK, state: "ok", detail: "all match" }] }, 0],
  [{ checks: [{ name: CHECK, state: "down", detail: "1 differs" }] }, 1],
  [{ checks: [{ name: CHECK, state: "unknown", detail: "no key" }] }, 2],
  [{ checks: [{ name: "db", state: "ok", detail: "" }] }, 1],
  [{}, 2],
  [null, 2],
];

export function driftRuleProblems() {
  const problems = [];
  for (const [payload, want] of DRIFT_SELF_TEST) {
    const got = judgeDrift(payload).code;
    if (got !== want) {
      problems.push(
        `expected ${want}, got ${got} for ${JSON.stringify(payload)}`,
      );
    }
  }
  return problems;
}
