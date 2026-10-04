#!/usr/bin/env node
/**
 * The bundle budget, measured in a real browser.
 *
 * WHY THIS IS NO LONGER PART OF `next build`, AND WHAT THAT COSTS. It used to parse
 * the route table Next printed and run inside the build, so Vercel enforced it on every
 * deploy. Next 16 deleted the Size and First Load JS columns from `next build` output
 * **under both builders** — there is nothing left to scrape, and no per-route manifest
 * under webpack to re-derive them from. That is the failure the old script was written
 * to shout about rather than skip, and it did exactly that on the first Next 16 build.
 *
 * SO IT MEASURES WHAT A BROWSER ACTUALLY FETCHES, which is better than what it
 * replaced rather than a consolation. The printed figure was always *potential* first
 * load — every chunk a route might need — and this is the transferred reality: the
 * bytes of script that cross a connection before the page is interactive. The gap
 * between those two is not academic. On Next 16's own numbers the landing page's
 * potential first load is 201 kB gzipped; what a browser actually pulls on a webpack
 * build is 12 kB, because almost all of it is deferred. A budget on the first number
 * would have failed a page that is in fact fast.
 *
 * IT IS ALSO IMMUNE TO THE NEXT BUILDER CHANGE. Turbopack, webpack, whatever follows:
 * a browser loading a URL and counting script bytes keeps meaning the same thing.
 *
 * THE COST, STATED PLAINLY: this needs a Chromium, and Vercel's builder has none — so
 * it runs in CI on every push (`.github/workflows/ci.yml`) rather than inside the
 * build. A regression is caught before merge rather than at deploy. `LAUNCH-BLOCKERS.md
 * § ci-gates-deploy` is where the question of making a red push unable to deploy lives.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import process from "node:process";

import { chromium } from "playwright-core";

import { BUDGET } from "./perf-budget.mjs";

/** Where a Chromium might be. First hit wins; PERF_CHROME_PATH beats all. */
const CHROME_CANDIDATES = [
  process.env.PERF_CHROME_PATH,
  process.env.CHROME_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/**
 * A budgeted route key to a URL a browser can actually open.
 *
 * The keys in `perf-budget.mjs` are Next's route patterns, which is what the old
 * printed table used and what somebody editing a budget recognises. A browser needs a
 * concrete path, so the mapping is explicit here rather than guessed by substituting
 * into the pattern — a wrong guess would silently measure a 404, which paints fast and
 * would read as a very good score.
 */
const URL_FOR = {
  "/[locale]": "/",
  "/[locale]/login": "/login",
  "/[locale]/services": "/services",
  "/[locale]/services/[slug]": "/services/plumbing",
  "/[locale]/services/[slug]/[providerId]": null,
};

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, deadlineMs = 60000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      /* Not listening yet. */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not answer on ${url} within ${deadlineMs}ms.`);
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Script bytes transferred for one URL, in kB.
 *
 * COUNTED FROM THE RESPONSES THE BROWSER RECEIVED, not from a manifest: every script
 * it fetched up to `networkidle`, by the encoded length on the wire. `encodedBodySize`
 * is the compressed figure, which is what the ceilings have always meant — the bytes
 * that cross a connection in Kathmandu, not what they expand to in memory.
 *
 * AT `load`, NOT AT `networkidle`, AND THE DIFFERENCE IS LARGE ENOUGH TO HAVE FOOLED
 * THIS CHECK ONCE. Next prefetches the routes it finds linked in the viewport, so by
 * the time the network is idle the browser has pulled the chunks for every page this
 * one links to — `/services` measured 191 kB that way against a 120 kB ceiling, and
 * none of it was needed to use the page. Lighthouse puts the same page at 12 kB
 * because it stops counting where the visitor can start working. `load` is that
 * waypoint: what this page needs, not what it speculatively fetched for the next one.
 */
async function scriptKb(browser, origin, path) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  /*
   * PREFETCH IS REFUSED, AND WITHOUT THIS THE CHECK IS NOT A GATE. Next's `<Link>`
   * prefetches the routes it finds in the viewport, and each prefetched route drags in
   * its own chunks — so whether those bytes land before the waypoint depends on timing.
   * Measured without this, `/login` came back 177.6 kB on one run and 199.2 kB on the
   * next, a 22 kB swing on identical code. A budget that moves more than a regression
   * does cannot fail an actual regression.
   *
   * A prefetch is identifiable: the App Router sends `Next-Router-Prefetch` on the RSC
   * request, and aborting it stops the chunk cascade that follows. What is left is what
   * THIS page needs, which is what the ceiling is about — the next page's cost belongs
   * to the next page.
   */
  await page.route("**", (route) => {
    const headers = route.request().headers();
    if (headers["next-router-prefetch"] || headers["purpose"] === "prefetch") {
      return route.abort();
    }
    return route.continue();
  });

  try {
    const response = await page.goto(`${origin}${path}`, {
      waitUntil: "load",
      timeout: 45_000,
    });
    if (!response || response.status() >= 400) {
      throw new Error(`${path} answered ${response ? response.status() : "nothing"}`);
    }

    /*
     * A SETTLE AFTER LOAD, BECAUSE SOME WEIGHT ARRIVES DELIBERATELY LATE. `/login`
     * measured 153 kB on one run and 199 kB on the next with prefetch already blocked:
     * `MotionProvider` is dynamically imported and fetches framer-motion's features
     * when it mounts, which is after hydration. Whether that 46 kB landed before the
     * waypoint was a coin toss.
     *
     * INCLUDED RATHER THAN EXCLUDED, which is the judgement here. Those bytes reach the
     * visitor and are the reason `MotionProvider` is never mounted globally — a budget
     * that stopped counting just before them would go green on exactly the regression
     * that rule exists to prevent. A fixed settle is crude and it is deterministic,
     * which a gate has to be.
     */
    await page.waitForTimeout(2000);

    const bytes = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.initiatorType === "script")
        .reduce(
          (sum, entry) => sum + (entry.encodedBodySize || entry.transferSize || 0),
          0,
        ),
    );
    return bytes / 1024;
  } finally {
    await page.close();
  }
}

async function main() {
  const executablePath = findChrome();
  if (!executablePath) {
    console.error(
      "No Chromium found. Set PERF_CHROME_PATH to one, or install Chrome.\nLooked in:\n" +
        CHROME_CANDIDATES.filter(Boolean)
          .map((c) => `  ${c}`)
          .join("\n"),
    );
    process.exit(1);
  }

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn("next", ["start", "-p", String(port)], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
    env: process.env,
  });
  server.on("error", (error) => {
    console.error(`Could not run \`next start\`: ${error.message}`);
    process.exit(1);
  });

  const rows = [];
  const failures = [];
  let browser;

  try {
    await waitForServer(`${origin}/`);
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    for (const [route, ceiling] of Object.entries(BUDGET.routes)) {
      const path = URL_FOR[route];
      if (path === undefined) {
        /*
         * A budgeted route with no URL mapping is a failure, not a skip. Silently
         * passing a route nobody measured is how a budget becomes decorative.
         */
        failures.push(
          `Budgeted route ${route} has no entry in URL_FOR, so nothing measured it. ` +
            "Add one in scripts/check-bundle-budget.mjs or remove the budget.",
        );
        continue;
      }
      if (path === null) {
        // Deliberately unmeasurable without data: a provider page needs a real
        // provider id, and the seed ships none. Named here rather than forgotten.
        rows.push({ label: route, actual: null, ceiling });
        continue;
      }

      const actual = await scriptKb(browser, origin, path);
      rows.push({ label: route, actual, ceiling });
      if (actual > ceiling) {
        failures.push(
          `${route} transfers ${actual.toFixed(1)} kB of script, over its ${ceiling} kB budget by ${(actual - ceiling).toFixed(1)} kB.`,
        );
      }
    }
  } catch (error) {
    failures.push(`Could not measure: ${error.message}`);
  } finally {
    await browser?.close();
    server.kill();
  }

  console.log("\nBundle budget — script transferred, measured in Chromium");
  for (const { label, actual, ceiling } of rows) {
    if (actual === null) {
      console.log(`  --    ${label.padEnd(40)} not measurable without seeded data`);
      continue;
    }
    const over = actual > ceiling;
    const margin = Math.abs(ceiling - actual).toFixed(1);
    console.log(
      `  ${over ? "OVER" : "ok  "}  ${label.padEnd(40)} ${actual.toFixed(1).padStart(6)} kB / ${String(ceiling).padStart(4)} kB  (${margin} kB ${over ? "over" : "spare"})`,
    );
  }

  if (failures.length === 0) {
    console.log("  All within budget.\n");
    process.exit(0);
  }

  console.error("\nBundle budget exceeded:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nThese ceilings are transferred script, not potential first load. Something is\n" +
      "being fetched that was not before — find it in the Network tab, and raise the\n" +
      "number in scripts/perf-budget.mjs only as a deliberate decision.\n",
  );
  process.exit(1);
}

await main();
