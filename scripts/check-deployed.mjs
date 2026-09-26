#!/usr/bin/env node
/**
 * Confirm the live site is actually serving the commit that was pushed.
 *
 * "Pushed" and "deployed" are not the same fact, and they diverged silently
 * once: four commits sat on the branch while production kept serving an older
 * build. Nothing in the repo could tell the difference, so it was caught by
 * reading the HTML by hand. This is that reading, automated.
 *
 * It answers five questions, in order of how much they matter:
 *
 *   1. Which commit is serving?  — from the <meta name="x-build-commit"> that
 *      app/[locale]/layout.tsx stamps into every page.
 *   2. Do the routes exist?      — a page that 404s is the loudest possible
 *      signal that a deploy did not land.
 *   3. Are the guarded ones guarded? — a signed-in screen answering 200 to
 *      nobody is an admin panel on the open internet. See `deployed-routes.mjs`
 *      for why an anonymous request can prove that and what it cannot prove.
 *   4. Is og:url the real host?  — the one thing that is wrong on a page that
 *      otherwise looks perfect.
 *   5. Is anything unchecked?    — a page that shipped without being added to a
 *      list gets no request made to it, and that looks exactly like success.
 *
 *   npm run check:deployed
 *   npm run check:deployed -- https://some-preview.vercel.app
 *   npm run check:deployed -- --self-test    (no network at all)
 *
 * THE RULES SELF-TEST ON EVERY RUN, before any request is made, so a checker
 * that has quietly stopped checking says so rather than printing a tick — the
 * same arrangement as `check:contacts` and `check:secrets`. That matters more
 * here than anywhere: this script cannot run in CI or in an agent sandbox, so
 * the only thing exercising its judgements between one human run and the next is
 * the self-test and `tests/unit/deploy-check.test.ts`.
 *
 * Note for anyone running this from an agent sandbox: outbound HTTPS to
 * *.vercel.app is blocked by the network policy there, so the walk can only be
 * run from a machine with real internet. It exits 2 (not 1) when it cannot reach
 * the site at all, so "unreachable" is never mistaken for "verified" — and the
 * self-test and the coverage pass still run, because neither needs a network.
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  GONE_ROUTES,
  GUARDED_ROUTES,
  LOCALE_PREFIXES,
  NOT_WALKABLE,
  OPEN_ROUTES,
  coverageGaps,
  cronPaths,
  judgeCron,
  judgeGone,
  judgeGuarded,
  judgeOpen,
} from "./deployed-routes.mjs";

const DEFAULT_ORIGIN = "https://sewasathi.vercel.app";
const TIMEOUT_MS = 20_000;
const PAGES_ROOT = "app/[locale]";

function localHead() {
  try {
    return execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function remoteHead() {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return execSync(`git rev-parse origin/${branch}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function get(url, method = "GET") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "sajilokaam-deploy-check" },
    });
    const body = method === "GET" ? await response.text() : "";
    return {
      status: response.status,
      location: response.headers.get("location"),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

function meta(html, name) {
  const pattern = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  return html.match(pattern)?.[1] ?? null;
}

function ogUrl(html) {
  return (
    html.match(
      /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']*)["']/i,
    )?.[1] ?? null
  );
}

function line(ok, label, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(30)} ${detail}`);
}

/** Every page file under the locale tree, repository-relative. */
function pageFiles(dir = PAGES_ROOT, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // A tree we cannot read is not a tree with nothing in it.
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) pageFiles(full, out);
    else if (/^page\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Proven by breaking it, not by passing once
 * ------------------------------------------------------------------ */

function selfTest() {
  const cases = [
    // [label, judgement, mustPass]
    [
      "a guarded route redirecting to its own login",
      () => judgeGuarded({ route: "/admin/signals", status: 307, location: "https://x.test/login?next=%2Fadmin%2Fsignals" }),
      true,
    ],
    [
      "a guarded Nepali route redirecting to the Nepali login",
      () => judgeGuarded({ route: "/admin/signals", prefix: "/ne", status: 307, location: "https://x.test/ne/login?next=%2Fne%2Fadmin%2Fsignals" }),
      true,
    ],
    [
      "an admin screen open to anybody",
      () => judgeGuarded({ route: "/admin/signals", status: 200 }),
      false,
    ],
    [
      "a guarded route that did not deploy",
      () => judgeGuarded({ route: "/admin/signals", status: 404 }),
      false,
    ],
    [
      "a Nepali reader dropped at the English login",
      () => judgeGuarded({ route: "/account", prefix: "/ne", status: 307, location: "https://x.test/login?next=%2Faccount" }),
      false,
    ],
    [
      "a redirect somewhere else entirely",
      () => judgeGuarded({ route: "/account", status: 307, location: "https://x.test/" }),
      false,
    ],
    [
      "a redirect with no Location to read",
      () => judgeGuarded({ route: "/account", status: 307, location: null }),
      false,
    ],
    ["an open route answering 200", () => judgeOpen({ route: "/", status: 200 }), true],
    ["an open route answering 404", () => judgeOpen({ route: "/", status: 404 }), false],
    ["a removed route staying removed", () => judgeGone({ route: "/careers", status: 404 }), true],
    ["a removed route still served", () => judgeGone({ route: "/careers", status: 200 }), false],
    [
      "a cron target refusing an unauthenticated caller",
      () => judgeCron({ path: "/api/payments/reconcile", status: 401 }),
      true,
    ],
    [
      "a cron firing into a 404 every night",
      () => judgeCron({ path: "/api/payments/reconcile", status: 404 }),
      false,
    ],
    [
      "a money sweep open to anybody",
      () => judgeCron({ path: "/api/payments/reconcile", status: 200 }),
      false,
    ],
  ];

  let bad = 0;
  for (const [label, run, mustPass] of cases) {
    const verdict = run();
    if (verdict.ok !== mustPass) {
      console.error(
        `  self-test FAILED — ${label}: judged ${verdict.ok ? "ok" : "a failure"}, expected the opposite`,
      );
      bad += 1;
    }
    // A failure with no sentence is a failure nobody can act on.
    if (!verdict.ok && !verdict.failure) {
      console.error(`  self-test FAILED — ${label}: no failure sentence`);
      bad += 1;
    }
  }

  // The cron paths have to come out of vercel.json, or the walk below checks
  // nothing while looking exactly as green as one that checked everything.
  const parsed = cronPaths(readFileSync("vercel.json", "utf8"));
  if (!parsed || parsed.length === 0) {
    console.error(
      "  self-test FAILED — no cron paths could be read from vercel.json",
    );
    bad += 1;
  }
  if (cronPaths("{ not json") !== null) {
    console.error(
      "  self-test FAILED — an unparseable vercel.json read as having no crons",
    );
    bad += 1;
  }

  // And the coverage rule itself must bite: a page nobody listed is a gap.
  const invented = coverageGaps(["app/[locale]/(admin)/admin/payouts/page.tsx"]);
  if (invented.length !== 1 || invented[0].route !== "/admin/payouts") {
    console.error(
      "  self-test FAILED — coverageGaps did not report an unlisted admin page",
    );
    bad += 1;
  }

  if (bad > 0) {
    console.error(`\nDeploy check: ${bad} self-test failure${bad === 1 ? "" : "s"}.\n`);
    process.exit(1);
  }
  console.log(
    `  self-test passed — ${cases.length} verdicts and the coverage rule still bite.`,
  );
}

/** Nothing here needs a network, so it runs even when the walk cannot. */
function coverage() {
  const files = pageFiles();
  const gaps = coverageGaps(files);
  line(
    gaps.length === 0,
    "every page is on a list",
    `${files.length} page files · ${NOT_WALKABLE.length} not walkable`,
  );
  if (gaps.length === 0) return [];
  return gaps.map(
    ({ route, file }) =>
      `${route} (${file}) is served in production and is on neither OPEN_ROUTES nor GUARDED_ROUTES in scripts/deployed-routes.mjs, so no request is ever made to it. Add it in the phase that shipped it.`,
  );
}

async function main() {
  const selfTestOnly = process.argv.includes("--self-test");
  const origin = (
    process.argv.slice(2).find((a) => !a.startsWith("--")) ||
    process.env.DEPLOY_URL ||
    DEFAULT_ORIGIN
  )
    .trim()
    .replace(/\/+$/, "");

  console.log(`\nDeploy check — ${selfTestOnly ? "rules only" : origin}`);

  console.log("\nRules");
  selfTest();

  console.log("\nCoverage");
  const coverageFailures = coverage();

  if (selfTestOnly) {
    if (coverageFailures.length > 0) {
      console.error("\nUnchecked pages:");
      for (const failure of coverageFailures) console.error(`  - ${failure}`);
      console.error("");
      process.exit(1);
    }
    console.log("\n  Rules and coverage only — the site was not contacted.\n");
    return;
  }

  let home;
  try {
    home = await get(`${origin}/`);
  } catch (error) {
    console.error(
      `\n  Could not reach ${origin}: ${error.message}\n\n` +
        `  This is NOT a pass and NOT a failure of the site — the walk could not run.\n` +
        `  If you are in an agent sandbox, outbound HTTPS to *.vercel.app is blocked by\n` +
        `  policy; run this from your own machine instead. The rules and coverage above\n` +
        `  did run, and needed no network.\n`,
    );
    process.exit(2);
  }

  // A blocked network does not refuse the connection — the agent sandbox's
  // proxy answers 403 to every request, which without this looked exactly like
  // "every route on the site is broken". A check that cannot tell "I could not
  // look" from "it is broken" is worse than no check, so anything other than a
  // 200 on the root stops the run here.
  if (home.status !== 200) {
    console.error(
      `\n  The site root answered ${home.status}, so nothing below could be checked.\n\n` +
        `  Either the site is genuinely down, or this network is blocking it —\n` +
        `  an agent sandbox blocks outbound HTTPS to *.vercel.app by policy and\n` +
        `  answers 403 to every request. Run this from your own machine to tell\n` +
        `  the two apart.\n\n` +
        `  This is NOT a pass and NOT a verified failure. The walk did not run.\n`,
    );
    process.exit(2);
  }

  const failures = [...coverageFailures];

  // 1. Which commit is serving. /api/version is the same answer without
  // viewing source, so it is what a human is told to open; prefer it here too
  // so both routes are exercised by the same run.
  let served = null;
  let builtAt = null;
  try {
    const version = await get(`${origin}/api/version`);
    if (version.status === 200) {
      const parsed = JSON.parse(version.body);
      served = parsed.commit ?? null;
      builtAt = parsed.builtAt ?? null;
    }
  } catch {
    // Falls through to the meta tag, which is on every page anyway.
  }
  served ??= meta(home.body, "x-build-commit");
  builtAt ??= meta(home.body, "x-build-time");
  const local = localHead();
  const remote = remoteHead();

  console.log("\nBuild");
  if (!served) {
    line(false, "served commit", "no x-build-commit meta — build predates the stamp");
    failures.push(
      "The live page carries no build stamp, so it is older than the commit that added one. That alone means the deploy has not landed.",
    );
  } else {
    const matchesLocal = local && served === local;
    line(
      Boolean(matchesLocal),
      "served commit",
      `${served.slice(0, 7)}${builtAt ? `  built ${builtAt}` : ""}`,
    );
    if (local) line(true, "local HEAD", local.slice(0, 7));
    if (remote && remote !== local) {
      line(false, "origin HEAD", `${remote.slice(0, 7)} — local is not pushed`);
      failures.push("Local HEAD and origin differ — push before checking.");
    }
    if (local && !matchesLocal) {
      failures.push(
        `Production is serving ${served.slice(0, 7)} but HEAD is ${local.slice(0, 7)}. The deploy has not landed (still building, failed, or the project's production branch is not this one).`,
      );
    }
  }

  // 2. og:url points at the host actually serving it.
  console.log("\nMetadata");
  const og = ogUrl(home.body);
  const ogOk = og !== null && og.startsWith(origin);
  line(ogOk, "og:url", og ?? "missing");
  if (!ogOk) {
    failures.push(
      `og:url is ${og ?? "missing"} on a site served from ${origin}. Set NEXT_PUBLIC_SITE_URL in the Vercel project to ${origin}.`,
    );
  }

  // 3. The open routes exist.
  console.log("\nOpen routes");
  for (const route of OPEN_ROUTES) {
    let answer;
    try {
      answer = await get(`${origin}${route}`, "HEAD");
    } catch (error) {
      answer = { status: `error: ${error.message}` };
    }
    const verdict = judgeOpen({ route, status: answer.status });
    line(verdict.ok, route, verdict.detail);
    if (verdict.failure) failures.push(verdict.failure);
  }

  /*
   * 4. The guarded routes are deployed AND guarded, in both languages.
   *
   * WITH NO SESSION, ON PURPOSE. There is no way for a script to sign in here —
   * the only door is a phone OTP — and that fact was silently treated as "so
   * these screens cannot be checked". What a signed-out request proves is the
   * deploy landed, the guard is on, and the redirect keeps the reader's
   * language. What it cannot prove is the body, which is `npm run verify`'s job.
   */
  console.log("\nGuarded routes (no session)");
  for (const route of GUARDED_ROUTES) {
    for (const prefix of LOCALE_PREFIXES) {
      let answer;
      try {
        answer = await get(`${origin}${prefix}${route}`, "HEAD");
      } catch (error) {
        answer = { status: `error: ${error.message}`, location: null };
      }
      const verdict = judgeGuarded({
        route,
        prefix,
        status: answer.status,
        location: answer.location,
      });
      line(verdict.ok, `${prefix}${route}`, verdict.detail);
      if (verdict.failure) failures.push(verdict.failure);
    }
  }

  // 5. And the removed ones stay removed.
  console.log("\nRemoved");
  for (const route of GONE_ROUTES) {
    let answer;
    try {
      answer = await get(`${origin}${route}`, "HEAD");
    } catch (error) {
      answer = { status: `error: ${error.message}` };
    }
    const verdict = judgeGone({ route, status: answer.status });
    line(verdict.ok, `${route} (should 404)`, verdict.detail);
    if (verdict.failure) failures.push(verdict.failure);
  }

  /*
   * 6. Every route vercel.json schedules is deployed and guarded.
   *
   * ASKED WITH GET, BECAUSE THAT IS HOW THE SCHEDULER ASKS. These handlers
   * export GET only, so a HEAD would answer 405 and the check would be
   * measuring its own request rather than the route. No secret is offered, so
   * the handler refuses before doing any work — this walk reconciles nothing
   * and sweeps nothing.
   */
  console.log("\nCron targets (no secret)");
  const crons = cronPaths(readFileSync("vercel.json", "utf8")) ?? [];
  for (const path of crons) {
    let answer;
    try {
      answer = await get(`${origin}${path}`);
    } catch (error) {
      answer = { status: `error: ${error.message}` };
    }
    const verdict = judgeCron({ path, status: answer.status });
    line(verdict.ok, path, verdict.detail);
    if (verdict.failure) failures.push(verdict.failure);
  }

  if (failures.length === 0) {
    console.log("\n  Live and current.\n");
    return;
  }

  console.error(`\n${failures.length} problem${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  process.exit(1);
}

main().catch((error) => {
  console.error(`\ncheck-deployed failed to run: ${error.stack || error.message}\n`);
  process.exit(2);
});
