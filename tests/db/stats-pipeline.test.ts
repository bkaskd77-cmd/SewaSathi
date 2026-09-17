import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * `provider_stats`, computed from what happened.
 *
 * WHAT THIS REPLACES. Every figure a customer reads to choose who enters their
 * house was authored — 4.8s and 12-minute response times for people who have
 * never done a job — and the columns that were maintained were INCREMENTED. An
 * incremented counter cannot be reconciled: once it drifts nobody can tell by
 * looking, and the day a second path writes to it the same event counts twice.
 *
 * The property these tests are really pinning is IDEMPOTENCE. A recomputation
 * that gives a different answer the second time is an increment wearing a
 * different name, and every rule-6 guarantee here rests on the figure and its
 * denominator coming out of the same query.
 */

const CUSTOMER = "aaaaaaaa-9111-4111-8111-aaaaaaaaaaaa";
const PRO = "bbbbbbbb-9222-4222-8222-bbbbbbbbbbbb";

let pg: Harness;
let provider: string;
let address: string;
let counter = 0;

async function booking(input: {
  provider?: string | null;
  firstChoice?: string | null;
  status?: string;
  acceptedAfterMinutes?: number;
} = {}): Promise<string> {
  counter += 1;
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, first_choice_provider_id,
        category_slug, address_id, description, quoted_min, quoted_max,
        scheduled_for)
     values ($1, $2, $3, $4, 'plumbing', $5, 'Tap is dripping', 900, 4500, $6)
     returning id`,
    [
      `SK-ST${counter}`,
      CUSTOMER,
      input.provider ?? null,
      input.firstChoice ?? null,
      address,
      new Date(Date.UTC(2027, 5, counter, 8, 15)).toISOString(),
    ],
  );
  const id = rows[0].id as string;

  if (input.status) {
    const path = ["accepted", "en_route", "in_progress", "completed"];
    for (const step of path) {
      await pg.admin.query(
        "update public.bookings set status = $1 where id = $2",
        [step, id],
      );
      if (step === input.status) break;
    }
  }
  if (input.acceptedAfterMinutes !== undefined) {
    await pg.admin.query(
      `update public.bookings
          set accepted_at = created_at + ($1 || ' minutes')::interval
        where id = $2`,
      [String(input.acceptedAfterMinutes), id],
    );
  }
  return id;
}

async function stats() {
  await pg.admin.query("select public.refresh_provider_stats($1)", [provider]);
  const { rows } = await pg.admin.query(
    `select rating_avg, rating_count, jobs_completed, completion_rate,
            avg_response_minutes, response_samples, jobs_accepted,
            offers_made, offers_answered
       from public.provider_stats where provider_id = $1`,
    [provider],
  );
  const r = rows[0] ?? {};
  return {
    ratingAvg: Number(r.rating_avg ?? 0),
    ratingCount: Number(r.rating_count ?? 0),
    jobsCompleted: Number(r.jobs_completed ?? 0),
    completionRate: Number(r.completion_rate ?? 100),
    avgResponseMinutes: Number(r.avg_response_minutes ?? 120),
    responseSamples: Number(r.response_samples ?? 0),
    jobsAccepted: Number(r.jobs_accepted ?? 0),
    offersMade: Number(r.offers_made ?? 0),
    offersAnswered: Number(r.offers_answered ?? 0),
  };
}

async function clear(): Promise<void> {
  await pg.admin.query("delete from public.provider_reviews");
  await pg.admin.query("delete from public.bookings where reference like 'SK-ST%'");
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
      [id, name, `+9779819${id.slice(0, 6)}`, role],
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

describe("a provider with no history is UNMEASURED, not zero", () => {
  /*
   * RULE 6, AND THE WHOLE REASON THIS IS COMPUTED RATHER THAN DEFAULTED. Three
   * of these columns have defaults that read like facts — `completion_rate`
   * 100, `avg_response_minutes` 120, `rating_avg` 0 — and each one has already
   * misled either a customer or the ranking. What distinguishes them is the
   * DENOMINATOR beside them, which is why it comes out of the same query.
   */

  it("carries a zero denominator for every rate", async () => {
    await clear();
    const s = await stats();
    expect(s.ratingCount).toBe(0);
    expect(s.responseSamples).toBe(0);
    expect(s.jobsAccepted).toBe(0);
    expect(s.offersMade).toBe(0);
  });

  it("leaves completion at the default rather than inventing a measurement", async () => {
    // 100 with `jobs_accepted = 0` is the column default and `hasCompletion`
    // is the gate. Writing 0 instead would be a different lie, not a fix.
    await clear();
    const s = await stats();
    expect(s.completionRate).toBe(100);
    expect(s.jobsAccepted).toBe(0);
  });
});

describe("the numbers come from the bookings", () => {
  it("counts completed jobs and the rate over accepted ones", async () => {
    await clear();
    await booking({ provider, status: "completed" });
    await booking({ provider, status: "accepted" });

    const s = await stats();
    expect(s.jobsCompleted).toBe(1);
    expect(s.jobsAccepted).toBe(2);
    expect(s.completionRate).toBe(50);
  });

  it("measures response from when the job became theirs to answer", async () => {
    /*
     * NOT FROM `created_at` UNCONDITIONALLY. A job that sat with somebody else
     * first and was then opened belongs to this professional from `opened_at`
     * — charging them for another person's silence would make the fastest
     * responder on a re-dispatched job look like the slowest.
     */
    await clear();
    const id = await booking({ provider });
    await pg.admin.query(
      `update public.bookings
          set opened_at = created_at + interval '60 minutes',
              accepted_at = created_at + interval '70 minutes'
        where id = $1`,
      [id],
    );

    const s = await stats();
    expect(s.responseSamples).toBe(1);
    expect(s.avgResponseMinutes).toBe(10);
  });

  it("counts an offer answered whether they said yes OR no", async () => {
    /*
     * The standards publish turning work down as never-a-signal. A rate that
     * counted only acceptances would make that a lie — and would teach people
     * to ignore an offer rather than decline it, which is worse for the
     * customer than either.
     */
    await clear();
    await booking({ provider, firstChoice: provider, status: "accepted" });

    const declined = await booking({ firstChoice: provider, provider });
    await pg.admin.query(
      "update public.bookings set status = 'pending', provider_id = null where id = $1",
      [declined],
    );

    const s = await stats();
    expect(s.offersMade).toBe(2);
    expect(s.offersAnswered).toBe(2);
  });

  it("counts an offer nobody answered against the denominator only", async () => {
    await clear();
    await booking({ firstChoice: provider });
    const s = await stats();
    expect(s.offersMade).toBe(1);
    expect(s.offersAnswered).toBe(0);
  });
});

describe("only published, un-excluded reviews move the average", () => {
  async function review(input: {
    rating: number;
    published?: boolean;
    excluded?: boolean;
  }) {
    const id = await booking({ provider, status: "completed" });
    const { rows } = await pg.admin.query(
      `insert into public.provider_reviews
         (provider_id, booking_id, customer_id, author_name, rating, comment,
          submitted_at, published_at)
       values ($1, $2, $3, 'Sita', $4, 'Fine work', now(), $5)
       returning id`,
      [provider, id, CUSTOMER, input.rating, input.published === false ? null : new Date()],
    );
    if (input.excluded) {
      await pg.admin.query(
        `update public.provider_reviews
            set excluded_from_average_at = now(), excluded_by = $1
          where id = $2`,
        [CUSTOMER, rows[0].id],
      );
    }
    return rows[0].id as string;
  }

  it("ignores a review still sealed", async () => {
    await clear();
    await review({ rating: 1, published: false });
    const s = await stats();
    expect(s.ratingCount).toBe(0);
  });

  it("counts one that has published", async () => {
    await clear();
    await review({ rating: 5 });
    const s = await stats();
    expect(s.ratingCount).toBe(1);
    expect(s.ratingAvg).toBe(5);
  });

  it("drops an excluded one from the AVERAGE and leaves it on the page", async () => {
    /*
     * The two halves of the rule, together. A rating average is evidence and
     * must not move on an account a process contradicted; a review page is
     * testimony and must not lose anything.
     */
    await clear();
    await review({ rating: 5 });
    const excludedId = await review({ rating: 1, excluded: true });

    const s = await stats();
    expect(s.ratingCount).toBe(1);
    expect(s.ratingAvg).toBe(5);

    const { rows } = await pg.admin.query(
      "select id from public.provider_reviews where id = $1",
      [excludedId],
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses an exclusion nobody decided", async () => {
    // An exclusion with no name on it is the automatic suppression the column
    // exists to prevent, wearing a timestamp.
    await clear();
    const id = await review({ rating: 1 });
    await expect(
      pg.admin.query(
        "update public.provider_reviews set excluded_from_average_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/exclusion_needs_a_person/);
  });
});

describe("recomputing is idempotent", () => {
  it("gives the same answer the second time", async () => {
    /*
     * THE PROPERTY AN INCREMENT CANNOT HAVE, and the reason every counter here
     * is derived. If this ever fails, some column has gone back to being
     * added-to rather than computed and the numbers have started drifting away
     * from what happened.
     */
    await clear();
    await booking({ provider, status: "completed", firstChoice: provider });
    await booking({ provider, status: "accepted" });

    const first = await stats();
    const second = await stats();
    const third = await stats();
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});

describe("no authored fiction survives", () => {
  it("left no review without a booking behind it", async () => {
    /*
     * The 94 seeded reviews. Recomputing around them would have been worse
     * than leaving them: the pipeline would have been reporting a real average
     * over invented testimony, which is harder to notice than an obvious fake.
     */
    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.provider_reviews where booking_id is null",
    );
    expect(rows[0].n).toBe(0);
  });
});
