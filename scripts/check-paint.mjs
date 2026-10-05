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

/**
 * Every interactive thing smaller than WCAG 2.2's 24x24 minimum.
 *
 * WHY IT LIVES HERE. This script already boots a real Chromium and walks the four front
 * doors in both languages, and a tap target is only measurable in a browser — the size
 * comes from the type scale, the line height and the padding together, which is exactly
 * the kind of number nobody can read off a class name. Lighthouse reports it too, but
 * Lighthouse is a periodic manual check and this runs on every push.
 *
 * FOUND BY MEASURING, AND IT CORRECTED A STANDING NOTE. The failures were recorded as
 * "three target-size failures in the site header"; the header's own controls are 27px and
 * 32px and were never short. It was **fourteen** footer links at 19px — a line of
 * `text-body-sm` with no padding — plus the footer wordmark at 21px.
 *
 * `aria-hidden` AND `tabindex="-1"` TOGETHER ARE EXCLUDED, and only together. The booking
 * form's file input is 1x1 by design: it is driven by a visible button and is hidden from
 * the accessibility tree, so it is not a target anybody can aim at. Excluding on either
 * attribute alone would wave through something genuinely unreachable by one route.
 *
 * AND THE SPEC'S INLINE EXCEPTION IS HONOURED, which the first version was not — it
 * reported the "terms" and "privacy policy" links inside the sign-in sentence. WCAG 2.2
 * exempts a target "in a sentence or whose size is otherwise constrained by the
 * line-height of non-target text", because the alternative is padding a word until it
 * breaks the line it sits in. Detected as the spec describes it rather than by a list of
 * places to ignore: the element lays out inline AND its parent holds text of its own
 * outside it. A checker that cries wolf gets skimmed and the one real entry goes with the
 * noise — `check:keys` records the same lesson after three regex attempts.
 */
const READ_SMALL_TARGETS = `(() => {
  const out = [];
  for (const el of document.querySelectorAll("a, button, [role=radio], [role=checkbox], input, select, textarea")) {
    if (el.getAttribute("aria-hidden") === "true" && el.getAttribute("tabindex") === "-1") continue;

    /* The spec's inline exception: laid out inline, inside text that is not the target. */
    const display = getComputedStyle(el).display;
    if (display === "inline") {
      const parent = el.parentElement;
      const around = parent
        ? Array.from(parent.childNodes)
            .filter((n) => n !== el)
            .map((n) => n.textContent || "")
            .join("")
            .trim()
        : "";
      if (around.length > 0) continue;
    }

    /*
     * A control wrapped in its own label is as big as the label: clicking anywhere in it
     * toggles the control, so the label is what a finger aims at. The filter bar's
     * "verified only" checkbox is 16px inside a 40px label.
     */
    const label = el.closest("label");
    if (label && label !== el) {
      const lr = label.getBoundingClientRect();
      if (lr.width >= 24 && lr.height >= 24) continue;
    }

    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    /* ROUNDED BEFORE COMPARING, not after. A 24px box measures 23.98 on a fractional
       device pixel ratio, so comparing the raw float while printing the rounded one
       produced "has a 53x24 tap target — WCAG 2.2 asks for 24x24", which is a checker
       arguing with itself. The number in the message is now the number it judged. */
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w < 24 || h < 24) out.push({
      label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 32),
      w,
      h,
    });
  }
  return out;
})()`;

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
      const violations = [];
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      try {
      /*
       * A CONTENT SECURITY POLICY THAT BLOCKS SOMETHING FAILS SILENTLY.
       *
       * The page still paints — that is the whole point of a policy, it
       * removes one script and carries on — so the check above would go on
       * saying "ok" while a bundle, a style or a websocket was being refused
       * in every visitor's browser. Chromium reports each refusal to the
       * console, so this reads them and treats one as a failure.
       *
       * That makes the policy in next.config.mjs testable: tighten a directive
       * too far and this says which one, here, rather than a customer finding
       * out that the live booking page stopped updating.
       */
      page.on("console", (message) => {
        const text = message.text();
        if (/content security policy/i.test(text)) violations.push(text);
      });

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
        for (const violation of violations) {
          failures.push(`${path} violated its own CSP — ${violation}`);
        }

        const small = await page.evaluate(READ_SMALL_TARGETS).catch(() => []);
        for (const target of small) {
          failures.push(
            `${path} has a ${target.w}x${target.h} tap target — "${target.label}". WCAG 2.2 asks for 24x24.`,
          );
        }

        results.push({
          path,
          status,
          fcp,
          violations: violations.length,
          small: small.length,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log("\nPaint check");
  for (const { path, status, fcp, violations, small } of results) {
    const state = fcp > 0 && !violations && !small ? "ok  " : "FAIL";
    const value = fcp === null ? "no FCP" : `FCP ${Math.round(fcp)}ms`;
    const csp = violations ? `  ${violations} CSP violation(s)` : "";
    const tiny = small ? `  ${small} tap target(s) under 24px` : "";
    console.log(`  ${state}  ${path.padEnd(24)} HTTP ${status}  ${value}${csp}${tiny}`);
  }

  if (failures.length > 0) {
    console.error("\nPaint check failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    "  Every page painted, nothing was refused by the policy, and every tap target\n  clears 24x24.\n",
  );
}

main().catch((error) => {
  console.error(`Paint check could not run: ${error.stack ?? error.message}`);
  process.exit(1);
});
