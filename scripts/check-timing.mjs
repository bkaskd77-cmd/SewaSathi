#!/usr/bin/env node
/**
 * How long does the live site actually take to answer?
 *
 * Numbers in a summary are not a measurement, and "it feels slow" is not a
 * bug report anybody can act on. This asks the deployed site directly and
 * prints where the time goes, so a change can be argued about with figures.
 *
 * WHAT IT MEASURES. Time to first byte, which for a server-rendered page is
 * the whole server cost: the function cold start if there is one, the session
 * check, and every database round trip the page makes before it can send a
 * byte. It is the number that decides whether a page feels instant, and it is
 * the one this codebase can actually change. Download and paint time are the
 * browser's and are covered by `check:paint` and Lighthouse.
 *
 * WHY IT REPORTS THE MEDIAN AND THE WORST. A single request tells you nothing
 * on a serverless platform — the first one after a quiet period pays for a
 * cold start and can be four times the rest. The median is what a visitor
 * usually gets; the worst is what the unlucky one gets, and on a marketplace
 * the unlucky one is often the first-time visitor deciding whether to trust
 * you.
 *
 * IT CANNOT RUN FROM THE AGENT SANDBOX — outbound HTTPS to *.vercel.app is
 * blocked by policy and the proxy answers 403 — so it exits 2 rather than
 * pretending, exactly like check:deployed.
 *
 *   npm run check:timing
 *   npm run check:timing -- https://sewasathi.vercel.app 7
 */

const DEFAULT_ORIGIN = "https://sewasathi.vercel.app";

/**
 * The routes that decide whether this product feels fast, in the order a real
 * visitor meets them. Signed-out only: a cookie would make the numbers
 * personal and unrepeatable.
 */
const ROUTES = [
  ["/", "landing — the front door"],
  ["/services", "catalogue"],
  ["/services/plumbing", "one category, with the provider query"],
  ["/login", "sign in"],
  ["/ne", "landing, Nepali"],
  ["/providers/standards", "prose page, no database"],
  ["/api/health", "server + database reachability"],
];

/**
 * Where the bar sits, in milliseconds of time to first byte.
 *
 * 800ms is roughly where a page stops feeling like a response to the tap and
 * starts feeling like a wait. 300ms is where it feels immediate. These are
 * perception thresholds, not platform limits.
 */
const GOOD_MS = 300;
const SLOW_MS = 800;

const origin = (process.argv[2] || DEFAULT_ORIGIN).replace(/\/$/, "");
const runs = Number(process.argv[3] || 5);

async function timeOnce(url) {
  const started = process.hrtime.bigint();
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "sajilokaam-timing/1.0" },
  });
  // Waiting for the first byte, not the whole body: the body is the network's
  // problem and the first byte is ours.
  const reader = response.body?.getReader();
  if (reader) {
    await reader.read();
    await reader.cancel();
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, status: response.status, region: response.headers.get("x-vercel-id") };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mark(ms) {
  if (ms <= GOOD_MS) return "fast";
  if (ms <= SLOW_MS) return "ok  ";
  return "SLOW";
}

console.log(`\nTiming ${origin} — ${runs} requests per route, time to first byte\n`);

let unreachable = false;
let slowest = 0;
const rows = [];

for (const [route, what] of ROUTES) {
  const samples = [];
  let status = 0;
  let region = null;

  for (let i = 0; i < runs; i += 1) {
    try {
      const result = await timeOnce(`${origin}${route}`);
      samples.push(result.ms);
      status = result.status;
      region ??= result.region;
    } catch (error) {
      unreachable = true;
      rows.push([route, what, `unreachable — ${error.message}`]);
      break;
    }
  }

  if (samples.length === 0) continue;

  /*
   * A FAST ANSWER FROM THE WRONG SERVER IS NOT A FAST SITE.
   *
   * The first version of this script reported every route as "fast, 2ms" from
   * the agent sandbox, where outbound HTTPS to *.vercel.app is refused by the
   * proxy: a 403 in two milliseconds is still two milliseconds. Vercel stamps
   * every response it serves with `x-vercel-id`, so its absence means the
   * request never got there — and a measurement that cannot say that is worse
   * than no measurement, because it reads as good news.
   */
  if (!region) {
    unreachable = true;
    rows.push([
      route,
      what,
      `blocked — HTTP ${status} from something that is not Vercel`,
    ]);
    continue;
  }

  const mid = median(samples);
  const worst = Math.max(...samples);
  slowest = Math.max(slowest, mid);
  rows.push([
    route,
    what,
    `${mark(mid)}  median ${Math.round(mid)}ms   worst ${Math.round(worst)}ms   HTTP ${status}${region ? `   ${region.split("::")[0]}` : ""}`,
  ]);
}

const width = Math.max(...rows.map(([route]) => route.length));
for (const [route, what, line] of rows) {
  console.log(`  ${route.padEnd(width)}  ${line}`);
  console.log(`  ${" ".repeat(width)}  ${what}`);
}

if (unreachable) {
  console.error(
    "\nCould not reach the site. From the agent sandbox that is expected — outbound\n" +
      "HTTPS to *.vercel.app is blocked by policy. Run this from your own machine.\n",
  );
  process.exit(2);
}

console.log(
  `\n  fast <= ${GOOD_MS}ms   ok <= ${SLOW_MS}ms   slower than that reads as a wait\n`,
);

if (slowest > SLOW_MS) {
  console.error(
    "Something is over the bar. The usual causes, in the order they are worth checking:\n" +
      "  1. Serverless region vs database region — every query pays the distance between\n" +
      "     them, and a page makes several. vercel.json pins the region; the Supabase\n" +
      "     project's is in its dashboard. They must match.\n" +
      "  2. Sequential awaits in a page. Reads that do not depend on each other belong\n" +
      "     in one Promise.all.\n" +
      "  3. A second round trip after a server action — router.refresh() on a path the\n" +
      "     action already revalidated renders the same page twice.\n",
  );
  process.exit(1);
}

console.log("Every route answers inside the bar.\n");
