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
 * FAIL-CLOSED, WITH TWO DELIBERATE EXCEPTIONS. No token, no checks reported yet, or an
 * API that will not answer all mean "we cannot show CI passed", and the deploy is
 * skipped — a deploy nobody has verified is the thing this is for. The exceptions are
 * `VERCEL_ENV !== "production"`, because a preview is how somebody looks at a branch whose
 * CI is still running and gating that would make the tool useless for the case it helps
 * most; and `DEPLOY_GATE_OVERRIDE`, which is the way out of the deadlock this gate can
 * create — see `parseOverride` and `docs/RUNBOOK.md`.
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
 * CHECKS THAT MAY BE RED WITHOUT STOPPING A DEPLOY, in two sets because the two reasons
 * are not the same reason and collapsing them is how the second one went unnoticed.
 *
 * A NAMED SET, SO BLOCKING IS THE DEFAULT. A pattern would quietly exempt a future check
 * whose name happened to match, and the one direction this must not fail in is "waved
 * something through". Every waved-past job's conclusion is printed on the way past,
 * because a vulnerable dependency deploying silently is its own kind of wrong.
 */

/*
 * CANNOT PASS, WHATEVER THIS COMMIT IS. `.github/workflows/ci.yml` puts the dependency
 * advisories in a job of their own precisely so a check that CANNOT pass is unable to
 * silence the checks that can. On 2026-09-10 a CRITICAL advisory landed in Next 14 that
 * only the Next 16 major upgrade could fix, and for nine days every other check went
 * unrun. Letting that same red job also freeze production would put the incident back
 * with a worse blast radius — nothing would ship for nine days either, and an advisory
 * nobody can act on is not a statement about whether this commit is good.
 */
export const CANNOT_PASS = new Set(["advisories"]);

/*
 * ABOUT A DEPLOYMENT RATHER THAN ABOUT THE COMMIT, which is the structural exemption and
 * the one this gate got wrong. These three can only be answered once something is
 * serving, so counting them asks whether a commit has already deployed before allowing it
 * to deploy.
 *
 * `deploy` IS THE DEPLOY. That job POSTs the hook that starts the build this script is
 * deciding about. It is also still running at the moment Vercel evaluates this, which
 * alone would skip every build for ever, and it goes red when no deploy hook is
 * configured — a fact about this repository's settings rather than about the commit.
 *
 * `fingerprints` AND `deployed` ARE `after-deploy.yml`, AND THEY LOCKED PRODUCTION ON
 * 2026-10-17. `HEALTH_SECRET` was added in Vercel at 11:02; the deployment answering had
 * been built at 09:46 and had never seen it, so `check:drift` could not read the detailed
 * payload and `fingerprints` went red at 09:47:20. From then on this gate counted that red
 * tick and SKIPped every build of `d6899c4` — including the build that would have carried
 * the variable. **The failing check was preventing the deployment that would have fixed
 * it**, and it took a dummy commit to get out.
 *
 * SO THE EXEMPTION IS NOT A CONVENIENCE EITHER. Both checks are facts about what the
 * ALIAS is serving, and a deploy is the remedy for both: blocking on "production is
 * serving an older build" refuses the only thing that could change the answer, and
 * blocking on drift freezes production WITH the drift still there. Neither is ever
 * silenced — `after-deploy.yml` fails its own run, the nightly dispatch sweep fails on
 * drift, and CI's `deploy` job runs both against the commit it just deployed. What is
 * given up is only their power to veto a future deploy, which they never had any
 * business holding.
 */
export const ABOUT_A_DEPLOYMENT = new Set(["deploy", "fingerprints", "deployed"]);

/** The one set the decision reads. */
export const NON_BLOCKING = new Set([...CANNOT_PASS, ...ABOUT_A_DEPLOYMENT]);

/** `neutral` and `skipped` are passes: a job that had nothing to do did not fail. */
const PASSED = ["success", "neutral", "skipped"];

/**
 * THE RECOVERY PATH, AND THE ONLY ONE. A red check that only a deploy can clear is a
 * deadlock this gate creates by being correct, and the two exits from it are both bad:
 * a dummy commit (which is what was used on 2026-10-17 — a commit whose whole content was
 * "let the gate open", in the history for ever) or turning the gate off (which is the
 * outage it exists to prevent, with nothing saying so).
 *
 * `DEPLOY_GATE_OVERRIDE` is the third. It is a Vercel project environment variable, so it
 * takes effect on the next build with NO NEW COMMIT — the ignore command reads the
 * environment at build time, which is the same property that makes a config fix need a
 * build in the first place. Set it, press Redeploy or fire the hook, remove it.
 *
 * FOUR THINGS KEEP IT FAIL-CLOSED, and each is a refusal a wildcard would not have.
 *
 * 1. IT NAMES THE COMMIT. `<sha-prefix>:<checks>`, prefix at least 7 characters, and it
 *    forgives nothing unless that prefix is this commit's. So it expires structurally:
 *    the next push is a different sha and the override is inert, which is stronger than a
 *    date because nobody has to remember to take it out.
 * 2. IT NAMES THE CHECKS. A failure nobody named still skips, and the message says which.
 *    "Let this commit through" is not expressible; "let `fingerprints` through on this
 *    commit" is. That is the difference between a recovery path and an off switch.
 * 3. NO WILDCARD, the `ACKNOWLEDGED_FAILURES` rule one system over: `*`, `all` and `any`
 *    are refused by name, because a blanket override is the state the gate was in by
 *    accident before it existed.
 * 4. IT FORGIVES A VERDICT, NEVER AN ABSENCE. A check still running, or one that never
 *    reported, skips exactly as before — rule 6's shape for a gate. Otherwise "CI has not
 *    started yet" would become deployable, which is the four-cancelled-commits outage
 *    with a variable set.
 *
 * It is printed in full on the way past, including when it applies to nothing, because an
 * override that silently matched no commit reads exactly like a gate that opened on its
 * own.
 */
