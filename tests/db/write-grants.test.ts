import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";
import { ALLOWED } from "../support/write-allowlist";

/**
 * Which tables a browser may write to, and what stops it writing the wrong column.
 *
 * WHY THIS EXISTS. `profiles` granted `authenticated` table-wide UPDATE with an
 * owner-update policy and no trigger, so any customer could set `role = 'admin'`
 * on their own row and open the six `is_admin()` policies behind it. The grant is
 * closed (`20260927000005`) and `profile-escalation.test.ts` executes the attempt.
 * This is the other half: the guard against a SEVENTH writable table arriving the
 * same way — silently, because nothing in the suite asserted the set.
 *
 * THE SWEEP STARTS AT `pg_policy`, AND THE REASON IT USED TO GIVE WAS WRONG.
 * It read: "the grant is not the discriminator — Supabase hands `anon` and
 * `authenticated` INSERT and UPDATE on every table through a default privilege,
 * so listing tables that have it would list all of them; the POLICY is what
 * decides." Every clause was true and the conclusion was not. A privilege every
 * table carries is not a reason to look past it; it is thirty-six locks left
 * open, each one policy away from mattering. `20261011000004` took insert,
 * update and delete back schema-wide and `20261016000002` took truncate,
 * trigger and references — TRUNCATE being the one that is not subject to RLS at
 * all, so no policy was ever going to stand in front of it.
 *
 * So the policy sweep stays, because it answers "which tables can a browser
 * write" and that is still the allow-list's question, and the privilege is
 * asserted on its own below rather than waved past.
 *
 * EACH ENTRY NAMES ITS GUARD RATHER THAN JUST PERMITTING THE TABLE. A list of
 * table names would still pass the day somebody dropped a trigger or widened a
 * column grant — it would be a list of things that were once looked at. Naming
 * the mechanism means the test fails when the mechanism goes, which is the only
 * version of this worth having.
 *
 * TO PROVE IT BITES: add a write policy to any table not listed and the first
 * case goes red; drop `enforce_application_immutability` or widen the `profiles`
 * column grant and the second does.
 */

type PolicyRow = {
  tbl: string;
  polname: string;
  cmd: string;
  has_using: boolean;
  has_check: boolean;
};

let pg: Harness;
let writePolicies: PolicyRow[];

