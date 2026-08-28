#!/usr/bin/env node
/**
 * `next build`, with the bundle budget enforced on the way out.
 *
 * This is what `npm run build` runs, so Vercel enforces it on every deploy: a
 * regression fails the build instead of shipping and being noticed later in a
 * Lighthouse run.
 *
 * It parses the route table Next prints rather than re-deriving sizes from the
 * manifests. The printed number is the one everybody quotes, and
 * reimplementing Next's arithmetic would quietly drift from it.
 */
import { spawn } from "node:child_process";
import process from "node:process";

import { BUDGET } from "./perf-budget.mjs";

const ANSI = new RegExp("\\u001b\\[[0-9;]*m", "g");

/** "13.4 kB" / "873 B" / "1.1 MB" -> kB as a number. */
function toKb(size) {
  const match = /^([\d.]+)\s*(B|kB|MB)$/.exec(size.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (match[2] === "B") return value / 1024;
  if (match[2] === "MB") return value * 1024;
  return value;
}

function parseRouteTable(output) {
  const routes = [];
  let sharedByAll = null;

  for (const raw of output.replace(ANSI, "").split("\n")) {
    const line = raw.trimEnd();

    const shared =
      /^\+ First Load JS shared by all\s+([\d.]+\s*[kKM]?B)\s*$/.exec(line);
    if (shared) {
      sharedByAll = toKb(shared[1]);
      continue;
    }

    // "┌ ƒ /    13.4 kB    129 kB". The chunk lines under the shared total
    // carry one size, not two, so requiring both is what keeps them out.
    const route =
      /^[┌├└]\s+(?:\S\s+)?(\/\S*)\s+([\d.]+\s*[kKM]?B)\s+([\d.]+\s*[kKM]?B)\s*$/.exec(
        line,
      );
    if (route) {
      const firstLoadKb = toKb(route[3]);
      if (firstLoadKb !== null) routes.push({ route: route[1], firstLoadKb });
    }
  }

  return { routes, sharedByAll };
}

function checkBudget(output) {
  const { routes, sharedByAll } = parseRouteTable(output);

  // Passing because the table moved would be worse than having no check: it
  // would read as green forever.
  if (routes.length === 0 || sharedByAll === null) {
    return {
      rows: [],
      failures: [
        "Could not read the route table from `next build` — the output format changed. Fix scripts/check-bundle-budget.mjs rather than deleting the check.",
      ],
    };
  }

  const failures = [];
  const rows = [];
  const byRoute = new Map(routes.map((r) => [r.route, r.firstLoadKb]));

  for (const [route, ceiling] of Object.entries(BUDGET.routes)) {
    const actual = byRoute.get(route);
    if (actual === undefined) {
      failures.push(
        `Budgeted route ${route} is not in the build output. If it moved or was renamed, update scripts/perf-budget.mjs.`,
      );
      continue;
    }
    rows.push({ label: route, actual, ceiling });
    if (actual > ceiling) {
      failures.push(
        `${route} first load is ${actual.toFixed(1)} kB, over its ${ceiling} kB budget by ${(actual - ceiling).toFixed(1)} kB.`,
      );
    }
  }

  const worst = routes.reduce((a, b) =>
    b.firstLoadKb > a.firstLoadKb ? b : a,
  );
  rows.push({
    label: `largest route (${worst.route})`,
    actual: worst.firstLoadKb,
    ceiling: BUDGET.anyRoute,
  });
  if (worst.firstLoadKb > BUDGET.anyRoute) {
    failures.push(
      `${worst.route} first load is ${worst.firstLoadKb.toFixed(1)} kB, over the ${BUDGET.anyRoute} kB ceiling every route has to clear.`,
    );
  }

  rows.push({
    label: "shared by all",
    actual: sharedByAll,
    ceiling: BUDGET.sharedByAll,
  });
  if (sharedByAll > BUDGET.sharedByAll) {
    failures.push(
      `Shared JS is ${sharedByAll.toFixed(1)} kB, over its ${BUDGET.sharedByAll} kB budget. Every page pays for this one.`,
    );
  }

  return { rows, failures };
}

function report({ rows, failures }) {
  console.log("\nBundle budget");
  for (const { label, actual, ceiling } of rows) {
    const over = actual > ceiling;
    const margin = Math.abs(ceiling - actual).toFixed(1);
    console.log(
      `  ${over ? "OVER" : "ok  "}  ${label.padEnd(24)} ${actual.toFixed(1).padStart(6)} kB / ${String(ceiling).padStart(4)} kB  (${margin} kB ${over ? "over" : "spare"})`,
    );
  }

  if (failures.length === 0) {
    console.log("  All within budget.\n");
    return;
  }

  console.error("\nBundle budget exceeded:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nThese ceilings carry headroom, so something got a lot heavier. Find it by\n" +
      "diffing the route table against the last build, and raise the number in\n" +
      "scripts/perf-budget.mjs only as a deliberate decision.\n",
  );
}

const child = spawn("next", ["build"], {
  stdio: ["inherit", "pipe", "inherit"],
  shell: process.platform === "win32",
  env: process.env,
});

let captured = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  captured += chunk;
  process.stdout.write(chunk);
});

child.on("error", (error) => {
  console.error(`Could not run \`next build\`: ${error.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const result = checkBudget(captured);
  report(result);
  process.exit(result.failures.length > 0 ? 1 : 0);
});
