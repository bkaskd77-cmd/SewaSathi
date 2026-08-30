#!/usr/bin/env node
/**
 * The booking funnel, driven in a real browser.
 *
 * Everything here is behaviour a customer would notice and that no unit test
 * can reach: the flow is one client component holding five screens of state,
 * and the thing most worth protecting is that the state survives.
 *
 * The case that matters most — and the reason /book was taken out of
 * PROTECTED_ROUTES — is the logged-out one. A stranger fills in three screens,
 * is sent to sign in, and must come back to exactly where they were with every
 * field intact. That path crosses a full page navigation, so it cannot be
 * asserted in a component test; it needs a browser and real sessionStorage.
 *
 * Needs a built app (`npm run build`) and a Chromium, same as check-paint.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import process from "node:process";

import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  process.env.PERF_CHROME_PATH,
  process.env.CHROME_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const DRAFT_KEY = "sajilokaam-booking-draft";

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

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

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server never came up at ${url}`);
}

/** Fill steps a and b, which every case below needs. */
async function fillProblemAndAddress(page, { tole, landmark }) {
  await page.fill("#description", "Kitchen tap has been leaking since morning");
  await page.click("button.btn-tactile");
  await page.waitForSelector("#area", { timeout: 10_000 });

  const area = await page.$eval("#area option:not([disabled])", (o) => o.value);
  await page.selectOption("#area", area);
  await page.fill("#tole", tole);
  await page.fill("#landmark", landmark);
}

const CASES = [
  {
    name: "signed-out flow keeps every field across the login redirect",
    async run(page, origin) {
      await page.goto(
        `${origin}/book?category=plumbing&urgency=emergency&q=Tap%20leaking`,
        { waitUntil: "load" },
      );

      // Triage seeded the description and the category.
      const seeded = await page.$eval("#description", (el) => el.value);
      if (!seeded.includes("Tap leaking")) {
        return `the triage description did not prefill (got "${seeded}")`;
      }

      await fillProblemAndAddress(page, {
        tole: "Jhamsikhel",
        landmark: "Opposite the Patan Museum gate",
      });
      await page.click("button.btn-tactile");
      await page.waitForTimeout(400);

      // Step c, then the sign-in wall.
      await Promise.all([
        page.waitForURL(/\/login/, { timeout: 15_000 }),
        page.click("button.btn-tactile"),
      ]);

      const url = new URL(page.url());
      if (!url.searchParams.get("next")?.startsWith("/book")) {
        return `login did not carry the booking back in ?next= (${url.search})`;
      }

      const draft = await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        DRAFT_KEY,
      );
      if (!draft) return "the draft was lost on the way to login";

      const state = JSON.parse(draft);
      if (state.step !== "when") return `resumed at step "${state.step}", not "when"`;
      if (state.newAddress?.tole !== "Jhamsikhel") return "the tole was lost";
      if (!state.newAddress?.landmark) return "the landmark was lost";
      if (state.category !== "plumbing") return "the category was lost";
      return null;
    },
  },
  {
    name: "the draft is restored on the step it was left at",
    async run(page, origin) {
      await page.goto(`${origin}/book?category=plumbing`, { waitUntil: "load" });
      await fillProblemAndAddress(page, {
        tole: "Baluwatar",
        landmark: "Beside the peepal tree",
      });
      await page.click("button.btn-tactile");
      await page.waitForTimeout(400);

      // A refresh is the cheap stand-in for a dropped connection.
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(600);

      const heading = await page.$eval("h2", (el) => el.textContent.trim());
      if (!/when|कहिले/i.test(heading)) {
        return `after a reload the flow showed "${heading}" instead of the time step`;
      }
      return null;
    },
  },
  {
    name: "landmark is enforced before the address step can be left",
    async run(page, origin) {
      await page.goto(`${origin}/book?category=plumbing`, { waitUntil: "load" });
      await page.fill("#description", "Bathroom tap dripping constantly");
      await page.click("button.btn-tactile");
      await page.waitForSelector("#area", { timeout: 10_000 });

      const area = await page.$eval("#area option:not([disabled])", (o) => o.value);
      await page.selectOption("#area", area);
      await page.fill("#tole", "Sanepa");
      await page.click("button.btn-tactile");
      await page.waitForTimeout(300);

      const error = await page.$eval("#landmark-error", (el) =>
        el.textContent.trim(),
      );
      if (!error) return "the address step let a booking through with no landmark";
      return null;
    },
  },
  {
    name: "a cold /book with no parameters still works",
    async run(page, origin) {
      await page.goto(`${origin}/book`, { waitUntil: "load" });
      await page.click("button.btn-tactile");
      await page.waitForTimeout(300);

      const error = await page.$eval("#description-error", (el) =>
        el.textContent.trim(),
      );
      if (!error) return "an empty first step advanced without complaint";
      return null;
    },
  },
  {
    name: "the Nepali flow renders with no missing message keys",
    async run(page, origin) {
      await page.goto(`${origin}/ne/book?category=plumbing`, {
        waitUntil: "load",
      });
      const leaked = await page.$$eval("*", (els) =>
        els
          .map((el) => el.textContent?.trim() ?? "")
          .filter((text) => /^booking\.(flow|status|detail)\./.test(text)),
      );
      if (leaked.length > 0) {
        return `missing Nepali keys rendered as their own path: ${leaked.slice(0, 3).join(", ")}`;
      }
      const heading = await page.$eval("h1", (el) => el.textContent.trim());
      if (!/[ऀ-ॿ]/.test(heading)) {
        return `the Nepali page rendered a Latin heading: "${heading}"`;
      }
      return null;
    },
  },
];

async function main() {
  const executablePath = findChrome();
  if (!executablePath) {
    console.error("No Chromium found. Set PERF_CHROME_PATH to one.");
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

  const results = [];
  let browser;

  try {
    await waitForServer(`${origin}/`);
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    for (const testCase of CASES) {
      // A fresh context per case: sessionStorage and the locale cookie both
      // leak between them otherwise, and a later case reading an earlier
      // case's draft is a false pass.
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      try {
        const failure = await testCase.run(page, origin);
        results.push({ name: testCase.name, failure });
      } catch (error) {
        results.push({ name: testCase.name, failure: error.message });
      } finally {
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log("\nFlow check");
  for (const { name, failure } of results) {
    console.log(`  ${failure ? "FAIL" : "ok  "}  ${name}`);
    if (failure) console.log(`        ${failure}`);
  }

  const failed = results.filter((r) => r.failure);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} booking flow case${failed.length === 1 ? "" : "s"} broke.\n`,
    );
    process.exit(1);
  }
  console.log("  The funnel holds.\n");
}

main().catch((error) => {
  console.error(`\ncheck-flows failed to run: ${error.stack || error.message}\n`);
  process.exit(1);
});
