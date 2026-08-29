#!/usr/bin/env node
/**
 * Confirm the live site is actually serving the commit that was pushed.
 *
 * "Pushed" and "deployed" are not the same fact, and they diverged silently
 * once: four commits sat on the branch while production kept serving an older
 * build. Nothing in the repo could tell the difference, so it was caught by
 * reading the HTML by hand. This is that reading, automated.
 *
 * It answers three questions, in order of how much they matter:
 *
 *   1. Which commit is serving?  — from the <meta name="x-build-commit"> that
 *      app/[locale]/layout.tsx stamps into every page.
 *   2. Do the routes exist?      — a page that 404s is the loudest possible
 *      signal that a deploy did not land.
 *   3. Is og:url the real host?  — the one thing that is wrong on a page that
 *      otherwise looks perfect.
 *
 *   npm run check:deployed
 *   npm run check:deployed -- https://some-preview.vercel.app
 *
 * Note for anyone running this from an agent sandbox: outbound HTTPS to
 * *.vercel.app is blocked by the network policy there, so this check can only
 * be run from a machine with real internet. It exits 2 (not 1) when it cannot
 * reach the site at all, so "unreachable" is never mistaken for "verified".
 */
import { execSync } from "node:child_process";
import process from "node:process";

const DEFAULT_ORIGIN = "https://sewasathi.vercel.app";
const TIMEOUT_MS = 20_000;

/**
 * Routes that must exist, with the status they must answer.
 *
 * Both locales, because a page that only shipped in English is a page half
 * the audience gets a 404 from. Add a route here in the phase that ships it —
 * the list is the contract, and a page missing from it is a page nobody is
 * checking.
 */
const ROUTES = [
  "/",
  "/services",
  "/services/plumbing",
  "/login",
  "/providers/join",
  "/about",
  "/contact",
  "/help",
  "/help/complaint",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refunds",
  "/ne",
  "/ne/services",
  "/ne/providers/join",
  "/ne/about",
  "/ne/legal/terms",
];

/** Routes that must NOT exist — links removed rather than shipped. */
const GONE = ["/careers", "/ne/careers"];

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
    return { status: response.status, body };
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
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(26)} ${detail}`);
}

async function main() {
  const origin = (process.argv[2] || process.env.DEPLOY_URL || DEFAULT_ORIGIN)
    .trim()
    .replace(/\/+$/, "");

  console.log(`\nDeploy check — ${origin}`);

  let home;
  try {
    home = await get(`${origin}/`);
  } catch (error) {
    console.error(
      `\n  Could not reach ${origin}: ${error.message}\n\n` +
        `  This is NOT a pass and NOT a failure of the site — the check could not run.\n` +
        `  If you are in an agent sandbox, outbound HTTPS to *.vercel.app is blocked by\n` +
        `  policy; run this from your own machine instead.\n`,
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
        `  This is NOT a pass and NOT a verified failure. The check did not run.\n`,
    );
    process.exit(2);
  }

  const failures = [];

  // 1. Which commit is serving.
  const served = meta(home.body, "x-build-commit");
  const builtAt = meta(home.body, "x-build-time");
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

  // 3. The routes exist.
  console.log("\nRoutes");
  for (const route of ROUTES) {
    let status;
    try {
      ({ status } = await get(`${origin}${route}`, "HEAD"));
    } catch (error) {
      status = `error: ${error.message}`;
    }
    const ok = status === 200;
    line(ok, route, String(status));
    if (!ok) failures.push(`${route} answered ${status}, expected 200.`);
  }

  for (const route of GONE) {
    let status;
    try {
      ({ status } = await get(`${origin}${route}`, "HEAD"));
    } catch (error) {
      status = `error: ${error.message}`;
    }
    const ok = status === 404;
    line(ok, `${route} (should 404)`, String(status));
    if (!ok) failures.push(`${route} answered ${status}, expected 404.`);
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
