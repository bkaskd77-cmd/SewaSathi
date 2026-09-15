import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The same professional, twice, at two o'clock.
 *
 * Nothing refused it. The second customer was told somebody was coming, and
 * found out on the day that nobody was. `canServeAt` never covered this — it
 * answers "are they in a house right now", not "is that window already taken".
 *
 * IT IS A TRIGGER BECAUSE A BOOKING GAINS A PROFESSIONAL FIVE WAYS, so these
 * tests deliberately write through the SERVICE ROLE as well as through a
 * person's own session: a rule only the application enforces is a rule the
 * application can forget, and four of those five paths run under the key that
 * bypasses RLS entirely.
 */

const ANITA = "aaaaaaaa-7666-4666-8666-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb";

/** 14:00 Kathmandu, and the two-hour window that follows it. */
const TWO_PM = "2026-09-17T08:15:00Z";
const FOUR_PM = "2026-09-17T10:15:00Z";
const NEARLY_FOUR = "2026-09-17T10:14:00Z";

let pg: Harness;
let krishna: string;
let address: string;
let band: { low: number; high: number };
let counter = 0;

async function book(input: {
  provider: string | null;
  at: string | null;
  offered?: boolean;
}): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max, scheduled_for,
        overbook_offered_by, overbook_offered_at)
     values ($1, $2, $3, 'plumbing', $4, 'Tap is dripping', $5, $6, $7, $8, $9)
     returning id`,
    [
      `SK-CAP${(counter += 1)}`,
      ANITA,
      input.provider,
      address,
      band.low,
      band.high,
      input.at,
      input.offered ? input.provider : null,
      input.offered ? new Date().toISOString() : null,
    ],
  );
  return rows[0].id as string;
}

async function clear(): Promise<void> {
  await pg.admin.query("delete from public.bookings");
}

async function setCap(value: number): Promise<void> {
  await pg.admin.query(
    "update public.categories set max_concurrent_jobs = $1 where slug = 'plumbing'",
    [value],
  );
}

beforeAll(async () => {
  pg = await startPostgres();

  const { rows: cat } = await pg.admin.query(
    "select base_price_min, base_price_max from public.categories where slug = 'plumbing'",
  );
  band = {
    low: Number(cat[0].base_price_min),
    high: Number(cat[0].base_price_max),
  };

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779815${id.slice(0, 6)}`, role],
    );
  }

  const { rows: provider } = await pg.admin.query(
    `insert into public.providers
       (profile_id, display_name, base_rate, availability, standing, is_verified,
        service_areas)
     values ($1, 'Krishna Tamang', $2, 'now', 'established', true,
             array['lalitpur-4'])
     returning id`,
    [KRISHNA, band.low],
  );
  krishna = provider[0].id as string;
  await pg.admin.query(
    "insert into public.provider_categories (provider_id, category_slug) values ($1, 'plumbing')",
    [krishna],
  );

  const { rows: addr } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  address = addr[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("one professional, one window", () => {
  it("refuses a second booking at a capacity of one", async () => {
    await clear();
    await setCap(1);

    await book({ provider: krishna, at: TWO_PM });
    await expect(book({ provider: krishna, at: TWO_PM })).rejects.toThrow(
      /already booked for this time/,
    );
  });

  it("refuses it under the SERVICE ROLE too", async () => {
    /*
     * The important half. Four of the five paths that assign a professional
     * run under the service role, where RLS is not in play at all — a check
     * that only exists in a policy would let every one of them through.
     */
    await clear();
    await setCap(1);

    const first = await book({ provider: null, at: TWO_PM });
    await pg.admin.query(
      "update public.bookings set provider_id = $1 where id = $2",
      [krishna, first],
    );

    const second = await book({ provider: null, at: TWO_PM });
    await expect(
      pg.admin.query("update public.bookings set provider_id = $1 where id = $2", [
        krishna,
        second,
      ]),
    ).rejects.toThrow(/already booked for this time/);
  });

  it("allows a job starting exactly as the first one ends", async () => {
    // Half-open. A closed interval would read a full day of back-to-back work
    // as a day of conflicts and grey out a working schedule.
    await clear();
    await setCap(1);

    await book({ provider: krishna, at: TWO_PM });
    await expect(
      book({ provider: krishna, at: FOUR_PM }),
    ).resolves.toBeTruthy();
  });

  it("refuses one starting a minute before it ends", async () => {
    await clear();
    await setCap(1);

    await book({ provider: krishna, at: TWO_PM });
    await expect(book({ provider: krishna, at: NEARLY_FOUR })).rejects.toThrow(
      /already booked for this time/,
    );
  });

  it("ignores a finished job, which holds nobody's time", async () => {
    await clear();
    await setCap(1);

    const done = await book({ provider: krishna, at: TWO_PM });
    for (const status of ["accepted", "en_route", "in_progress", "completed"]) {
      await pg.admin.query(
        "update public.bookings set status = $1 where id = $2",
        [status, done],
      );
    }

    await expect(book({ provider: krishna, at: TWO_PM })).resolves.toBeTruthy();
  });

  it("lets a job it already allowed travel to completed", async () => {
    // The trigger re-checks on assignment and on schedule, never on status.
    // Re-judging an accepted job on its way through the machine would make
    // settling a payment raise on a row somebody was legitimately given.
    await clear();
    await setCap(2);

    const a = await book({ provider: krishna, at: TWO_PM });
    await book({ provider: krishna, at: TWO_PM });

    for (const status of ["accepted", "en_route", "in_progress", "completed"]) {
      await expect(
        pg.admin.query("update public.bookings set status = $1 where id = $2", [
          status,
          a,
        ]),
      ).resolves.toBeTruthy();
    }
  });
});

describe("two claims at the same moment", () => {
  it("cannot both land", async () => {
    /*
     * The count inside the trigger is a READ, and under read committed two
     * transactions each see zero taken, both pass, and both commit. The claim
     * policy settles a race for ONE booking; this is a race for one
     * professional's time across two, which no `using` clause can express —
     * the two claimants are not competing for the same row. The advisory lock
     * on the provider is what makes the second one wait and then see the
     * first.
     */
    await clear();
    await setCap(1);

    const a = await book({ provider: null, at: TWO_PM });
    const b = await book({ provider: null, at: TWO_PM });
    await pg.admin.query(
      "update public.bookings set opened_at = now() where id in ($1, $2)",
      [a, b],
    );

    const one = await pg.asUser(KRISHNA);
    const two = await pg.asUser(KRISHNA);

    await one.query("begin");
    await two.query("begin");

    const claim = (client: typeof one, id: string) =>
      client.query(
        "update public.bookings set provider_id = $1 where id = $2",
        [krishna, id],
      );

    await claim(one, a);
    const second = claim(two, b).then(
      () => "written" as const,
      (error: Error) => error,
    );

    /*
     * Give the second claim time to actually reach the server and run its
     * count BEFORE the first one commits. Without this the test passes for the
     * wrong reason — whichever order node happens to flush in — and a test
     * that only sometimes exercises the race is not a test of the race.
     */
    await new Promise((resolve) => setTimeout(resolve, 300));
    await one.query("commit");
    const outcome = await second;
    await two.query("rollback").catch(() => undefined);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/already booked for this time/);
  });
});

