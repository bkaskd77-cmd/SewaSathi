import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CRON_JOBS,
  DAILY_JOB_STALE_AFTER_HOURS,
  isCronJob,
  runFreshness,
} from "@/lib/config/cron";
import { cronPaths } from "../../scripts/deployed-routes.mjs";

/**
 * The schedule, the recorder and the constraint are one list written three
 * times.
 *
 * WHY IT IS WORTH PINNING. A cron added to `vercel.json` with no entry in
 * `CRON_JOBS` records nothing — it fires nightly and leaves no trace, which is
 * the exact condition this whole table was built to end, reintroduced by a
 * one-line addition. And a `CRON_JOBS` entry the migration's check constraint
 * does not know is worse: the insert is refused, so the one record that the job
 * ran is lost in the same statement that tried to write it.
 */

describe("one list, three places", () => {
  it("records exactly the jobs vercel.json schedules", () => {
    const scheduled = cronPaths(readFileSync("vercel.json", "utf8"));
    expect([...CRON_JOBS].sort()).toEqual([...(scheduled ?? [])].sort());
  });

  /*
   * READ OUT OF THE MIGRATION, not copied into the test. A constraint and a
   * TypeScript constant drift silently; the first sign is a production insert
   * being refused, which is also the moment the evidence is lost.
   */
  it("names exactly the jobs the check constraint allows", () => {
    const sql = readFileSync(
      "supabase/migrations/20260927000002_cron_runs.sql",
      "utf8",
    );
    // No `/s` flag: `[^)]*` already spans newlines, and the flag needs a newer
    // target than this project compiles to. No `matchAll` spread either — that
    // wants --downlevelIteration. Both have bitten this repo before.
    const clause = sql.match(/cron_runs_job_known check \(\s*job in \(([^)]*)\)/);
    expect(clause).not.toBeNull();
    const allowed: string[] = [];
    const quoted = /'([^']+)'/g;
    let match = quoted.exec(clause![1]);
    while (match !== null) {
      allowed.push(match[1]);
      match = quoted.exec(clause![1]);
    }
    allowed.sort();
    expect(allowed).toEqual([...CRON_JOBS].sort());
  });

  it("guards a value that is not a job", () => {
    expect(isCronJob("/api/payments/reconcile")).toBe(true);
    expect(isCronJob("/api/payouts/run")).toBe(false);
    expect(isCronJob(null)).toBe(false);
  });
});

/**
 * How long is too long, and what an absence means.
 */
describe("reading the last run", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");

  /*
   * NEVER-RECORDED IS NOT NEVER-RAN, and the distinction is the whole reason
   * this is a named state rather than a null. The table ships at some point in
   * the product's life; every run before that is silent. Reading that silence as
   * "this job has never fired" manufactures an incident out of an absence —
   * rule 6, in the shape it takes for a log.
   */
  it("says never rather than guessing when nothing is recorded", () => {
    expect(runFreshness(null, now)).toEqual({ state: "never" });
    expect(runFreshness(undefined, now)).toEqual({ state: "never" });
    expect(runFreshness("not a date", now)).toEqual({ state: "never" });
  });

  it("calls a run from this morning fresh", () => {
    const run = runFreshness("2026-09-27T03:30:00.000Z", now);
    expect(run.state).toBe("fresh");
    expect(run.state !== "never" && run.hoursAgo).toBeCloseTo(8.5, 1);
  });

  /*
   * THE HOBBY WINDOW IS WHY THE BOUND IS 26 AND NOT 24. Vercel's own dashboard
   * says cron jobs on Hobby have a flexible one-hour window, so a job scheduled
   * at 03:00 legitimately runs at 03:59. A check that cried wolf at 24h would
   * fire on a job that ran correctly forty minutes late, and a check people mute
   * is the state this started in.
   */
  it("does not cry wolf on a job that ran late inside the Hobby window", () => {
    expect(DAILY_JOB_STALE_AFTER_HOURS).toBeGreaterThan(25);
    const lateButFine = new Date(
      now.getTime() - 24.8 * 3_600_000,
    ).toISOString();
    expect(runFreshness(lateButFine, now).state).toBe("fresh");
  });

  it("calls a job stale once it is past the bound", () => {
    const missed = new Date(
      now.getTime() - (DAILY_JOB_STALE_AFTER_HOURS + 1) * 3_600_000,
    ).toISOString();
    expect(runFreshness(missed, now).state).toBe("stale");
  });

  /*
   * A CLOCK THAT DISAGREES IS NOT A STALE JOB. Vercel's clock and Postgres's
   * `now()` are different machines; a run stamped a few seconds in the future
   * must not read as negative age or wrap into staleness.
   */
  it("treats a run stamped in the future as fresh, not stale", () => {
    const ahead = new Date(now.getTime() + 30_000).toISOString();
    const run = runFreshness(ahead, now);
    expect(run.state).toBe("fresh");
    expect(run.state !== "never" && run.hoursAgo).toBe(0);
  });
});
