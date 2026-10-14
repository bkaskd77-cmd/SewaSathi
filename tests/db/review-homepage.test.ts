import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HOMEPAGE_HIDE_CODES } from "@/lib/reviews";

import { startPostgres, type Harness } from "../support/postgres";
import { BROWSER_WRITE_REFUSED } from "../support/refusals";

/**
 * Hiding a review from the homepage moves no rating, no average and no listing.
 *
 * WHY THIS IS A DATABASE TEST AND NOT A READING OF THE CODE. The promise is
 * that the one abusable button in the product cannot reach anything that
 * decides a professional's standing — and the way that promise breaks is a
 * future edit to `refresh_provider_stats` adding `homepage_hidden_at is null`
 * to its filter, which would look like tidying and would silently turn a
 * moderation tool into a ranking tool. Nobody reviewing that diff would catch
 * it from the SQL alone. So the invariant is asserted over the real function:
 * compute the averages, hide the worst review, compute them again, and demand
 * every figure is identical.
 *
 * THE FIXTURE IS DELIBERATELY LOPSIDED — a one-star among fives — because a set
 * of equal ratings would agree before and after under any filter at all. Same
 * reasoning as `rating-recency`'s awkward fixture: a case that passes whatever
 * the code does is not a case.
 *
 * PROVED BY BREAKING IT: adding that clause to the function's `where` turns the
 * first case red on both columns.
 */

const CUSTOMER = "aaaaaaaa-9666-4666-8666-aaaaaaaaaaaa";
const PRO = "bbbbbbbb-9777-4777-8777-bbbbbbbbbbbb";
const ADMIN = "cccccccc-9888-4888-8888-cccccccccccc";

let pg: Harness;
let provider: string;
let address: string;
let counter = 0;

async function review(rating: number): Promise<string> {
  counter += 1;
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max, scheduled_for)
     values ($1, $2, $3, 'plumbing', $4, 'The tap is dripping and will not stop', 900, 4500, $5)
     returning id`,
    [
      `SK-HID${counter}`,
      CUSTOMER,
      provider,
      address,
      new Date(Date.UTC(2027, 7, counter, 8, 15)).toISOString(),
    ],
  );

  // Walked, not inserted complete: `enforce_booking_transition` pins an INSERT
  // to `pending`.
  for (const step of ["accepted", "en_route", "in_progress", "completed"]) {
    await pg.admin.query("update public.bookings set status = $1 where id = $2", [
      step,
      rows[0].id,
    ]);
  }

  const { rows: r } = await pg.admin.query(
    `insert into public.provider_reviews
       (provider_id, booking_id, customer_id, author_name, rating, comment,
        submitted_at, published_at)
     values ($1, $2, $3, 'Sita', $4, 'Fine work', now(), now())
     returning id`,
    [provider, rows[0].id, CUSTOMER, rating],
  );
  return r[0].id as string;
}

type Figures = {
  avg: number | null;
  count: number | null;
  recentAvg: number | null;
  recentWeight: number | null;
};

async function figures(): Promise<Figures> {
  await pg.admin.query("select public.refresh_provider_stats($1)", [provider]);
  const { rows } = await pg.admin.query(
    `select rating_avg, rating_count, rating_recent_avg, rating_recent_weight
       from public.provider_stats where provider_id = $1`,
    [provider],
  );
  const num = (v: unknown) => (v === null ? null : Number(v));
  return {
    avg: num(rows[0].rating_avg),
    count: num(rows[0].rating_count),
    recentAvg: num(rows[0].rating_recent_avg),
    recentWeight: num(rows[0].rating_recent_weight),
  };
}

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [CUSTOMER, "Sita Rai", "customer"],
    [PRO, "Bikash Thapa", "provider"],
    [ADMIN, "Asha Admin", "admin"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4) on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779816${id.slice(0, 6)}`, role],
    );
  }

  const { rows: p } = await pg.admin.query(
    `insert into public.providers
       (profile_id, display_name, base_rate, availability, standing,
        is_verified, service_areas)
     values ($1, 'Bikash Thapa', 900, 'now', 'established', true,
             array['lalitpur-4'])
     returning id`,
    [PRO],
  );
  provider = p[0].id as string;
  await pg.admin.query(
    "insert into public.provider_categories (provider_id, category_slug) values ($1, 'plumbing')",
    [provider],
  );

  const { rows: a } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [CUSTOMER],
  );
  address = a[0].id as string;
});

afterAll(async () => {
  await pg?.stop();
});

