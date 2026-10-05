#!/usr/bin/env node
/**
 * Vercel's "Ignored Build Step": refuse to deploy a commit whose CI is not green.
 *
 * WHY THIS EXISTS. The bundle budget used to run inside `next build`, so Vercel
 * enforced it on every deploy. Next 16 deleted the data it parsed, and the replacement
 * needs a browser that Vercel's builder does not have — so the budget, the paint check
 * and the booking-flow check all now live in CI only. Without something like this, a
 * push that fails every one of them still deploys to production, because Vercel builds
 * from the branch and never looks at GitHub's checks.
 *
 * A PUSH NO LONGER TRIGGERS THE PRODUCTION DEPLOY, AND THAT IS BECAUSE OF THIS SCRIPT.
 * Vercel starts building within seconds of a push and GitHub has not registered a single
 * check run by then, so the honest answer here is "nobody has shown this commit is good"
 * and the honest action is to skip. Four commits were pushed, all four went green in CI in
 * about three minutes, and all four production deployments read CANCELED — the gate
 * working exactly as written, and production frozen behind it with nothing anywhere
 * saying so. A skip looks like a success from every direction, which makes it the worst
 * shape of failure this repository has a rule about.
 * So `scripts/trigger-deploy.mjs` runs as the last step of CI and asks Vercel to deploy
 * once the checks exist and pass. This script stays as the floor under that: a hook called
 * at the wrong moment, or a deployment started any other way, still has to show green.
 *
 * HOW VERCEL USES IT. `ignoreCommand` in `vercel.json` (not a dashboard setting — there is
 * no "Ignored Build Step" field to find under Git). Vercel reads the EXIT CODE and
 * nothing else:
 *   exit 1  -> build (this is the confusing part of their contract, and it is theirs)
 *   exit 0  -> skip the build
 * It is free on every plan, Hobby included.
 *
 * FAIL-CLOSED, WITH ONE DELIBERATE EXCEPTION. No token, no checks reported yet, or an
 * API that will not answer all mean "we cannot show CI passed", and the deploy is
 * skipped — a deploy nobody has verified is the thing this is for. The exception is
 * `VERCEL_ENV !== "production"`: preview deployments build regardless, because a
 * preview is how somebody looks at a branch whose CI is still running, and gating that
 * would make the tool useless for the case it helps most.
 *
 * IT NEEDS NO CREDENTIAL, BECAUSE THIS REPOSITORY IS PUBLIC. GitHub answers
 * `/commits/{sha}/check-runs` unauthenticated for a public repo — verified against this
 * one — so the gate works with nothing configured but the Ignored Build Step itself.
 *
 * `GITHUB_TOKEN` IS STILL USED IF IT IS THERE, and the reason is the rate limit:
 * unauthenticated requests are 60 per hour per IP, and Vercel's builders share IPs. If
 * that ever bites, the symptom is a skipped production build whose log says `403` or
 * `429` — fail-closed, visible — and the fix is adding a fine-grained token with
 * Checks: read, with no change to this file. The repository going private has the same
 * symptom and the same fix.
 */
import process from "node:process";

const REPO = process.env.GITHUB_REPOSITORY || "bkaskd77-cmd/SewaSathi";

/** Vercel's contract, inverted on purpose. Named so no reader has to remember it. */
export const BUILD = 1;
export const SKIP = 0;

/*
 * CHECKS THAT MAY BE RED WITHOUT STOPPING A DEPLOY. One entry, and it is not a
 * convenience: `.github/workflows/ci.yml` puts the dependency advisories in a job of
 * their own precisely so a check that CANNOT pass is unable to silence the checks that
 * can. On 2026-09-10 a CRITICAL advisory landed in Next 14 that only the Next 16 major
 * upgrade could fix, and for nine days every other check went unrun. Letting that same
 * red job also freeze production would put the incident back with a worse blast radius —
 * nothing would ship for nine days either, and an advisory nobody can act on is not a
 * statement about whether this commit is good.
 *
 * A NAMED SET, SO BLOCKING IS THE DEFAULT. A pattern would quietly exempt a future check
 * whose name happened to match, and the one direction this must not fail in is "waved
 * something through". The advisory state is still printed on the way past, because a
 * vulnerable dependency deploying silently is its own kind of wrong.
 */
