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
 * HOW VERCEL USES IT. Project Settings -> Git -> Ignored Build Step, set to
 * `node scripts/vercel-ignore-build.mjs`. Vercel reads the EXIT CODE and nothing else:
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
const SHA = process.env.VERCEL_GIT_COMMIT_SHA;
const TOKEN = process.env.GITHUB_TOKEN;

/** Vercel's contract, inverted on purpose. Named so no reader has to remember it. */
const BUILD = 1;
const SKIP = 0;

function decide(message, code) {
  console.log(`${code === BUILD ? "BUILD" : "SKIP "} — ${message}`);
  process.exit(code);
}

if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  decide(`${process.env.VERCEL_ENV} deployment — previews are never gated.`, BUILD);
}

if (!SHA) decide("No VERCEL_GIT_COMMIT_SHA, so there is no commit to check.", SKIP);

const response = await fetch(
  `https://api.github.com/repos/${REPO}/commits/${SHA}/check-runs?per_page=100`,
  {
    headers: {
      // Sent only if one happens to be configured — see the note above on the
      // unauthenticated rate limit. Absent is the ordinary case and works.
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  },
).catch((error) => {
  decide(`Could not reach GitHub: ${error.message}`, SKIP);
});

if (!response.ok) {
  const hint =
    response.status === 403 || response.status === 429
      ? " Rate limited — set a GITHUB_TOKEN with Checks: read on the Vercel project."
      : response.status === 404
        ? " Repository not readable without a token — is it private now?"
        : "";
  decide(`GitHub answered ${response.status} for ${SHA.slice(0, 7)}.${hint}`, SKIP);
}

const { check_runs: runs = [] } = await response.json();

/*
 * Vercel's own check is excluded: it is the deployment this script is deciding about,
 * so counting it would be asking whether the build we have not started has passed.
 */
const ours = runs.filter((run) => !/vercel/i.test(run.name ?? ""));

if (ours.length === 0) {
  decide(`No checks reported on ${SHA.slice(0, 7)} yet.`, SKIP);
}

const unfinished = ours.filter((run) => run.status !== "completed");
if (unfinished.length > 0) {
  decide(
    `Still running: ${unfinished.map((r) => r.name).join(", ")}. Re-deploy when CI finishes.`,
    SKIP,
  );
}

/*
 * `neutral` and `skipped` are passes — a job that correctly decided it had nothing to
 * do is not a failure. Everything else, including `cancelled` and `timed_out`, is a
 * refusal: nobody has shown this commit is good.
 */
const failed = ours.filter(
  (run) => !["success", "neutral", "skipped"].includes(run.conclusion),
);

if (failed.length > 0) {
  decide(
    `CI is not green: ${failed.map((r) => `${r.name} (${r.conclusion})`).join(", ")}.`,
    SKIP,
  );
}

decide(`CI green on ${SHA.slice(0, 7)} — ${ours.length} checks.`, BUILD);