describe("hiding a review from the homepage changes nothing about the rating", () => {
  it("leaves every average and every count exactly where it was", async () => {
    const worst = await review(1);
    await review(5);
    await review(5);
    await review(5);

    const before = await figures();
    // A lopsided fixture, or this case would pass under any filter.
    expect(before.avg).toBeCloseTo(4, 6);
    expect(before.count).toBe(4);

    await pg.admin.query(
      `update public.provider_reviews
          set homepage_hidden_at = now(), homepage_hidden_by = $2,
              homepage_hidden_code = 'abusive',
              homepage_hidden_reason = 'Names another customer by name'
        where id = $1`,
      [worst, ADMIN],
    );

    const after = await figures();

    /*
     * IDENTICAL, NOT MERELY CLOSE. If the one-star had left the average this
     * would read 5.0 — which is exactly the shape of the abuse the design
     * refuses, and exactly what a stray `homepage_hidden_at is null` in
     * `refresh_provider_stats` would produce.
     */
    expect(after).toEqual(before);
  });

  it("leaves the review readable on the listing, which is the other half", async () => {
    /*
     * A rating average is evidence and must not be moved by a decision about
     * the front page; a review page is testimony and must not lose anything —
     * the sentence `excluded_from_average_at` already carries. `anon` reads
     * published reviews, and a hidden one is still published.
     */
    const anon = await pg.asAnon();
    const { rows } = await anon.query(
      `select id, rating, homepage_hidden_at
         from public.provider_reviews
        where provider_id = $1 and rating = 1`,
      [provider],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].homepage_hidden_at).not.toBeNull();
  });
});

describe("a hide needs a person, a code and a sentence", () => {
  it("refuses a timestamp with no decider", async () => {
    await expect(
      pg.admin.query(
        `update public.provider_reviews set homepage_hidden_at = now()
          where provider_id = $1 and rating = 5`,
        [provider],
      ),
    ).rejects.toThrow(/homepage_hide_needs_a_person/);
  });

  it("refuses a decision with no reason given", async () => {
    await expect(
      pg.admin.query(
        `update public.provider_reviews
            set homepage_hidden_at = now(), homepage_hidden_by = $2,
                homepage_hidden_code = 'abusive'
          where provider_id = $1 and rating = 5`,
        [provider, ADMIN],
      ),
    ).rejects.toThrow(/homepage_hide_needs_a_person/);
  });

  it("refuses a code nobody published", async () => {
    /*
     * THE ONE THAT MATTERS: `negative` is the code this design exists to make
     * unavailable, and the database is the layer that refuses it rather than
     * the screen — a screen can be bypassed by anything holding the service
     * role, which is every write path in this product.
     */
    await expect(
      pg.admin.query(
        `update public.provider_reviews
            set homepage_hidden_at = now(), homepage_hidden_by = $2,
                homepage_hidden_code = 'negative',
                homepage_hidden_reason = 'Only two stars'
          where provider_id = $1 and rating = 5`,
        [provider, ADMIN],
      ),
    ).rejects.toThrow(/homepage_hidden_code_check/);
  });

  it("offers exactly the codes the constraint admits", async () => {
    /*
     * ONE LIST WRITTEN TWICE, compared out of `pg_constraint` rather than out
     * of a migration file — `bookings_band_source_check`'s lesson, where the
     * constraint is dropped and re-added by four different migrations. A chip
     * the screen offers whose write the database refuses loses the decision in
     * the same statement that records it.
     */
    const { rows } = await pg.admin.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.provider_reviews'::regclass
          and conname = 'provider_reviews_homepage_hidden_code_check'`,
    );

    const def = String(rows[0].def);
    for (const code of HOMEPAGE_HIDE_CODES) {
      expect(def, `the constraint must admit ${code}`).toContain(`'${code}'`);
    }
    // And nothing beyond them: one quoted literal per code.
    expect((def.match(/'[a-z_]+'::text/g) ?? []).length).toBe(
      HOMEPAGE_HIDE_CODES.length,
    );
  });
});

describe("a browser cannot hide a review at all", () => {
  it("refuses the write to a signed-in customer, their own review included", async () => {
    /*
     * `provider_reviews` has no UPDATE policy for anybody and
     * `20261011000004` revoked the schema-wide grant, so this is refused before
     * a row is considered. Asserted as BEHAVIOUR — which lock answers is
     * Postgres's ordering rather than the guarantee — using the one
     * `BROWSER_WRITE_REFUSED` the suite shares, because three spellings of that
     * regex had already begun to drift.
     */
    const browser = await pg.asUser(CUSTOMER);
    await expect(
      browser.query(
        `update public.provider_reviews
            set homepage_hidden_at = now(), homepage_hidden_by = $1,
                homepage_hidden_code = 'irrelevant',
                homepage_hidden_reason = 'I changed my mind'
          where customer_id = $1`,
        [CUSTOMER],
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });
});
