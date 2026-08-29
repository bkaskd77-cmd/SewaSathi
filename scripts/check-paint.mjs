#!/usr/bin/env node
/**
 * Asserts that the pages people actually land on paint something.
 *
 * Twice now an entrance animation has taken a page's first-contentful-paint to
 * zero: framer-motion rendered `opacity: 0` into the server HTML, and later the
 * auth route transition wrapped every page in the group in a fade from 0. Both
 * looked fine in a browser — the content arrives a fraction of a second later —
 * and both were invisible in code review. The second one scored /login a
 * Lighthouse 0 and nobody noticed until a run happened to be done.
 *
 * A paint check catches exactly that class of bug: if the browser has nothing
 * contentful to paint, no first-contentful-paint entry is ever recorded.
 *
 * Needs a built app (`npm run build`) and a Chromium. It is not part of
 * `npm run build` because Vercel's builder has no browser — CI runs it on
 * every push (.github/workflows/ci.yml).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import process from "node:process";

import { chromium } from "playwright-core";

/**
 * The pages a visitor actually lands on cold — in both languages.
 *
 * The Nepali paths are here for the same reason the English ones are: the
 * locale layout is a second place an entrance animation could hide the first
 * paint, and /ne is a real front door, not a translation of one.
 */
const PAGES = [
  "/",
  "/login",
  "/services",
  "/services/plumbing",
  "/ne",
  "/ne/login",
  "/ne/services",
  "/ne/services/plumbing",
];
const FCP_TIMEOUT_MS = 8000;

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
      // Not listening yet.
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
 * Resolves with the FCP timestamp, or rejects if the browser never records
 * one. `buffered: true` covers the paint that already happened before this
 * ran; the observer covers one that has not happened yet.
 */
const READ_FCP = `
  new Promise((resolve, reject) => {
    const done = performance.getEntriesByName("first-contentful-paint")[0];
    if (done) return resolve(done.startTime);

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          observer.disconnect();
          resolve(entry.startTime);
        }
      }
    });
    observer.observe({ type: "paint", buffered: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error("no first-contentful-paint within ${FCP_TIMEOUT_MS}ms"));
    }, ${FCP_TIMEOUT_MS});
  })
`;

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

  const failures = [];
  const results = [];
  let browser;

  try {
    await waitForServer(`${origin}/`);
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    for (const path of PAGES) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      try {
        const response = await page.goto(`${origin}${path}`, {
          waitUntil: "load",
        });
        const status = response?.status() ?? 0;
        if (status !== 200) {
          failures.push(`${path} returned HTTP ${status}.`);
          results.push({ path, status, fcp: null });
          continue;
        }

        const fcp = await page.evaluate(READ_FCP).catch((error) => {
          failures.push(
            `${path} never reported a first-contentful-paint. Something above it is rendering at opacity 0 — an entrance animation, most likely. (${error.message})`,
          );
          return null;
        });

        if (fcp !== null && !(fcp > 0)) {
          failures.push(`${path} reported a first-contentful-paint of ${fcp}.`);
        }
        results.push({ path, status, fcp });
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log("\nPaint check");
  for (const { path, status, fcp } of results) {
    const state = fcp > 0 ? "ok  " : "FAIL";
    const value = fcp === null ? "no FCP" : `FCP ${Math.round(fcp)}ms`;
    console.log(`  ${state}  ${path.padEnd(24)} HTTP ${status}  ${value}`);
  }

  if (failures.length > 0) {
    console.error("\nPaint check failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("");
    process.exit(1);
  }

  console.log("  Every page painted.\n");
}

main().catch((error) => {
  console.error(`Paint check could not run: ${error.stack ?? error.message}`);
  process.exit(1);
});