export const NON_BLOCKING = new Set(["advisories"]);

/** `neutral` and `skipped` are passes: a job that had nothing to do did not fail. */
const PASSED = ["success", "neutral", "skipped"];

/**
 * The whole decision, as a pure function of what GitHub reported.
 *
 * SEPARATED FROM THE I/O SO IT CAN BE TESTED AT ALL. This script runs in neither CI nor
 * the sandbox — it runs once, inside a Vercel build, and its only output is a line in a
 * log nobody reads unless something is already wrong. That is the same position
 * `check-deployed.mjs` is in, and the same answer: the rules are exercised by
 * `tests/unit/deploy-gate.test.ts` so a change to them fails somewhere a person looks.
 */
export function decideFromRuns(runs, sha = "") {
  const short = sha.slice(0, 7) || "this commit";

  /*
   * Vercel's own check is excluded: it is the deployment this script is deciding about,
   * so counting it would be asking whether the build we have not started has passed.
   */
  const reported = runs.filter((run) => !/vercel/i.test(run.name ?? ""));
  const ours = reported.filter((run) => !NON_BLOCKING.has(run.name ?? ""));
  const waved = reported.filter((run) => NON_BLOCKING.has(run.name ?? ""));

  if (ours.length === 0) {
    return { code: SKIP, message: `No checks reported on ${short} yet.` };
  }

  const unfinished = ours.filter((run) => run.status !== "completed");
  if (unfinished.length > 0) {
    return {
      code: SKIP,
      message: `Still running: ${unfinished.map((r) => r.name).join(", ")}.`,
    };
  }

  const failed = ours.filter((run) => !PASSED.includes(run.conclusion));
  if (failed.length > 0) {
    return {
      code: SKIP,
      message: `CI is not green: ${failed
        .map((r) => `${r.name} (${r.conclusion})`)
        .join(", ")}.`,
    };
  }

  const noted = waved
    .filter((run) => !PASSED.includes(run.conclusion))
    .map((run) => `${run.name} is ${run.conclusion} and does not block`);

  return {
    code: BUILD,
    /* Named rather than counted. A count of "1 check" where two ran is true and reads as
       wrong, because the second one was waved past by the set above rather than missing. */
    message: `CI green on ${short} — ${ours.map((run) => run.name).join(", ")}.${
      noted.length ? ` (${noted.join("; ")}.)` : ""
    }`,
  };
}

/** The 401/403/404/429 half, also pure, because each one needs a different remedy. */
export function decideFromResponse(status, sha = "") {
  const hint =
    status === 403 || status === 429
      ? " Rate limited — set a GITHUB_TOKEN with Checks: read on the Vercel project."
      : status === 404
        ? " Repository not readable without a token — is it private now?"
        : "";
  return {
    code: SKIP,
    message: `GitHub answered ${status} for ${sha.slice(0, 7) || "this commit"}.${hint}`,
  };
}

async function main() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const token = process.env.GITHUB_TOKEN;

  const decide = ({ code, message }) => {
    console.log(`${code === BUILD ? "BUILD" : "SKIP "} — ${message}`);
    process.exit(code);
  };

  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    decide({
      code: BUILD,
      message: `${process.env.VERCEL_ENV} deployment — previews are never gated.`,
    });
  }

  if (!sha) {
    decide({ code: SKIP, message: "No VERCEL_GIT_COMMIT_SHA, so there is no commit to check." });
  }

  const response = await fetch(
    `https://api.github.com/repos/${REPO}/commits/${sha}/check-runs?per_page=100`,
    {
      headers: {
        // Sent only if one happens to be configured — see the note above on the
        // unauthenticated rate limit. Absent is the ordinary case and works.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  ).catch((error) => {
    decide({ code: SKIP, message: `Could not reach GitHub: ${error.message}` });
  });

  if (!response.ok) decide(decideFromResponse(response.status, sha));

  const { check_runs: runs = [] } = await response.json();
  decide(decideFromRuns(runs, sha));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
