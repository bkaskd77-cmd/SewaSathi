/**
 * What the schedules are, and how to read the last time one ran.
 *
 * THE PROBLEM THIS EXISTS FOR, stated once. `/api/payments/reconcile` runs
 * `sweepRedoRecovery`, which nets a guarantee debt off a professional's future
 * earnings. With no debt outstanding a correct run writes nothing at all — so
 * "it ran and had nothing to do" and "it has never been invoked in the life of
 * the product" leave byte-identical traces. Three separate attempts to tell them
 * apart failed, and each failed differently:
 *
 *   - **The Cron Jobs page has no last-run column.** It proves the jobs are
 *     registered and enabled, which rules out the worst case and answers
 *     nothing else.
 *   - **The runtime log is ephemeral.** On Hobby it holds a short window; the
 *     03:00–04:00 UTC run is long gone by the time anybody looks, and an empty
 *     thirty-minute view reads exactly like a job that has never fired.
 *   - **The database shows nothing** either, because a sweep with nothing to do
 *     correctly writes nothing.
 *
 * So the run has to record itself. A log line is somebody else's retention
 * policy; a row is ours. This is the same move as `security_events`: the fact
 * that something happened is worth more than the thing it did.
 *
 * Pure and dependency-free — `lib/data/cron-runs.ts` is the `server-only` half.
 * A judgement inside a server module is a judgement no test can reach, which
 * this repository has now paid for four times.
 */

/**
 * Every scheduled path, as `vercel.json` writes it.
 *
 * WRITTEN AS THE PATH, NOT A SLUG, so it can be compared directly against
 * `cronPaths(vercel.json)` — and `tests/unit/cron-runs.test.ts` asserts the two
 * sets are identical. A cron added to `vercel.json` with no recorder wired to it
 * fails there rather than becoming another schedule nobody can prove fired.
 *
 * It is also the check constraint on `cron_runs.job`: one list written twice, so
 * the test reads the migration and compares, the same arrangement as
 * `LOGGABLE_REASONS` and `REFUSAL_REASON_CODES`.
 */
export const CRON_JOBS = [
  "/api/payments/reconcile",
  "/api/bookings/dispatch",
] as const;

export type CronJob = (typeof CRON_JOBS)[number];

export function isCronJob(value: unknown): value is CronJob {
  return (CRON_JOBS as readonly string[]).includes(value as string);
}

/**
 * How long a daily job may go unseen before something is wrong.
 *
 * 24 for the schedule, **plus one for Vercel's Hobby window** — the dashboard
 * says in as many words that "cron jobs on Hobby have a flexible time window of
 * 1-hour", so a job scheduled at 03:00 legitimately runs at 03:59. Plus one more
 * of slack, because a check that cries wolf on a job that ran forty minutes late
 * gets muted, and a muted check is the state we started in.
 */
export const DAILY_JOB_STALE_AFTER_HOURS = 26;

export type RunFreshness =
  /**
   * Nothing has ever been recorded.
   *
   * **This is not "it never ran".** The recorder ships at some point in the
   * product's life and every run before that is silent — rule 6, in the shape it
   * takes for a log. Only a run after the recorder shipped can be counted, and
   * saying otherwise would manufacture a finding out of an absence.
   */
  | { state: "never" }
  | { state: "fresh"; hoursAgo: number }
  | { state: "stale"; hoursAgo: number };

export function runFreshness(
  lastRunAt: Date | string | null | undefined,
  now: Date = new Date(),
  staleAfterHours: number = DAILY_JOB_STALE_AFTER_HOURS,
): RunFreshness {
  if (!lastRunAt) return { state: "never" };
  const at = lastRunAt instanceof Date ? lastRunAt : new Date(lastRunAt);
  if (Number.isNaN(at.getTime())) return { state: "never" };

  const hoursAgo = (now.getTime() - at.getTime()) / 3_600_000;
  // A clock skew that puts the last run in the future is not staleness.
  const age = Math.max(0, hoursAgo);
  return age > staleAfterHours
    ? { state: "stale", hoursAgo: age }
    : { state: "fresh", hoursAgo: age };
}
