import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";
import { BROWSER_WRITE_REFUSED } from "../support/refusals";

/**
 * The soft-launch scope: one row, locked down, and seeded off.
 *
 * WHAT THE DATABASE HAS TO GUARANTEE HERE, as against what the application
 * decides. The rule — which wards and trades are open — is TypeScript, tested
 * in `tests/unit/launch-scope.test.ts`, because four surfaces need it and a
 * `now()`-style copy in SQL would be a second rule that could disagree. What
 * the database owns is narrower and all of it is here:
 *
 *   - exactly one row, so no caller has to know an id and no second row can
 *     appear to disagree with the first;
 *   - no browser may write it, because a row that opens or closes the whole
 *     product is not a row a signed-in customer's browser gets to touch;
 *   - the browser may read only the three columns the catalogue needs, so
 *     `note` (an internal plan) and `updated_by` (a staff profile id) stay off
 *     the open internet;
 *   - the seeded row exists and is OFF, which is what makes "no rows" legible
 *     as a failed read rather than as "no scope".
 */

const CUSTOMER = "dddddddd-7111-4111-8111-dddddddddddd";

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.admin.query("insert into auth.users (id) values ($1)", [CUSTOMER]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, 'Customer', '+9779813000555', 'customer')
     on conflict (id) do nothing`,
    [CUSTOMER],
  );
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the launch scope is one row, and it starts off", () => {
  it("is seeded, disabled, with both lists empty", async () => {
    /*
     * THE SEED IS WHAT MAKES A FAILED READ LEGIBLE. `launchScope()` treats zero
     * rows as a read failure and refuses, because otherwise an empty table and
     * "the scope is off" are the same answer — and only one of them should open
     * every ward. Asserting the row exists is asserting that the normal state
     * is distinguishable from the broken one.
     *
     * AND IT IS OFF, so applying this migration changed no behaviour. A seed
     * that arrived enabled with empty lists would have closed the product on
     * deploy.
     */
    const { rows } = await pg.admin.query(
      "select id, enabled, area_keys, category_slugs, note from public.launch_scope",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(true);
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].area_keys).toEqual([]);
    expect(rows[0].category_slugs).toEqual([]);
    expect(rows[0].note).toBeNull();
  });

  it("refuses a second row", async () => {
    /*
     * `launch_scope_singleton` is `check (id)` over a boolean primary key, so
     * the only two possible rows are `true` (taken by the seed, refused by the
     * key) and `false` (refused by the check). Both are asserted, because a
     * check that only ever saw the primary key do the work would pass while
     * permitting the row that makes every read ambiguous.
     */
    await expect(
      pg.admin.query("insert into public.launch_scope (id) values (false)"),
    ).rejects.toThrow(/launch_scope_singleton/);

    await expect(
      pg.admin.query("insert into public.launch_scope (id) values (true)"),
    ).rejects.toThrow(/duplicate key|launch_scope_pkey/i);
  });

  it("keeps the lists NOT NULL, so an absent list cannot mean anything", async () => {
    /* Rule 6 at the column level: a null `area_keys` would be a third state
       between "no scope" and "nothing open", and every reader would have to
       guess which. The default is `'{}'` and the column refuses null. */
    await expect(
      pg.admin.query("update public.launch_scope set area_keys = null"),
    ).rejects.toThrow(/null value|not-null/i);
  });
});

describe("no browser writes it, and it reads only what the catalogue needs", () => {
  it("refuses an update from a signed-in customer", async () => {
    /*
     * THE WRITE THAT MATTERS. A browser that could set `enabled = false` would
     * open every ward and every trade in the country; one that could empty the
     * arrays would close the product. There is no write policy and no column
     * grant, so the planner refuses before a row is considered.
     */
    const signedIn = await pg.asUser(CUSTOMER);

    await expect(
      signedIn.query("update public.launch_scope set enabled = true"),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);

    await expect(
      signedIn.query("update public.launch_scope set area_keys = '{kathmandu-4}'"),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });

  it("refuses an insert and a delete from a browser too", async () => {
    /* No DELETE policy anywhere in this schema and no grant here, so both are
       refused — and a delete would be worse than an update, since it is the
       state every read is built to treat as a failure. */
    const signedIn = await pg.asUser(CUSTOMER);

    await expect(
      signedIn.query("insert into public.launch_scope (id) values (false)"),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);

    await expect(
      signedIn.query("delete from public.launch_scope"),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });

  it("lets anybody read the three columns the catalogue needs", async () => {
    /* The landing grid, `/services`, every category page and the booking flow
       read this as `anon` through the cookie-free client, so the policy is
       `using (true)` — the row is a switch and two lists of public identifiers. */
    const signedIn = await pg.asUser(CUSTOMER);
    const { rows } = await signedIn.query(
      "select enabled, area_keys, category_slugs from public.launch_scope",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);
  });

  it("does not grant `note` or `updated_by` to a browser", async () => {
    /*
     * THE COLUMNS, NOT THE TABLE — `profiles`' lesson applied before it became
     * a finding here. `note` is an internal plan ("starting in Patan while we
     * recruit") and `updated_by` is a staff profile id; a plain `grant select`
     * would have put both on the open internet for no reason.
     *
     * Asserted as the GRANT rather than as a failing select, because PostgREST
     * is what the product reads through and a column privilege is the only
     * thing standing in front of it — the policy is `using (true)`.
     */
    const { rows } = await pg.admin.query(
      `select column_name
         from information_schema.column_privileges
        where table_schema = 'public'
          and table_name = 'launch_scope'
          and grantee in ('anon', 'authenticated')
          and privilege_type = 'SELECT'
        group by column_name
        order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "area_keys",
      "category_slugs",
      "enabled",
    ]);
  });
});
