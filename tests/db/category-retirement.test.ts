import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";
import { BROWSER_WRITE_REFUSED } from "../support/refusals";

/**
 * A trade withdrawn, never deleted — and one that can still be named.
 *
 * `is_active` HAS BEEN ON THIS TABLE SINCE THE FIRST MIGRATION AND NOTHING
 * COULD WRITE IT. It gates the table's own policy and `getCategories`' query,
 * so withdrawing a trade meant a migration: `applyRedoRecovery`'s four-phase
 * sin in the shape of a column. The three columns beside it are what make a
 * withdrawal answerable — "why did we stop selling water tank cleaning" is
 * exactly the question it raises.
 *
 * THE PAIR IS THE INTERESTING PART. `is_active` and `retired_at` are one fact
 * in two columns — this repo's most-repeated sin — and they cannot be collapsed:
 * the policy and the catalogue query both name `is_active`, and making it a
 * GENERATED column means dropping and re-adding it. So
 * `categories_retired_shape` enforces `is_active = (retired_at is null)`, and
 * the cases below are written against each half separately, because a
 * constraint that only ever saw them move together would pass while permitting
 * the state that breaks the catalogue.
 *
 * AND THE POLICY READS EVERY ROW, which is the bug this work found rather than
 * a widening for its own sake. Every booking ever taken holds a
 * `category_slug` with no foreign key behind it, and both `/bookings/[id]` and
 * `/provider/jobs` print the bare slug when the lookup misses — so hiding a
 * withdrawn trade from `anon` would have put `water-tank-cleaning` on a
 * customer's own booking page.
 */