beforeAll(async () => {
  pg = await startPostgres();

  const { rows } = await pg.admin.query(`
    select c.relname as tbl,
           p.polname,
           p.polcmd::text as cmd,
           (p.polqual is not null) as has_using,
           (p.polwithcheck is not null) as has_check
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where p.polcmd in ('a', 'w', 'd')
       and exists (
         select 1 from pg_roles r
          where r.oid = any (p.polroles)
            and r.rolname in ('anon', 'authenticated')
       )
     order by c.relname, p.polname
  `);

  writePolicies = rows as PolicyRow[];
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("no table lets a browser write without being named here", () => {
  it("finds a write policy only on tables on the allow-list", () => {
    const unlisted = writePolicies
      .filter((p) => !(p.tbl in ALLOWED))
      .map((p) => `${p.tbl}: ${p.polname} (${p.cmd})`);

    // The message is the useful half: a failure here means somebody added a way
    // for a browser to write a table, which is fine — but the column that
    // confers power on it has to be guarded first, and then named above.
    expect(
      unlisted,
      "A browser can now write a table nothing has vetted. Guard the privileged " +
        "column (a column grant, or a BEFORE trigger), then add it to ALLOWED " +
        "with the guard named.",
    ).toEqual([]);
  });

  it("has no entry for a table that cannot be written any more", () => {
    // The other direction, so the list cannot fill up with tables somebody
    // locked down years ago — an allow-list nobody prunes stops being read.
    const written = new Set(writePolicies.map((p) => p.tbl));
    const stale = Object.keys(ALLOWED).filter((t) => !written.has(t));

    expect(stale, "ALLOWED names a table with no write policy").toEqual([]);
  });

  it("grants no browser role a DELETE anywhere in the product", () => {
    // True across all 37 tables and never explicitly decided, which is exactly
    // why it is worth pinning: rows in this product are ended by a status or a
    // stamp, never removed, and the first DELETE policy should be an argument
    // somebody has to make rather than a line that slipped in.
    const deletes = writePolicies
      .filter((p) => p.cmd === "d")
      .map((p) => `${p.tbl}: ${p.polname}`);

    expect(deletes).toEqual([]);
  });

  it("leaves a browser role no table privilege but SELECT", async () => {
    /* THE WHOLE SET, NOT THREE VERBS OF IT. The previous sweep revoked insert,
       update and delete — the three anybody had thought about — and left
       TRUNCATE, TRIGGER and REFERENCES standing on 36 tables, because the
       question had been asked verb by verb rather than about the privilege.
       TRUNCATE is the one that matters: it is NOT subject to row-level security,
       so unlike every other write in this schema it never meets a policy, and
       the grant is the only thing in front of it. It sat on `security_events`,
       which exists to be append-only.

       Asked as "what is left" rather than "are these three gone", so a seventh
       verb cannot arrive the way the second three did.

       READ THROUGH `aclexplode` AND NOT `information_schema.role_table_grants`,
       which is the SQL standard's view and does not list PostgreSQL 17's
       MAINTAIN at all. Written against that view first, this case would have
       printed a tick over a privilege both browser roles still held on 36
       tables — the shape of a checker that has quietly stopped checking. The
       harness is 16 and has no MAINTAIN to find; the catalog is still the right
       one to ask, because the next privilege Postgres adds will be invisible to
       the standard view too. */
    const { rows } = await pg.admin.query(
      `select distinct a.privilege_type
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral aclexplode(c.relacl) a
         join pg_roles r on r.oid = a.grantee
        where n.nspname = 'public'
          and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and r.rolname in ('anon', 'authenticated')
        order by a.privilege_type`,
    );

    expect(rows.map((r: { privilege_type: string }) => r.privilege_type)).toEqual(["SELECT"]);
  });
});

/**
 * Reads what `authenticated` may actually write, per column, for one verb.
 *
 * `information_schema.column_privileges` lists every column of a table-wide
 * grant as well as the columns of a column grant, which is what makes it the
 * right catalog to ask: a revoke that never ran reads as all 40 columns rather
 * than as silence.
 */
async function grantedColumns(
  table: string,
  verb: "INSERT" | "UPDATE",
  grantee = "authenticated",
) {
  const { rows } = await pg.admin.query(
    `select column_name
       from information_schema.column_privileges
      where table_schema = 'public'
        and table_name = $1
        and grantee = $3
        and privilege_type = $2
      order by column_name`,
    [table, verb, grantee],
  );

  return rows.map((r: { column_name: string }) => r.column_name);
}

describe("every declared guard is still there", () => {
  it("has the trigger each trigger-guarded table names", async () => {
    for (const [table, entry] of Object.entries(ALLOWED)) {
      for (const guard of entry.guards) {
        if (guard.kind !== "trigger") continue;

        const { rows } = await pg.admin.query(
          `select t.tgname, t.tgenabled
             from pg_trigger t
            where t.tgrelid = ('public.' || $1)::regclass
              and not t.tgisinternal
              and t.tgname = $2`,
          [table, guard.name],
        );

        expect(rows, `${table} lost ${guard.name}`).toHaveLength(1);
        // 'D' is disabled. A trigger that is present and switched off guards
        // nothing, and reads in the catalog exactly like one that works.
        expect(rows[0].tgenabled, `${guard.name} is disabled`).not.toBe("D");
      }
    }
  });

  it("keeps each column-granted table narrowed to exactly its columns", async () => {
    for (const [table, entry] of Object.entries(ALLOWED)) {
      for (const guard of entry.guards) {
        if (guard.kind !== "column-grant") continue;

        for (const verb of ["INSERT", "UPDATE"] as const) {
          const declared = verb === "INSERT" ? guard.insert : guard.update;
          if (!declared) continue;

          expect(
            await grantedColumns(table, verb),
            `${table}'s ${verb} grant is not the set it declares`,
          ).toEqual([...declared].sort());
        }
      }
    }
  });

  it("declares a column set for every verb a column-granted table allows", async () => {
    /*
     * THE HOLE THE PLURAL SHAPE WOULD OTHERWISE OPEN. The case above walks the
     * declarations, so a verb nobody declared is a verb nobody asserts — and
     * `bookings` had exactly that asymmetry for months: a BEFORE UPDATE trigger
     * guarding the update path while INSERT was table-wide and unexamined. A
     * column-granted table must therefore account for every verb it has a
     * policy for.
     */
    for (const [table, entry] of Object.entries(ALLOWED)) {
      const grant = entry.guards.find((g) => g.kind === "column-grant");
      if (!grant || grant.kind !== "column-grant") continue;

      const declared = [
        ...(grant.insert ? ["INSERT"] : []),
        ...(grant.update ? ["UPDATE"] : []),
      ].sort();

      expect(
        declared,
        `${table} has a write policy for a verb its column grant says nothing about`,
      ).toEqual([...entry.verbs].sort());
    }
  });

  it("leaves a no-grant table with no browser privilege at all", async () => {
    /*
     * A policy with no privilege behind it is inert — the planner refuses before
     * the policy is consulted — and that is the whole guard on
     * `provider_applications`. It only reads as a guard if the privilege really
     * is absent, so this asks rather than trusting the migration, for both
     * browser roles: `anon` holds no policy there, and a grant to it would be a
     * second lock left open.
     */
    for (const [table, entry] of Object.entries(ALLOWED)) {
      if (!entry.guards.some((g) => g.kind === "no-grant")) continue;

      const { rows } = await pg.admin.query(
        `select grantee, privilege_type, column_name
           from information_schema.column_privileges
          where table_schema = 'public'
            and table_name = $1
            and grantee in ('anon', 'authenticated')
            and privilege_type in ('INSERT', 'UPDATE')
          order by grantee, privilege_type, column_name`,
        [table],
      );

      expect(
        rows,
        `${table} declares no browser grant and has one`,
      ).toEqual([]);
    }
  });

  it("checks both sides of every policy-guarded table", () => {
    /*
     * A missing `with check` on an UPDATE policy does NOT mean "anything goes" —
     * Postgres falls back to the `using` expression. It is listed anyway because
     * the two are different questions: `using` asks which rows you may touch,
     * `with check` asks what the row may become. Relying on the fallback is how
     * somebody writes a row into a shape they can no longer read back.
     */
    for (const [table, entry] of Object.entries(ALLOWED)) {
      if (!entry.guards.some((g) => g.kind === "policy-both-sides")) continue;

      for (const policy of writePolicies.filter((p) => p.tbl === table)) {
        if (policy.cmd === "w") {
          expect(policy.has_using, `${policy.polname} has no using`).toBe(true);
        }
        expect(
          policy.has_check,
          `${policy.polname} on ${table} has no with check`,
        ).toBe(true);
      }
    }
  });

  it("lets only the verbs each table declares", () => {
    const VERB = { a: "INSERT", w: "UPDATE", d: "DELETE" } as const;

    for (const [table, entry] of Object.entries(ALLOWED)) {
      const found = Array.from(
        new Set(
          writePolicies
            .filter((p) => p.tbl === table)
            .map((p) => VERB[p.cmd as keyof typeof VERB]),
        ),
      ).sort();

      expect(found, `${table} gained or lost a write verb`).toEqual(
        [...entry.verbs].sort(),
      );
    }
  });

  it("gives a signed-in browser no write privilege the allow-list does not name", async () => {
    /*
     * THE MECHANISM `tests/support/refusals.ts` POINTS AT, and the one case
     * that covers every table at once.
     *
     * The behavioural tests across the suite assert that a browser's write to
     * `payments`, `refunds`, `security_events`, `provider_ledger` and two dozen
     * others is refused, without pinning which lock answered. This is the lock:
     * `authenticated` holds an INSERT or UPDATE privilege on exactly the
     * columns the allow-list names and on nothing else in the schema. Before
     * `20261011000004` that was false for 31 tables, all of them inert only
     * because no policy had been written — which is the state `payouts` was in
     * when it was briefly writable by a stranger through nothing anybody wrote.
     *
     * Derived from ALLOWED rather than spelled out, deliberately and unlike the
     * `anon` case below: there are 51 grants across five tables, the point is
     * that the schema and the list agree, and the list is itself asserted
     * column-by-column against the catalog three cases above.
     */
    const expected = Object.entries(ALLOWED)
      .flatMap(([table, entry]) =>
        entry.guards.flatMap((guard) =>
          guard.kind !== "column-grant"
            ? []
            : [
                ...(guard.insert ?? []).map((c) => `${table}.${c} INSERT`),
                ...(guard.update ?? []).map((c) => `${table}.${c} UPDATE`),
              ],
        ),
      )
      .sort();

    const { rows } = await pg.admin.query(`
      select table_name, privilege_type, column_name
        from information_schema.column_privileges
       where table_schema = 'public'
         and grantee = 'authenticated'
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    `);

    const found = (
      rows as { table_name: string; privilege_type: string; column_name: string }[]
    )
      .map((r) => `${r.table_name}.${r.column_name} ${r.privilege_type}`)
      .sort();

    expect(found).toEqual(expected);
  });

  it("gives a stranger seven columns of the join form and nothing else", async () => {
    /*
     * THE WHOLE-SCHEMA STATEMENT ABOUT `anon`, which no per-table case makes.
     *
     * Supabase's default privilege handed a logged-out visitor INSERT and
     * UPDATE on every column of every table in `public` — 85 on `bookings`, 22
     * on `provider_applications`, 16 on `addresses`. All of it was inert,
     * because `anon` has exactly one write policy in the product, and inert is
     * a property of the policies rather than of the privilege: one `anon`
     * INSERT policy added anywhere, for any reason, would have been live and
     * unguarded on arrival.
     *
     * So this is asked of the schema rather than of a list. The expected value
     * is spelled out rather than derived from ALLOWED, because a test that
     * reads the same constant the code reads asserts that a thing equals
     * itself — `ACTIVITY_FLOOR`'s blind tests are the recorded version of that
     * mistake.
     */
    const { rows } = await pg.admin.query(`
      select table_name, privilege_type, column_name
        from information_schema.column_privileges
       where table_schema = 'public'
         and grantee = 'anon'
         and privilege_type in ('INSERT', 'UPDATE')
       order by table_name, privilege_type, column_name
    `);

    expect(
      (rows as { table_name: string; privilege_type: string; column_name: string }[]).map(
        (r) => `${r.table_name}.${r.column_name} ${r.privilege_type}`,
      ),
    ).toEqual([
      "provider_leads.area_key INSERT",
      "provider_leads.category_slug INSERT",
      "provider_leads.full_name INSERT",
      "provider_leads.locale INSERT",
      "provider_leads.note INSERT",
      "provider_leads.phone INSERT",
      "provider_leads.years_experience INSERT",
    ]);
  });

  it("gives a stranger the same columns a signed-in visitor has on that form", async () => {
    // The join form is reachable either way — somebody with an account may
    // still be applying to work — so the two roles must not drift apart on it.
    expect(await grantedColumns("provider_leads", "INSERT", "anon")).toEqual(
      await grantedColumns("provider_leads", "INSERT", "authenticated"),
    );
  });

  it("names a grant before a trigger wherever both guard a table", () => {
    /*
     * ORDER IS THE LESSON FROM THE DRIFT, so it is pinned rather than left to
     * whoever edits the list next. A trigger can be rebuilt from a stale copy
     * and applied to one database — which is what happened, and cost production
     * three blocks of `enforce_booking_immutability` for weeks. A column
     * privilege has no second copy to go stale. Where a table has both, the
     * grant is the first line and the trigger is depth behind it.
     */
    for (const [table, entry] of Object.entries(ALLOWED)) {
      const kinds = entry.guards.map((g) => g.kind);
      const grant = kinds.indexOf("column-grant");
      const trigger = kinds.indexOf("trigger");
      if (grant === -1 || trigger === -1) continue;

      expect(grant, `${table} names its trigger before its grant`).toBeLessThan(
        trigger,
      );
    }
  });
});

/*
 * THE OTHER HALF, AND IT IS THE HALF THAT WAS MISSING WHEN `payouts` LEAKED.
 *
 * Everything above starts at `pg_policy`, because a grant Supabase makes to every
 * table in `public` cannot discriminate between tables. That reasoning was right
 * and it had a blind spot: a table with NO policies at all was invisible to it,
 * and the default grant made such a table fully writable by any browser. A
 * migration timed out after `create table public.payouts` and before its RLS
 * enable, and for as long as that lasted `anon` held SELECT, INSERT, UPDATE and
 * DELETE on a money-instruction table — through nothing anybody wrote.
 *
 * `20261002000001_default_privileges_closed.sql` closes the source: new tables
 * created by `postgres` grant nothing, so a half-applied migration leaves a table
 * nobody can reach. These two cases are what stop it being reopened — by a
 * dashboard click, a Supabase upgrade, or somebody clearing a `permission denied`
 * the quick way, which is exactly what Postgres's own HINT recommends.
 */
describe("a new table grants a browser nothing", () => {
  it("has no table default privilege for anon or authenticated", async () => {
    const { rows } = await pg.admin.query(`
      select unnest(d.defaclacl)::text as item
        from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace
       where n.nspname = 'public'
         and d.defaclobjtype = 'r'
    `);

    const browser = (rows as { item: string }[])
      .map((r) => r.item)
      .filter((item) => /^(anon|authenticated)=/.test(item));

    expect(
      browser,
      "A default privilege grants a browser role something on every new table. " +
        "Revoke it (see 20261002000001) and grant per table instead.",
    ).toEqual([]);
  });

  it("gives authenticated no privilege on a table created now", async () => {
    /*
     * THE CASE THAT CANNOT PASS FOR THE WRONG REASON. The one above reads the
     * catalog, and an empty `pg_default_acl` satisfies it whether the default was
     * revoked or never existed — so on its own it would have been green through
     * the whole incident. This asks the question a table actually gets asked.
     */
    await pg.admin.query("create table public.zz_grant_probe (id int)");
    try {
      const { rows } = await pg.admin.query(`
        select grantee, privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'zz_grant_probe'
           and grantee in ('anon', 'authenticated')
      `);

      expect(
        rows,
        "A brand-new table is writable from a browser before anybody has " +
          "written a policy for it. That is how public.payouts leaked.",
      ).toEqual([]);
    } finally {
      // Dropped either way: a probe table left behind would be a table with no
      // policies, which is the first case this file sweeps for.
      await pg.admin.query("drop table if exists public.zz_grant_probe");
    }
  });
});

/*
 * THE SAME QUESTION ONE OBJECT TYPE OVER, AND IT HAD ALREADY COST SOMETHING.
 *
 * `provider_outstanding` and `provider_balance` are `security definer`, so they
 * stand on top of RLS and answer to their own grant alone — and both carried
 * EXECUTE for `authenticated`, which let any signed-in customer name any
 * professional's id and read their debt and money position. Nobody granted it:
 * Supabase's default privilege on `public` hands every new FUNCTION to `anon`
 * and `authenticated` exactly as it did every new table, and
 * `20261002000001_default_privileges_closed.sql` closed the table half only.
 *
 * So `20260930000001` revoked the grant from those two while the mechanism that
 * produced it went on producing it. `20261016000003` closes the source, and
 * these three cases are what stop it reopening — the second for the reason the
 * table probe exists, and the third because a list of what MAY be called is the
 * only version of this that catches the eighth function.
 */
describe("a new function gives a browser nothing", () => {
  /** The helpers a POLICY calls, which must keep EXECUTE, each with why. */
  const POLICY_HELPERS: Record<string, string> = {
    is_admin:
      "Six policies call it. A policy expression runs with the CALLER's privileges, so revoking this breaks every admin read in the product — the Security Advisor asks for it anyway and the answer is no.",
    open_job_ids:
      "The open-job policy on bookings. Written once in SQL so the policy and lib/data cannot disagree about which jobs are open.",
    provider_can_serve:
      "The bookings policy reads addresses, which would re-enter bookings through its own policy; definer breaks that recursion.",
    provider_refused:
      "Keeps a refused job from being offered back to the professional who refused it, inside the open-job policy.",
    provider_serves:
      "The coverage check behind the claim policy and enforce_booking_immutability.",
    provider_works_trade:
      "The reassignment check on a claim, called from the policy.",
    session_is_verified:
      "The unverified-session clause added to the customer read policies in 20260911000001.",
  };

  it("has no function default privilege for anon or authenticated", async () => {
    const { rows } = await pg.admin.query(`
      select unnest(d.defaclacl)::text as item
        from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace
       where n.nspname = 'public'
         and d.defaclobjtype = 'f'
    `);

    const browser = (rows as { item: string }[])
      .map((r) => r.item)
      .filter((item) => /^(anon|authenticated)=/.test(item));

    expect(
      browser,
      "Every new function in public is callable from a browser. That is how " +
        "provider_balance came to be — a security definer function standing " +
        "on top of RLS with a grant nobody wrote.",
    ).toEqual([]);
  });

  it("gives a browser no EXECUTE on a function created now", async () => {
    /* The catalog case above is satisfied by a default that never existed, so
       it would have been green throughout. This asks what a function is
       actually asked. */
    await pg.admin.query(
      "create function public.zz_execute_probe() returns int language sql as $probe$ select 1 $probe$",
    );
    try {
      const { rows } = await pg.admin.query(`
        select r.rolname
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          cross join lateral aclexplode(p.proacl) a
          join pg_roles r on r.oid = a.grantee
         where n.nspname = 'public'
           and p.proname = 'zz_execute_probe'
           and a.privilege_type = 'EXECUTE'
           and r.rolname in ('anon', 'authenticated')
      `);

      expect(rows, "a brand-new function is callable from a browser").toEqual([]);
    } finally {
      await pg.admin.query("drop function if exists public.zz_execute_probe()");
    }
  });

  it("lets a browser call only the helpers a policy needs", async () => {
    /* THE INVERSE, which is the one that catches the eighth. The two cases
       above are about functions created from now on; this is about the set as
       it stands, and it goes red when a function gains EXECUTE however it got
       it — a dashboard click, a Supabase upgrade, or somebody clearing a
       `42501` the quick way. A trigger function is included deliberately: it
       cannot be called directly, but "inert" is a property of the return type
       rather than of the privilege, which is the reasoning this file refuses
       to accept one object type over. */
    const { rows } = await pg.admin.query(`
      select distinct p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join lateral aclexplode(p.proacl) a
        join pg_roles r on r.oid = a.grantee
       where n.nspname = 'public'
         and a.privilege_type = 'EXECUTE'
         and r.rolname in ('anon', 'authenticated')
       order by p.proname
    `);

    const callable = (rows as { proname: string }[]).map((r) => r.proname);
    const expected = Object.keys(POLICY_HELPERS).sort();

    expect(
      callable,
      "A function a browser may call that no policy needs. If it is " +
        "`security definer` it stands on top of RLS and answers to this grant " +
        "alone — ask who may call it and with whose id.",
    ).toEqual(expected);
  });

  it("names a reason for each helper, and names one that still exists", async () => {
    for (const [name, why] of Object.entries(POLICY_HELPERS)) {
      expect(why.length, `${name} has no reason recorded`).toBeGreaterThan(40);
      const { rows } = await pg.admin.query(
        "select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
        [name],
      );
      expect(rows.length, `${name} is listed and does not exist`).toBeGreaterThan(0);
    }
  });
});
