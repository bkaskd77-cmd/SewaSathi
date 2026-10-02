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
 * THE GRANT IS NOT THE DISCRIMINATOR AND THAT IS THE THING TO UNDERSTAND.
 * Supabase hands `anon` and `authenticated` INSERT and UPDATE on every table in
 * `public` through a default privilege, so the privilege is always there and
 * listing tables that have it would list all of them. What decides whether a
 * browser can actually write is the POLICY. So the sweep starts at `pg_policy`,
 * and the allow-list below is the set of tables where a write policy exists.
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
});

describe("every declared guard is still there", () => {
  it("has the trigger each trigger-guarded table names", async () => {
    for (const [table, entry] of Object.entries(ALLOWED)) {
      if (entry.guard.kind !== "trigger") continue;

      const { rows } = await pg.admin.query(
        `select t.tgname, t.tgenabled
           from pg_trigger t
          where t.tgrelid = ('public.' || $1)::regclass
            and not t.tgisinternal
            and t.tgname = $2`,
        [table, entry.guard.name],
      );

      expect(rows, `${table} lost ${entry.guard.name}`).toHaveLength(1);
      // 'D' is disabled. A trigger that is present and switched off guards
      // nothing, and reads in the catalog exactly like one that works.
      expect(rows[0].tgenabled, `${entry.guard.name} is disabled`).not.toBe("D");
    }
  });

  it("keeps each column-granted table narrowed to exactly its columns", async () => {
    for (const [table, entry] of Object.entries(ALLOWED)) {
      if (entry.guard.kind !== "column-grant") continue;

      const { rows } = await pg.admin.query(
        `select column_name
           from information_schema.column_privileges
          where table_schema = 'public'
            and table_name = $1
            and grantee = 'authenticated'
            and privilege_type = 'UPDATE'
          order by column_name`,
        [table],
      );

      expect(
        rows.map((r: { column_name: string }) => r.column_name),
        `${table}'s UPDATE grant is not the set it declares`,
      ).toEqual(entry.guard.columns);
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
      if (entry.guard.kind !== "policy-both-sides") continue;

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