const ADMIN = "dddddddd-9444-4444-8444-dddddddddddd";

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.admin.query("insert into auth.users (id) values ($1)", [ADMIN]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, 'Admin', '+9779813000555', 'admin')
     on conflict (id) do update set role = excluded.role`,
    [ADMIN],
  );
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

async function standing(slug: string) {
  const { rows } = await pg.admin.query(
    `select is_active, retired_at, retired_reason, retired_by
       from public.categories where slug = $1`,
    [slug],
  );
  return rows[0];
}

describe("the catalogue starts with nothing withdrawn", () => {
  it("has every seeded trade active, with a null triple", async () => {
    const { rows } = await pg.admin.query(
      `select count(*)::int as n from public.categories
        where is_active is not true
           or retired_at is not null
           or retired_reason is not null
           or retired_by is not null`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("a withdrawal is a flag, a date, a reason and an actor together", () => {
  it("refuses is_active = false on its own", async () => {
    /*
     * THE CASE THAT MATTERS MOST. This is the write the product could already
     * do before any of this existed — flip the boolean, record nothing — and it
     * is the state that makes a withdrawal unanswerable six months later.
     */
    await expect(
      pg.admin.query(
        "update public.categories set is_active = false where slug = 'carpentry'",
      ),
    ).rejects.toThrow(/categories_retired_shape/);
  });

  it("refuses a date while the trade is still active", async () => {
    /* The other half of the pair: a retirement date on a row the catalogue
       query still returns would sell a trade the screen calls withdrawn. */
    await expect(
      pg.admin.query(
        `update public.categories
            set retired_at = now(), retired_reason = 'no longer offered'
          where slug = 'carpentry'`,
      ),
    ).rejects.toThrow(/categories_retired_shape/);
  });

  it("refuses a date with no reason", async () => {
    await expect(
      pg.admin.query(
        `update public.categories set is_active = false, retired_at = now()
          where slug = 'carpentry'`,
      ),
    ).rejects.toThrow(/categories_retired_shape/);
  });

  it("refuses a blank reason", async () => {
    /* "   " satisfies not-null and says nothing, which is the whole point of
       requiring one. */
    await expect(
      pg.admin.query(
        `update public.categories
            set is_active = false, retired_at = now(), retired_reason = '   '
          where slug = 'carpentry'`,
      ),
    ).rejects.toThrow(/categories_retired_shape/);
  });

  it("refuses a reason with no date", async () => {
    await expect(
      pg.admin.query(
        `update public.categories set retired_reason = 'nobody does it'
          where slug = 'carpentry'`,
      ),
    ).rejects.toThrow(/categories_retired_shape/);
  });

  it("accepts the whole set, and lets it be lifted again", async () => {
    await pg.admin.query(
      `update public.categories
          set is_active = false, retired_at = now(),
              retired_reason = 'no carpenter has taken a job since June',
              retired_by = $1
        where slug = 'carpentry'`,
      [ADMIN],
    );

    const after = await standing("carpentry");
    expect(after.is_active).toBe(false);
    expect(after.retired_at).not.toBeNull();
    expect(after.retired_reason).toBe(
      "no carpenter has taken a job since June",
    );
    expect(after.retired_by).toBe(ADMIN);

    /* NOT A ONE-WAY DOOR. A trade withdrawn by mistake must not need a
       migration to come back. */
    await pg.admin.query(
      `update public.categories
          set is_active = true, retired_at = null, retired_reason = null,
              retired_by = null
        where slug = 'carpentry'`,
    );
    const back = await standing("carpentry");
    expect(back.is_active).toBe(true);
    expect(back.retired_at).toBeNull();
    expect(back.retired_reason).toBeNull();
  });
});

describe("a withdrawn trade can still be named", () => {
  it("lets a signed-out visitor read it, retired or not", async () => {
    /*
     * THE REGRESSION THIS EXISTS FOR. `bookings.category_slug` has no foreign
     * key, `/bookings/[id]` and `/provider/jobs` both fall back to printing the
     * slug, so a trade invisible to `anon` means a finished job that cannot say
     * what it was. Which rows are SOLD is the catalogue query's filter — RLS is
     * a floor, not a filter.
     */
    await pg.admin.query(
      `update public.categories
          set is_active = false, retired_at = now(),
              retired_reason = 'testing the read'
        where slug = 'water-tank-cleaning'`,
    );

    const anon = await pg.asAnon();
    const { rows } = await anon.query(
      `select slug, is_active, retired_at from public.categories
        where slug in ('plumbing','water-tank-cleaning') order by slug`,
    );
    expect(rows).toHaveLength(2);
    const withdrawn = rows.find((r) => r.slug === "water-tank-cleaning")!;
    expect(withdrawn.is_active).toBe(false);
    expect(withdrawn.retired_at).not.toBeNull();

    await pg.admin.query(
      `update public.categories
          set is_active = true, retired_at = null, retired_reason = null
        where slug = 'water-tank-cleaning'`,
    );
  });

  it("keeps a booking in a withdrawn trade readable and unchanged", async () => {
    /*
     * FORWARD ONLY, ASSERTED RATHER THAN ARGUED. The claim is that withdrawing
     * a trade changes nothing that already happened, and `category_slug` has no
     * foreign key — so the thing to prove is that the row is still there,
     * still names the trade, and that no cascade touched it.
     */
    const { rows: before } = await pg.admin.query(
      `select count(*)::int as n from public.bookings
        where category_slug = 'painting'`,
    );

    await pg.admin.query(
      `update public.categories
          set is_active = false, retired_at = now(),
              retired_reason = 'checking nothing cascades'
        where slug = 'painting'`,
    );

    const { rows: after } = await pg.admin.query(
      `select count(*)::int as n from public.bookings
        where category_slug = 'painting'`,
    );
    expect(after[0].n).toBe(before[0].n);

    await pg.admin.query(
      `update public.categories
          set is_active = true, retired_at = null, retired_reason = null
        where slug = 'painting'`,
    );
  });
});

describe("who may write it", () => {
  it("lets no browser withdraw a trade", async () => {
    /* Every write is the service role through `lib/data/categories-admin.ts`,
       behind a fresh second factor — withdrawing a trade stops every future
       booking in it. */
    const anon = await pg.asAnon();
    await expect(
      anon.query(
        `update public.categories set is_active = false, retired_at = now(),
            retired_reason = 'from a browser' where slug = 'plumbing'`,
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);

    const signedIn = await pg.asUser(ADMIN);
    await expect(
      signedIn.query(
        `update public.categories set is_active = false, retired_at = now(),
            retired_reason = 'from an admin browser' where slug = 'plumbing'`,
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });

  it("lets no browser open one either", async () => {
    const anon = await pg.asAnon();
    await expect(
      anon.query(
        `insert into public.categories
           (slug, name_en, name_ne, descriptor, description, cta_label,
            base_price_min, base_price_max, icon, sort_order)
         values ('anon-trade','X','X','x','x','x',1,2,'Wrench',999)`,
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });
});