describe("the offer is the only way past the cap", () => {
  it("admits one more when the professional offered on that booking", async () => {
    await clear();
    await setCap(1);

    await book({ provider: krishna, at: TWO_PM });
    await expect(
      book({ provider: krishna, at: TWO_PM, offered: true }),
    ).resolves.toBeTruthy();
  });

  it("is worth exactly one seat and no more", async () => {
    // Otherwise offers stack until the cap is decorative.
    await clear();
    await setCap(1);

    await book({ provider: krishna, at: TWO_PM });
    await book({ provider: krishna, at: TWO_PM, offered: true });
    await expect(
      book({ provider: krishna, at: TWO_PM, offered: true }),
    ).rejects.toThrow(/already booked for this time/);
  });

  it("cannot be written by the customer from their own session", async () => {
    /*
     * NEVER CUSTOMER-INITIATED is the rule, and RLS cannot express it: the
     * cancel policy makes the row updatable and row-level means every column
     * on it. Without the trigger a customer stamps the offer on their own
     * booking and buys the extra seat — the rule becomes a checkbox.
     */
    await clear();
    await setCap(1);

    const id = await book({ provider: null, at: TWO_PM });
    const anita = await pg.asUser(ANITA);
    await expect(
      anita.query(
        "update public.bookings set overbook_offered_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/professional's to make/);
    await anita.end();
  });
});

describe("who may hold how many", () => {
  it("lets an admin-set override raise a listing above its category", async () => {
    // Movers is the case: a verified firm with three trucks is not one man
    // with a pickup, and a category number cannot tell them apart.
    await clear();
    await setCap(1);
    await pg.admin.query(
      "update public.providers set max_concurrent_jobs = 3 where id = $1",
      [krishna],
    );

    await book({ provider: krishna, at: TWO_PM });
    await book({ provider: krishna, at: TWO_PM });
    await expect(book({ provider: krishna, at: TWO_PM })).resolves.toBeTruthy();

    await pg.admin.query(
      "update public.providers set max_concurrent_jobs = null where id = $1",
      [krishna],
    );
  });

  it("caps that override at probation's two", async () => {
    // A new listing has not shown it can hold two jobs, let alone a firm's
    // three. The override is what an admin believes; probation is what we have
    // seen, and what we have seen wins.
    await clear();
    await setCap(3);
    await pg.admin.query(
      `update public.providers
          set max_concurrent_jobs = 3, standing = 'provisional'
        where id = $1`,
      [krishna],
    );

    await book({ provider: krishna, at: TWO_PM });
    await book({ provider: krishna, at: TWO_PM });
    await expect(book({ provider: krishna, at: TWO_PM })).rejects.toThrow(
      /already booked for this time/,
    );

    await pg.admin.query(
      `update public.providers
          set max_concurrent_jobs = null, standing = 'established'
        where id = $1`,
      [krishna],
    );
  });

  it("carries the ten category defaults the trades were agreed at", async () => {
    const { rows } = await pg.admin.query(
      "select slug, max_concurrent_jobs from public.categories order by slug",
    );
    const caps = Object.fromEntries(
      rows.map((r: { slug: string; max_concurrent_jobs: number }) => [
        r.slug,
        Number(r.max_concurrent_jobs),
      ]),
    );
    /*
     * One means the professional is physically in one place for the whole job.
     * Painting's 3 is the WORKAROUND — not three flats at once, but "do not
     * block a painter from a second job while the first one's putty dries".
     * The real answer is a duration field; see ARCHITECTURE.md.
     */
    expect(caps["home-cleaning"]).toBe(1);
    expect(caps["water-tank-cleaning"]).toBe(1);
    expect(caps["movers-packers"]).toBe(1);
    expect(caps["painting"]).toBe(3);
  });
});
