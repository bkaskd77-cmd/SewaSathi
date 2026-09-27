import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CRON_JOBS } from "@/lib/config/cron";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * The record that a scheduled job ran, and that nothing can tidy it away.
 *
 * WHAT THIS TABLE IS FOR. `/api/payments/reconcile` nets guarantee debt off a
 * professional's future earnings; with nothing outstanding a correct run writes
 * nothing, so a run that happened and a run that never did leave identical
 * traces. The Cron Jobs page has no last-run column and Hobby's runtime log is
 * gone within the hour. The row is the only durable answer, which makes "can
 * this row be changed afterwards" a question worth an assertion rather than a
 * comment.
 */

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("recording that a job ran", () => {
  it("accepts every job the shared list names", async () => {
    for (const job of CRON_JOBS) {
      await expect(
        pg.admin.query(
          `insert into public.cron_runs (job, ok, summary)
           values ($1, true, '{"considered": 4, "recovered": 0}'::jsonb)`,
          [job],
        ),
      ).resolves.toBeTruthy();
    }
  });

  /*
   * A JOB THE CONSTRAINT DOES NOT KNOW LOSES THE RECORD IN THE SAME STATEMENT
   * THAT TRIES TO WRITE IT, which is why `tests/unit/cron-runs.test.ts` compares
   * this list against both `vercel.json` and the migration. This is the backstop,
   * not the first line.
   */
  it("refuses a job nobody scheduled", async () => {
    await expect(
      pg.admin.query(
        "insert into public.cron_runs (job, ok) values ('/api/payouts/run', true)",
      ),
    ).rejects.toThrow(/cron_runs_job_known/i);
  });

  /*
   * RULE 6. A run that was killed mid-flight writes no completion, and that
   * silence must stay distinguishable from a recorded failure. `ok` null is
   * "nobody said", never "it failed".
   */
  it("allows a run with no outcome recorded at all", async () => {
    const { rows } = await pg.admin.query(
      `insert into public.cron_runs (job) values ('/api/bookings/dispatch')
       returning ok, finished_at, summary`,
    );
    expect(rows[0].ok).toBeNull();
    expect(rows[0].finished_at).toBeNull();
    expect(rows[0].summary).toBeNull();
  });

  it("records a failed run, because that is the one that matters most", async () => {
    const { rows } = await pg.admin.query(
      `insert into public.cron_runs (job, ok, error)
       values ('/api/payments/reconcile', false, 'gateway timed out')
       returning ok, error`,
    );
    expect(rows[0].ok).toBe(false);
    expect(rows[0].error).toBe("gateway timed out");
  });
});

/**
 * APPEND-ONLY FOR EVERY CALLER, SERVICE ROLE INCLUDED.
 *
 * `pg.admin` is the service role — the most privileged caller this product has,
 * and the one every write to this table goes through. A log the application can
 * edit proves nothing, and the entire value here is that "it ran" cannot later
 * become "it did not". Same guarantee as `security_events`, asserted the same
 * way: by trying it as the strongest caller rather than by reading the trigger.
 */
describe("the record cannot be rewritten", () => {
  it("refuses an update from the service role", async () => {
    const { rows } = await pg.admin.query(
      "select id from public.cron_runs limit 1",
    );
    await expect(
      pg.admin.query("update public.cron_runs set ok = false where id = $1", [
        rows[0].id,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses a delete from the service role", async () => {
    const { rows } = await pg.admin.query(
      "select id from public.cron_runs limit 1",
    );
    await expect(
      pg.admin.query("delete from public.cron_runs where id = $1", [rows[0].id]),
    ).rejects.toThrow(/append-only/i);
  });

  /*
   * And the rows are still there afterwards — the refusals above would pass
   * just as well against a table that had quietly lost its contents.
   */
  it("still holds every row that was written", async () => {
    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.cron_runs",
    );
    expect(rows[0].n).toBe(CRON_JOBS.length + 2);
  });
});
