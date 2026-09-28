import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * A role change that leaves no trace is not a role change anybody can audit.
 *
 * WHAT WAS WRONG. `lib/data/review.ts` promoted an approved applicant with a
 * bare `.update({ role: "provider" })` and logged only on failure. So the live
 * audit log holds two `role.changed` rows and BOTH say `customer` — they are
 * written by `handle_new_user` at provisioning. The two elevations that actually
 * produced the provider and the admin account left nothing, and so did the
 * demotion of an admin back to customer. Nothing suggests those were anything
 * but the owner's own SQL; the point is that the log cannot say so, and an
 * absent record read as a clean one is the same mistake as a default read as a
 * measurement.
 *
 * A TRIGGER, NOT A CALL IN THE APPLICATION. An application-side
 * `recordSecurityEvent` after the update would miss exactly the paths that went
 * unrecorded — a dashboard query, an MCP call, a future admin tool — and would
 * not be in the same transaction, so a failure between the two would leave the
 * change without its record. `handle_new_user` already writes `role.changed`
 * from inside a trigger; this is the same idiom for every other path.
 *
 * SO THE ASSERTIONS ARE ABOUT THE ROW, NEVER ABOUT THE CALLER. Every case below
 * changes a role by some route and then asks the log what it holds. A test that
 * asserted "review.ts calls recordSecurityEvent" would pass while a dashboard
 * query wrote nothing, which is the failure that actually happened.
 */

const ANITA = "11111111-a111-4111-8111-111111111111";
const BINA = "22222222-b222-4222-8222-222222222222";
const ADMIN = "55555555-e555-4555-8555-555555555555";

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [BINA, "Bina Tamang", "customer"],
    [ADMIN, "Admin", "admin"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update
         set full_name = excluded.full_name, role = excluded.role`,
      [id, name, `+9779800000${id.slice(0, 2)}`, role],
    );
  }
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

/** Every role.changed event about one person, oldest first. */
async function eventsFor(id: string) {
  const { rows } = await pg.admin.query(
    `select actor_id, actor_role, detail
       from public.security_events
      where kind = 'role.changed' and subject_id = $1
      order by at, id`,
    [id],
  );
  return rows as Array<{
    actor_id: string | null;
    actor_role: string;
    detail: Record<string, unknown>;
  }>;
}

describe("every role change writes one event", () => {
  it("records a direct update, which is the path that recorded nothing", async () => {
    await pg.admin.query(
      "update public.profiles set role = 'provider' where id = $1",
      [ANITA],
    );

    const events = await eventsFor(ANITA);
    expect(events).toHaveLength(1);
    expect(events[0].detail.from).toBe("customer");
    expect(events[0].detail.to).toBe("provider");
  });

  it("names the route it could not be told about", async () => {
    // Nothing set a reason, so the trigger says what it can prove rather than
    // guessing: the database role that made the change. `postgres` is a
    // dashboard or an MCP query; `service_role` is our own server. Separating
    // those two is the whole question that could not be answered in September.
    const events = await eventsFor(ANITA);
    expect(events[0].detail.via).toBe("direct-sql");
  });

  it("writes nothing when the update does not touch the role", async () => {
    const before = (await eventsFor(BINA)).length;
    await pg.admin.query(
      "update public.profiles set full_name = 'Bina T.' where id = $1",
      [BINA],
    );
    expect(await eventsFor(BINA)).toHaveLength(before);
  });

  it("writes nothing when the role is set to what it already was", async () => {
    // Seven db tests upsert fixtures with `on conflict do update set role =
    // excluded.role`. A trigger without `is distinct from` would fill the log
    // with events for changes that did not happen.
    const before = (await eventsFor(BINA)).length;
    await pg.admin.query(
      "update public.profiles set role = role where id = $1",
      [BINA],
    );
    expect(await eventsFor(BINA)).toHaveLength(before);
  });
});

describe("the approval path can name itself and its admin", () => {
  it("carries the reason and the person through set_profile_role", async () => {
    await pg.admin.query(
      "select public.set_profile_role($1, 'provider', 'application.approved', $2)",
      [BINA, ADMIN],
    );

    const events = await eventsFor(BINA);
    expect(events).toHaveLength(1);
    expect(events[0].detail.via).toBe("application.approved");
    expect(events[0].detail.from).toBe("customer");
    expect(events[0].detail.to).toBe("provider");
    expect(events[0].actor_id).toBe(ADMIN);
    expect(events[0].actor_role).toBe("admin");
  });

  it("does not leak the reason into the next change", async () => {
    // The GUCs are transaction-local (`set_config(..., true)`), so a later
    // statement must not inherit "application.approved" from an earlier one and
    // attribute a direct edit to a path nobody took.
    await pg.admin.query(
      "update public.profiles set role = 'customer' where id = $1",
      [BINA],
    );

    const events = await eventsFor(BINA);
    expect(events).toHaveLength(2);
    expect(events[1].detail.via).toBe("direct-sql");
    expect(events[1].actor_id).toBeNull();
  });
});

describe("the funnel is not a new way in", () => {
  it("refuses execute to a browser role", async () => {
    const anita = await pg.asUser(ANITA);

    await expect(
      anita.query(
        "select public.set_profile_role($1, 'admin', 'nice try', $1)",
        [ANITA],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("would refuse the write even if the grant were ever restored", async () => {
    /*
     * SECURITY INVOKER is what makes that true, and it is the reason this
     * function is not `security definer`: a definer function that writes
     * `profiles.role` would be a new door of exactly the kind 20260927000005
     * closed. As invoker the caller's own privileges apply, and the column
     * grant gives `authenticated` three columns that do not include `role`.
     */
    const { rows } = await pg.admin.query(
      `select p.prosecdef
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_profile_role'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef, "set_profile_role must not be security definer")
      .toBe(false);
  });
});

describe("the record cannot be tidied away afterwards", () => {
  it("still refuses UPDATE and DELETE on the events it wrote", async () => {
    // The whole value of this row is that it outlives somebody's second
    // thoughts. `security_events` is append-only for every caller including the
    // service role, and a new writer must not have quietly changed that.
    await expect(
      pg.admin.query(
        "update public.security_events set detail = '{}'::jsonb where kind = 'role.changed'",
      ),
    ).rejects.toThrow();

    await expect(
      pg.admin.query("delete from public.security_events where kind = 'role.changed'"),
    ).rejects.toThrow();
  });
});