const NO_WILDCARDS = new Set(["*", "all", "any", "everything"]);

export function parseOverride(raw, sha = "") {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const colon = text.indexOf(":");
  if (colon < 0) {
    return { ok: false, reason: `DEPLOY_GATE_OVERRIDE must read <sha>:<check>[,<check>]; got "${text}".` };
  }

  const prefix = text.slice(0, colon).trim().toLowerCase();
  const checks = text
    .slice(colon + 1)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (prefix.length < 7) {
    return { ok: false, reason: `DEPLOY_GATE_OVERRIDE needs at least 7 characters of a commit sha; got "${prefix}".` };
  }
  if (checks.length === 0) {
    return { ok: false, reason: "DEPLOY_GATE_OVERRIDE named no checks, so it forgives nothing." };
  }
  const wild = checks.find((name) => NO_WILDCARDS.has(name.toLowerCase()));
  if (wild) {
    return { ok: false, reason: `DEPLOY_GATE_OVERRIDE refuses "${wild}" — name every check you mean to forgive.` };
  }
  if (!sha.toLowerCase().startsWith(prefix)) {
    return {
      ok: false,
      reason: `DEPLOY_GATE_OVERRIDE names ${prefix}, this commit is ${sha.slice(0, 7) || "unknown"} — forgiving nothing.`,
    };
  }

  return { ok: true, checks };
}

/**
 * The whole decision, as a pure function of what GitHub reported.
 *
 * SEPARATED FROM THE I/O SO IT CAN BE TESTED AT ALL. This script runs in neither CI nor
 * the sandbox — it runs once, inside a Vercel build, and its only output is a line in a
 * log nobody reads unless something is already wrong. That is the same position
 * `check-deployed.mjs` is in, and the same answer: the rules are exercised by
 * `tests/unit/deploy-gate.test.ts` so a change to them fails somewhere a person looks.
 */
export function decideFromRuns(runs, sha = "", overrideRaw = "") {
  const short = sha.slice(0, 7) || "this commit";
  const override = parseOverride(overrideRaw, sha);
  const overrideNote = override && !override.ok ? ` (${override.reason})` : "";

  /*
   * Vercel's own check is excluded: it is the deployment this script is deciding about,
   * so counting it would be asking whether the build we have not started has passed.
   */
  const reported = runs.filter((run) => !/vercel/i.test(run.name ?? ""));
  const ours = reported.filter((run) => !NON_BLOCKING.has(run.name ?? ""));
  const waved = reported.filter((run) => NON_BLOCKING.has(run.name ?? ""));

  if (ours.length === 0) {
    return { code: SKIP, message: `No checks reported on ${short} yet.${overrideNote}` };
  }

  /* Before the override, deliberately: it forgives a verdict and never a missing one. */
  const unfinished = ours.filter((run) => run.status !== "completed");
  if (unfinished.length > 0) {
    return {
      code: SKIP,
      message: `Still running: ${unfinished.map((r) => r.name).join(", ")}.${overrideNote}`,
    };
  }

  const failed = ours.filter((run) => !PASSED.includes(run.conclusion));
  const forgiven = override?.ok
    ? failed.filter((run) => override.checks.includes(run.name ?? ""))
    : [];
  const blocking = failed.filter((run) => !forgiven.includes(run));

  if (blocking.length > 0) {
    return {
      code: SKIP,
      message: `CI is not green: ${blocking
        .map((r) => `${r.name} (${r.conclusion})`)
        .join(", ")}.${overrideNote}${
        forgiven.length
          ? ` DEPLOY_GATE_OVERRIDE forgave ${forgiven.map((r) => r.name).join(", ")} and does not cover these.`
          : ""
      }`,
    };
  }

  const noted = waved
    .filter((run) => !PASSED.includes(run.conclusion))
    .map((run) => `${run.name} is ${run.conclusion} and does not block`);

  /* Named rather than counted. A count of "1 check" where two ran is true and reads as
     wrong, because the second one was waved past by the set above rather than missing. */
  const names = (list) => list.map((run) => run.name).join(", ") || "nothing";
  const tail = `${noted.length ? ` (${noted.join("; ")}.)` : ""}${overrideNote}`;

  /*
   * AN OVERRIDE NEVER REPORTS "CI GREEN", and the first draft of this did — it printed
   * `forgave verify (failure)` and `CI green … verify` in one line, which is the class of
   * sentence this repository records as worse than no sentence at all. Capitals and first,
   * because this is the one path to production that did not come from a green commit.
   */
  if (forgiven.length > 0) {
    return {
      code: BUILD,
      message: `OVERRIDDEN on ${short} — DEPLOY_GATE_OVERRIDE forgave ${forgiven
        .map((run) => `${run.name} (${run.conclusion})`)
        .join(", ")}; passed: ${names(
        ours.filter((run) => PASSED.includes(run.conclusion)),
      )}. Remove the variable once this build has landed.${tail}`,
    };
  }

  return {
    code: BUILD,
    message: `CI green on ${short} — ${names(ours)}.${tail}`,
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
  decide(decideFromRuns(runs, sha, process.env.DEPLOY_GATE_OVERRIDE));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
