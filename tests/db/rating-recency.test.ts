import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recencyWeightedRating } from "@/lib/provider/recency";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The recency rule exists twice, and this is what keeps the two in step.
 *
 * WHY IT IS WRITTEN TWICE AT ALL. Ranking needs the weighted rating as an
 * AGGREGATE over a whole catalogue — one column per listing, read in a single
 * query — and the card needs it as a RULE over one listing's reviews, testable
 * without a database. So `refresh_provider_stats` computes it in SQL and
 * `recencyWeightedRating` computes it in TypeScript.
 *
 * TWO IMPLEMENTATIONS OF ONE RULE IS A FAULT THIS PRODUCT HAS ALREADY PAID FOR
 * — `materialsRead` and `enforce_claim_refund` diverged, and the fixture that
 * would have caught it did not exist. This is that fixture: one set of reviews,
 * both halves run over it, the answers compared. A tolerance is needed because
 * one side is a JavaScript double and the other a Postgres `numeric`, and
 * saying so is better than rounding until the difference disappears.
 */

const CUSTOMER = "aaaaaaaa-9444-4444-8444-aaaaaaaaaaaa";
const PRO = "bbbbbbbb-9555-4555-8555-bbbbbbbbbbbb";

let pg: Harness;
let provider: string;
let address: string;
let counter = 0;

/** A published review written `ageDays` ago. */
async function review(rating: number, ageDays: number): Promise<void> {
  counter += 1;
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max, scheduled_for)
     values ($1, $2, $3, 'plumbing', $4, 'The tap is dripping and will not stop', 900, 4500, $5)
     returning id`,
    [
      `SK-REC${counter}`,
      CUSTOMER,
      provider,
      address,
      new Date(Date.UTC(2027, 5, counter, 8, 15)).toISOString(),
    ],
  );
  /*
   * WALKED RATHER THAN INSERTED COMPLETE. `enforce_booking_transition` pins an
   * INSERT to `pending` — "A booking must start as pending" — so a fixture that
   * inserts a finished job is refused. The status machine is the product's, and
   * a test that routed around it would be testing a state no booking can reach.
   */
  for (const step of ["accepted", "en_route", "in_progress", "completed"]) {
    await pg.admin.query("update public.bookings set status = $1 where id = $2", [
      step,
      rows[0].id,
    ]);
  }
  await pg.admin.query(
    `insert into public.provider_reviews
       (provider_id, booking_id, customer_id, author_name, rating, comment,
        submitted_at, published_at)
     values ($1, $2, $3, 'Sita', $4, 'Fine work',
             now() - ($5 || ' days')::interval,
             now() - ($5 || ' days')::interval)`,
    [provider, rows[0].id, CUSTOMER, rating, String(ageDays)],
  );
}

async function stats(): Promise<{ avg: number | null; weight: number | null }> {
  await pg.admin.query("select public.refresh_provider_stats($1)", [provider]);
  const { rows } = await pg.admin.query(
    `select rating_recent_avg, rating_recent_weight
       from public.provider_stats where provider_id = $1`,
    [provider],
  );
  return {
    avg: rows[0].rating_recent_avg === null ? null : Number(rows[0].rating_recent_avg),
    weight:
      rows[0].rating_recent_weight === null
        ? null
        : Number(rows[0].rating_recent_weight),
  };
}

async function clear(): Promise<void> {
  await pg.admin.query("delete from public.provider_reviews");
  await pg.admin.query("delete from public.bookings where reference like 'SK-REC%'");
}

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [CUSTOMER, "Sita Rai", "customer"],
    [PRO, "Bikash Thapa", "provider"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4) on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779817${id.slice(0, 6)}`, role],
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
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the SQL and the TypeScript agree on one set of reviews", () => {
  /*
   * THE FIXTURE IS DELIBERATELY AWKWARD. Fresh reviews alone would agree under
   * any decay curve, including none at all, so the ages span four years and the
   * ratings disagree with each other — if the two halves used different
   * half-lives, different clamps or different rounding, this set separates
   * them. A set of identical fresh fives would not.
   */
  const FIXTURE: Array<[rating: number, ageDays: number]> = [
    [5, 0],
    [4, 40],
    [5, 200],
    [2, 400],
    [3, 800],
    [5, 1460],
  ];

  it("computes the same weighted average", async () => {
    await clear();
    for (const [rating, ageDays] of FIXTURE) await review(rating, ageDays);

    const live = await stats();
    const rule = recencyWeightedRating(
      FIXTURE.map(([rating, ageDays]) => ({ rating, ageDays })),
    );

    expect(live.avg).not.toBeNull();
    // Four places: `rating_recent_avg` is stored rounded to four, and the
    // difference beyond that is a double against a numeric rather than a
    // disagreement about the rule.
    expect(live.avg as number).toBeCloseTo(rule.avg as number, 3);
  });

  it("computes the same weight, which is the half that feeds the prior", async () => {
    const live = await stats();
    const rule = recencyWeightedRating(
      FIXTURE.map(([rating, ageDays]) => ({ rating, ageDays })),
    );
    expect(live.weight as number).toBeCloseTo(rule.weight, 3);
  });

  it("clamps a future review to today on both sides", async () => {
    /*
     * A row stamped forward must not be worth MORE than one written now, which
     * would be a way to buy a rating with a wrong timestamp. The TypeScript
     * clamps with `Math.max(0, …)` and the SQL with `greatest(0, …)`; a fixture
     * with only past dates would never exercise either.
     */
    await clear();
    await review(5, -400);

    const live = await stats();
    expect(live.weight as number).toBeCloseTo(1, 3);
    expect(recencyWeightedRating([{ rating: 5, ageDays: -400 }]).weight).toBe(1);
  });
});

describe("the columns say what is not computed", () => {
  it("leaves both null when nothing is published", async () => {
    /*
     * Rule 6 as the column holds it: null is "not computed", and a zero here
     * would be a rating of nought on a listing nobody has rated — the worst
     * score in the product, off no evidence at all.
     */
    await clear();
    const live = await stats();
    expect(live.avg).toBeNull();
    expect(live.weight).toBe(0);
  });

  it("ignores a sealed review and one taken out of the average", async () => {
    // The weighted figure must respect exactly the same two filters the flat
    // one does, or the card and the ranking would disagree about which reviews
    // count — which is the split `displayRating` was created to end.
    await clear();
    await review(5, 10);
    await pg.admin.query("update public.provider_reviews set published_at = null");
    expect((await stats()).avg).toBeNull();

    await pg.admin.query("update public.provider_reviews set published_at = now()");
    await pg.admin.query(
      "update public.provider_reviews set excluded_from_average_at = now(), excluded_by = $1",
      [CUSTOMER],
    );
    expect((await stats()).avg).toBeNull();
  });
});
