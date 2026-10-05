#!/usr/bin/env node
/**
 * Ask Vercel to deploy, from CI, once CI has passed.
 *
 * WHY THIS EXISTS, AND WHY THE GATE ALONE WAS NOT ENOUGH. `scripts/vercel-ignore-build.mjs`
 * refuses to build a commit whose CI is not green. It works — and on its own it refuses
 * EVERYTHING, because Vercel starts its build within seconds of the push and GitHub has
 * not registered a single check run by then. Four commits were pushed, all four green in
 * CI in about three minutes, and all four production deployments read `CANCELED`: the
 * gate said "No checks reported yet" every time and nobody re-deployed by hand. That is
 * `pushed is not deployed` with the gate as the cause, which is worse than the problem it
 * was added to solve, because a skip looks like a success from every direction.
 *
 * SO THE PUSH NO LONGER TRIGGERS THE DEPLOY — CI DOES. A Vercel deploy hook is a URL that
 * starts a production deployment of the branch's current head. Called from the last step
 * of the `verify` job, it fires when the checks exist and are green, and the gate then
 * finds them and builds. The gate stays: it is what makes a hook called at the wrong
 * moment, or a deployment started any other way, still refuse a red commit.
 *
 * IT FAILS LOUDLY WITH NO HOOK CONFIGURED, deliberately. The quiet alternative — warn and
 * carry on — leaves production frozen with a green tick beside it, which is the exact
 * state this script exists to end. A red `verify` on the production branch is the alarm,
 * and it is one repository secret away from green.
 *
 * SETUP, ONCE: Vercel -> Project -> Settings -> Git -> Deploy Hooks, create one on the
 * production branch, then GitHub -> Settings -> Secrets and variables -> Actions ->
 * `VERCEL_DEPLOY_HOOK`.
 */
import process from "node:process";

/**
 * The branch Vercel serves as production.
 *
 * WRITTEN ONCE, HERE. The workflow runs this step on every branch and this decides, so
 * the branch name is not also a condition in the YAML — two copies of it would agree
 * until somebody renamed the branch in one of them, and the failure would be silent in
 * the direction that matters.
 */
const PRODUCTION_BRANCH = "claude/sewax-roadmap-foundation-e4byl9";

const branch =
  process.env.GITHUB_REF_NAME || process.env.VERCEL_GIT_COMMIT_REF || "";
const sha = (process.env.GITHUB_SHA || "").slice(0, 7);
const hook = process.env.VERCEL_DEPLOY_HOOK;

if (branch !== PRODUCTION_BRANCH) {
  console.log(`Not the production branch (${branch || "unknown"}) — nothing to deploy.`);
  process.exit(0);
}

if (!hook) {
  console.error(
    [
      `PRODUCTION DID NOT DEPLOY. ${sha || "This commit"} passed CI and nothing asked`,
      "Vercel to build it, because VERCEL_DEPLOY_HOOK is not set on this repository.",
      "",
      "A push alone cannot deploy any more: Vercel builds before GitHub has reported a",
      "single check, so scripts/vercel-ignore-build.mjs correctly skips it. CI is what",
      "triggers the deploy now, and it needs the hook.",
      "",
      "  1. Vercel -> Project -> Settings -> Git -> Deploy Hooks -> create one on",
      `     ${PRODUCTION_BRANCH}, and copy the URL.`,
      "  2. GitHub -> Settings -> Secrets and variables -> Actions -> New repository",
      "     secret -> VERCEL_DEPLOY_HOOK.",
      "",
      "This step is red rather than a warning on purpose: a green tick beside a frozen",
      "production is the failure it exists to prevent.",
    ].join("\n"),
  );
  process.exit(1);
}

const response = await fetch(hook, { method: "POST" }).catch((error) => {
  console.error(`Could not reach the deploy hook: ${error.message}`);
  process.exit(1);
});

if (!response.ok) {
  console.error(
    `The deploy hook answered ${response.status}. A 404 usually means it was deleted in Vercel; recreate it and update the secret.`,
  );
  process.exit(1);
}

/*
 * The hook answers with the deployment it created. Printed because the next question
 * anybody asks is "did it actually build", and the id is what answers it — the gate's own
 * verdict is in that deployment's log.
 */
const body = await response.json().catch(() => null);
const id = body?.job?.id ?? body?.id ?? "created";
console.log(`Asked Vercel to deploy ${sha} on ${PRODUCTION_BRANCH} — ${id}.`);
console.log(
  "The ignore step decides from there: its log says BUILD or SKIP and why.",
);
