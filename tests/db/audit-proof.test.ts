import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The step-up proof on an audit row, and that nothing can edit it afterwards.
 *
 * WHY THE COLUMN EXISTS. `freshAdminActor()` refuses a money action without an
 * `amr` timestamp inside the fifteen-minute window; the row written afterwards
 * recorded the decision and said nothing about the challenge. A reviewer
 * reconstructing a disputed refund could see who decided and had to take the
 * gate on trust.
 *
 * NULL IS "NOT RECORDED" AND IS THE COMMON CASE, which is the half worth
 * asserting: a cron sweep and a gateway callback have no session to read, and
 * `lib/audit` never throws, so the absence has to stay writable and readable as
 * an absence. A NOT NULL here would have turned the log into a thing that can
 * refuse — which is precisely what it must never be.
 */

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("security_events.proved_at", () => {
  it("records the moment the gate read", async () => {
    const proved = "2026-10-17T09:00:00Z";
    const { rows } = await pg.admin.query(
      `insert into public.security_events (kind, actor_role, detail, proved_at)
       values ('payment.settled', 'admin', '{}'::jsonb, $1)
       returning proved_at`,
      [proved],
    );
    expect(new Date(rows[0].proved_at).toISOString()).toBe(
      new Date(proved).toISOString(),
    );
  });

  it("accepts a row with no proof at all", async () => {
    /* The cron's row. A sweep has no session, and a log that refused it would
       be a log that can stop the thing it is recording. */
    const { rows } = await pg.admin.query(
      `insert into public.security_events (kind, actor_role, detail)
       values ('payment.settled', 'system', '{}'::jsonb)
       returning proved_at`,
    );
    expect(rows[0].proved_at).toBeNull();
  });

  it("refuses to let anybody rewrite it, service role included", async () => {
    /*
     * THE PROPERTY THAT MAKES IT EVIDENCE. A proof that can be edited
     * afterwards proves nothing — the first thing anybody holding our own key
     * would do is adjust it. The append-only trigger already covers the table;
     * this asserts it covers the new column rather than assuming a guard
     * written before it existed still reaches it.
     */
    const { rows } = await pg.admin.query(
      `insert into public.security_events (kind, actor_role, detail, proved_at)
       values ('commission.appealResolved', 'admin', '{}'::jsonb, now())
       returning id`,
    );

    await expect(
      pg.admin.query(
        "update public.security_events set proved_at = now() where id = $1",
        [rows[0].id],
      ),
    ).rejects.toThrow();

    await expect(
      pg.admin.query("delete from public.security_events where id = $1", [
        rows[0].id,
      ]),
    ).rejects.toThrow();
  });

  it("is nullable, so the absence stays sayable", async () => {
    const { rows } = await pg.admin.query(
      `select is_nullable from information_schema.columns
        where table_schema = 'public'
          and table_name = 'security_events'
          and column_name = 'proved_at'`,
    );
    expect(rows[0].is_nullable).toBe("YES");
  });
});
