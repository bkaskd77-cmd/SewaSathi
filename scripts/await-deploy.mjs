#!/usr/bin/env node
/**
 * Wait until the production alias is serving THIS commit, then let the checks run.
 *
 * WHY THIS EXISTS. The two post-deploy checks used to run on
 * `deployment_status`, in a workflow of their own
 * (`.github/workflows/after-deploy.yml`, which is still there as the BACKSTOP
 * for deployments CI did not trigger) — the event Vercel's git integration
 * emits. A push no longer deploys this project, because the ignore
 * gate correctly skips a commit GitHub has not reported a check for yet, so the
 * deploy that serves is the one CI asks for through a deploy hook.
 *
 * THE FIRST VERSION OF THIS COMMENT SAID A HOOK DEPLOYMENT EMITS NO SUCH EVENT,
 * AND THAT WAS WRONG. It emits one about five or six minutes after the push:
 * `a34478a`'s record appeared at 14:51:55 against a 14:46:03 commit and its run
 * passed, as `ba949cd`'s had. I read the deployments list inside that window,
 * found nothing, and generalised from a gap that was a delay. Left here rather
 * than quietly corrected, because this script was written on the strength of it.
 *
 * WHAT SURVIVES, AND IT IS ENOUGH. The event is late and its timing is
 * Vercel's, so a push-and-walk-away leaves minutes in which nothing has
 * checked; and it fires per deployment, so a superseded build correctly gets
 * nothing while a commit CI deployed gets a walk attributed to a run nobody was
 * watching. CI has just asked for the deploy and knows the commit; the alias
 * says which commit it serves. So poll that one header until the two agree and
 * run the checks in the same job, at a known moment, failing the run that
 * caused the deploy. Both checks read public URLs and need no credential, which
 * is what makes running them there possible at all.
 *
 * EXIT CODES, matching `check:deployed`'s contract so a caller can tell the three
 * apart:
 *   0  the alias is serving this commit
 *   1  it is serving a DIFFERENT commit and the deadline passed — a finding
 *   2  could not look at all (blocked, no network, no stamp in the page)
 *
 * The 1/2 split is the whole point. "Production is serving last week's build" is
 * a fault; "this sandbox cannot reach *.vercel.app" is not, and reporting them
 * the same way is how a check stops being read.
 */
import process from "node:process";
import { execSync } from "node:child_process";

const DEFAULT_ORIGIN = "https://sewasathi.vercel.app";

/** Long enough for a cold Next build on Hobby, short enough to notice. */
const DEADLINE_MS = 8 * 60_000;
const EVERY_MS = 15_000;

function wanted() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.trim();
  return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
}

/**
 * The `<meta name="x-build-commit">` the layout renders, or null.
 *
 * EXPORTED, AND THE MAIN LOOP IS GUARDED BELOW, so a test can reach this
 * without running the poller — `column-manifest.mjs`'s arrangement. This script
 * runs on one branch in one job, so between one production push and the next
 * nothing else exercises it at all; `tests/unit/await-deploy.test.ts` is what
 * says the parse still works and that 1 and 2 still mean different things.
 */
export function stamp(html) {
  const match = html.match(
    /<meta\s+name="x-build-commit"\s+content="([^"]*)"/i,
  );
  return match ? match[1].trim() : null;
}

/** What the three exit codes mean. Named so no caller has to remember. */
export const LANDED = 0;
export const STALE = 1;
export const COULD_NOT_LOOK = 2;

/**
 * Which code a finished wait should exit with.
 *
 * SEPARATED FROM THE LOOP so the one distinction that matters is testable
 * without a network. "Production is serving last week's build" is a finding and
 * "this sandbox cannot reach *.vercel.app" is not, and a check that reported
 * them the same way would be the `/api/health` 503 story again — one state
 * nobody can act on, swallowing every state somebody could.
 */
export function verdict({ reached, serving, commit }) {
  if (!reached || serving === null) return COULD_NOT_LOOK;
  return serving === commit ? LANDED : STALE;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

async function main() {
const origin = (process.argv[2] || process.env.DEPLOY_URL || DEFAULT_ORIGIN)
  .trim()
  .replace(/\/$/, "");
const commit = wanted();
const until = Date.now() + DEADLINE_MS;

console.log(`\nWaiting for ${origin} to serve ${commit.slice(0, 7)}`);

let reached = false;
let serving = null;

while (Date.now() < until) {
  try {
    const response = await fetch(`${origin}/`, {
      headers: { "cache-control": "no-cache" },
      redirect: "follow",
    });
    const html = await response.text();
    reached = true;
    serving = stamp(html);

    if (serving && serving === commit) {
      console.log(`  serving ${serving.slice(0, 7)} — the deploy has landed.\n`);
      process.exit(LANDED);
    }

    console.log(
      `  serving ${serving ? serving.slice(0, 7) : "no stamp"} — not yet.`,
    );
  } catch (error) {
    console.log(`  could not reach it — ${error.message}`);
  }

  await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
}

/*
 * NEVER REACHED AT ALL, OR REACHED AND NO STAMP: that is "could not look", and
 * it is a 2 so a sandbox and a stale production are not the same red tick. A
 * build predating the stamp is the same class — there is nothing to compare.
 */
const code = verdict({ reached, serving, commit });

if (code === COULD_NOT_LOOK) {
  console.error(
    `\n  Could not establish which commit ${origin} is serving.\n` +
      `  This is NOT a pass and NOT a failure of the site. In an agent sandbox,\n` +
      `  outbound HTTPS to *.vercel.app is blocked by policy; run it elsewhere.\n`,
  );
} else {
  console.error(
    `\n  ${origin} is still serving ${serving.slice(0, 7)} after ` +
      `${DEADLINE_MS / 60_000} minutes, not ${commit.slice(0, 7)}.\n` +
      `  The deploy did not land. Check the ignore gate's log on the deployment:\n` +
      `  it says BUILD or SKIP and why.\n`,
  );
}

process.exit(code);
}
