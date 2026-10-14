#!/usr/bin/env node
/**
 * Does the live database still hold the functions this build shipped?
 *
 * WHY A SCRIPT WHEN `/api/health` ALREADY REPORTS IT. Because a health line is
 * not a gate. `db.functions` has compared the live fingerprints against the
 * build's since it shipped, and it caught genuine drift —
 * `enforce_booking_immutability` in production rebuilt from a stale copy, so it
 * had lost the guard that stops a signed-in customer writing `billable` on
 * their own booking, the reassignment ban and the `provider_serves` coverage
 * check — and nothing happened for weeks, because that endpoint was already red
 * over the ungotten SMS gateway. One unresolved failure masked the next.
 *
 * Two things changed. The endpoint's verdict is now about failures nobody has
 * acknowledged, so this moves it on its own. And drift gets a gate: this runs
 * on every successful deployment, and the nightly cron fails its own run when
 * it finds any.
 *
 * NO SECRET, DELIBERATELY. It reads the PUBLIC `/api/health` payload rather
 * than the database, so it needs no service-role key in CI and no Vercel API
 * token. The comparison itself lives in `lib/data/schema-drift.ts`, which the
 * deployment runs — one implementation, so this can never disagree with what
 * the endpoint says.
 *
 * EXIT 2 WHEN IT COULD NOT LOOK, never 0 and never 1 — the same contract as
 * `check:deployed` and `check:timing`, and for the same reason: the agent
 * sandbox cannot reach `*.vercel.app` at all, and a blocked request must not
 * read as a pass.
 */
import process from "node:process";

import { DRIFT_CHECK, driftRuleProblems, judgeDrift } from "./drift-rule.mjs";

/** The rule, proven to still bite, before every request. */
function selfTest() {
  const problems = driftRuleProblems();
  if (problems.length === 0) return;
  console.error("\nThe drift rule has stopped biting:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

async function main() {
  selfTest();

  if (process.argv.includes("--self-test")) {
    console.log("\nSchema drift");
    console.log(`  ${DRIFT_CHECK} rule self-tested over six payloads; the site was not contacted`);
    return;
  }

  /*
   * `||`, NEVER `??`, AND THIS WAS A REAL BUG THE MOMENT A WORKFLOW PASSED AN
   * UNSET VARIABLE. GitHub substitutes an unset `vars.*` as the EMPTY STRING,
   * and `??` only falls through on null or undefined — so `node
   * scripts/check-drift.mjs "${{ vars.DEPLOY_URL }}"` with no variable set left
   * `base` as `""` and fetched `/api/health` against nothing. Empty is absent
   * here, which is what `check-deployed.mjs` and `await-deploy.mjs` already do.
   */
  const base = (
    process.argv[2] ||
    process.env.DRIFT_URL ||
    "https://sewasathi.vercel.app"
  ).replace(/\/+$/, "");

  let payload;
  try {
    const response = await fetch(`${base}/api/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    /*
     * ANY STATUS IS READ. The endpoint answers 503 whenever something
     * unacknowledged is failing, and refusing to parse a 503 would make this
     * blind in exactly the case it exists for.
     */
    payload = await response.json();
  } catch (error) {
    console.error(`\nCould not reach ${base}/api/health — ${error.message}`);
    console.error(
      "  Exit 2: this is a request that never arrived, not a schema that matches.\n",
    );
    process.exit(2);
  }

  const verdict = judgeDrift(payload);

  if (verdict.code === 0) {
    console.log("\nSchema drift");
    console.log(`  none — ${verdict.message}`);
    console.log(`  commit serving: ${payload.commit ?? "unreported"}`);
    return;
  }

  if (verdict.code === 2) {
    console.error(`\nCould not compare — ${verdict.message}`);
    console.error("  Exit 2: nobody looked, which is not a pass.\n");
    process.exit(2);
  }

  console.error("\nSCHEMA DRIFT\n");
  console.error(`  ${verdict.message}`);
  console.error(
    "\n  The live database no longer matches supabase/migrations. Something was\n" +
      "  applied or edited outside the migration files — which is how a trigger\n" +
      "  in production came to be missing the guard that stops a customer\n" +
      "  writing `billable` on their own booking.\n" +
      "\n  Rebuild the function from the TREE's last definition, not from pg_proc:\n" +
      "  pg_proc is what you CHECK against, never what you copy from.\n",
  );
  process.exit(1);
}

await main();
