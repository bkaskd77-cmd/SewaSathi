import "server-only";

import { CRON_JOBS, type CronJob } from "@/lib/config/cron";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Write down that a scheduled job ran.
 *
 * See `lib/config/cron.ts` for why this exists at all: three different ways of
 * asking "has the recovery sweep ever fired" each failed, and the last one
 * failed because a correct run with nothing to do writes nothing. The row is
 * the record that it happened, independent of what it found.
 *
 * `lib/config/cron.ts` holds the pure half — the job list and the freshness
 * judgement — so both can be tested without a database.
 */

export type CronRun = {
  job: CronJob;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  summary: unknown;
  error: string | null;
};

/**
 * Record one run. **Never throws, and never returns a failure worth acting on.**
 *
 * Same contract as `notify()` and `lib/audit`: the run already happened. A
 * recorder that throws would turn a successful sweep into a 500 and, worse,
 * would make the cron look broken precisely because the thing watching it
 * broke. If the write fails, the console line is all there is — which is the
 * state the whole product was in before this table existed, so it is no worse.
 */
export async function recordCronRun(input: {
  job: CronJob;
  startedAt: Date;
  ok: boolean;
  summary?: unknown;
  error?: string | null;
}): Promise<void> {
  if (!hasSupabaseConfig()) return;

  try {
    const { error } = await createAdminClient().from("cron_runs").insert({
      job: input.job,
      started_at: input.startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      ok: input.ok,
      summary: input.summary ?? null,
      error: input.error ?? null,
    });
    if (error) {
      console.error(`[cron-runs] could not record ${input.job} — ${describeError(error)}`);
    }
  } catch (thrown) {
    console.error(`[cron-runs] threw recording ${input.job} — ${describeError(thrown)}`);
  }
}

/**
 * The most recent run of each job.
 *
 * NULL FOR A JOB MEANS "NOTHING RECORDED", NEVER "NEVER RAN" — every run before
 * this table shipped is silent, and reading that silence as a finding would
 * manufacture an incident out of an absence. `runFreshness` returns `never` for
 * exactly this reason and the health line says so in words.
 *
 * One query for both jobs: `distinct on` is the cheapest way to take the latest
 * row per job, and this is read by a health endpoint that must stay cheap.
 */
export async function lastCronRuns(): Promise<Map<CronJob, CronRun>> {
  const runs = new Map<CronJob, CronRun>();
  if (!hasSupabaseConfig()) return runs;

  try {
    const admin = createAdminClient();
    /*
     * PER JOB RATHER THAN ONE ORDERED READ. Taking the newest few rows overall
     * and picking them apart would miss a job entirely the moment the other one
     * runs more often — which is exactly the shape of bug this table exists to
     * make visible, so it would be a poor place to introduce one.
     */
    const results = await Promise.all(
      CRON_JOBS.map((job) =>
        admin
          .from("cron_runs")
          .select("job, started_at, finished_at, ok, summary, error")
          .eq("job", job)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    );

    for (const { data, error } of results) {
      if (error || !data) continue;
      const row = data as Record<string, unknown>;
      runs.set(row.job as CronJob, {
        job: row.job as CronJob,
        startedAt: String(row.started_at),
        finishedAt: row.finished_at ? String(row.finished_at) : null,
        ok: typeof row.ok === "boolean" ? row.ok : null,
        summary: row.summary ?? null,
        error: row.error ? String(row.error) : null,
      });
    }
  } catch (thrown) {
    console.error(`[cron-runs] read failed — ${describeError(thrown)}`);
  }

  return runs;
}
