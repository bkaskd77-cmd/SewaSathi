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

/**
 * The cap now comes from the listing, not the trade.
 *
 * `categories.max_concurrent_jobs` set this until the scheduler measured job
 * length; every category value above 1 was a workaround for the missing
 * duration model rather than a statement about crews. Written across every
 * listing so a test that books through the open pool gets the same cap
 * whoever claims it.
 */
async function setCrew(value: number | null): Promise<void> {
  await pg.admin.query("update public.providers set crew_count = $1", [value]);
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
    await setCrew(1);

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
    await setCrew(1);

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
    await setCrew(1);

    await book({ provider: krishna, at: TWO_PM });
    await expect(
      book({ provider: krishna, at: FOUR_PM }),
    ).resolves.toBeTruthy();
  });

  it("refuses one starting a minute before it ends", async () => {
    await clear();
    await setCrew(1);

    await book({ provider: krishna, at: TWO_PM });
    await expect(book({ provider: krishna, at: NEARLY_FOUR })).rejects.toThrow(
      /already booked for this time/,
    );
  });

  it("ignores a finished job, which holds nobody's time", async () => {
    await clear();
    await setCrew(1);

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
    await setCrew(2);

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
    await setCrew(1);

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
    await setCrew(1);

    await book({ provider: krishna, at: TWO_PM });
    await expect(
      book({ provider: krishna, at: TWO_PM, offered: true }),
    ).resolves.toBeTruthy();
  });

  it("is worth exactly one seat and no more", async () => {
    // Otherwise offers stack until the cap is decorative.
    await clear();
    await setCrew(1);

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
    await setCrew(1);

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
  it("lets an admin-set crew raise a listing above one", async () => {
    // Movers is the case: a verified firm with three trucks is not one man
    // with a pickup. It used to be an override on top of a category number;
    // the category has no opinion now, so the crew IS the number.
    await clear();
    await setCrew(3);

    await book({ provider: krishna, at: TWO_PM });
    await book({ provider: krishna, at: TWO_PM });
    await expect(book({ provider: krishna, at: TWO_PM })).resolves.toBeTruthy();

    await setCrew(null);
  });

  it("gives an unset crew exactly one seat", async () => {
    /*
     * NULL IS ONE, and this is the case the dropped column could have broken
     * quietly. Plumbing's category default was 2 and painting's was 3, so a
     * lone professional in either trade used to hold two or three overlapping
     * jobs. With the trade's vote gone they hold one, and the length of the
     * job decides the rest — which is the whole point of the split.
     */
    await clear();
    await setCrew(null);

    await book({ provider: krishna, at: TWO_PM });
    await expect(book({ provider: krishna, at: TWO_PM })).rejects.toThrow(
      /already booked for this time/,
    );
  });

  it("caps that crew at probation's two", async () => {
    // A new listing has not shown it can hold two jobs, let alone a firm's
    // three. The crew is what an admin believes; probation is what we have
    // seen, and what we have seen wins.
    await clear();
    await setCrew(3);
    await pg.admin.query(
      "update public.providers set standing = 'provisional' where id = $1",
      [krishna],
    );

    await book({ provider: krishna, at: TWO_PM });
    await book({ provider: krishna, at: TWO_PM });
    await expect(book({ provider: krishna, at: TWO_PM })).rejects.toThrow(
      /already booked for this time/,
    );

    await pg.admin.query(
      "update public.providers set standing = 'established' where id = $1",
      [krishna],
    );
    await setCrew(null);
  });

  it("no longer lets a trade have an opinion about it", async () => {
    /*
     * THE COLUMN IS GONE, asserted rather than assumed. It held two facts:
     * job length, which `estimated_working_minutes` and the interval scheduler
     * model directly now, and crew size, which moved to providers.crew_count.
     * A column still sitting there would invite the next reader to set
     * painting back to 3 because a painter is idle while putty dries.
     */
    const { rows } = await pg.admin.query(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'categories'
          and column_name = 'max_concurrent_jobs'`,
    );
    expect(rows).toHaveLength(0);

    const { rows: crew } = await pg.admin.query(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'providers'
          and column_name in ('crew_count', 'max_concurrent_jobs')`,
    );
    // Renamed, not added beside the old one — two columns would drift.
    expect(crew).toHaveLength(1);
    expect(crew[0].column_name).toBe("crew_count");
    // Null has to stay reachable: it is what "nobody has verified a crew"
    // means, and it is every listing until an admin says otherwise.
    expect(crew[0].is_nullable).toBe("YES");
  });
});

describe("an offer is counted, and a miss is not a refusal", () => {
  /*
   * `overbookRankingPenalty` is a rate with a floor at ten offers, and the
   * floor is only meaningful if the denominator is counted everywhere. These
   * counters are written by triggers for the same reason `booking_refusals` is:
   * a counter today's button increments is a counter tomorrow's path forgets.
   */

  async function statsFor(): Promise<{ offers: number; misses: number; withdrawals: number }> {
    const { rows } = await pg.admin.query(
      "select overbook_offers, overbook_misses, withdrawals from public.provider_stats where provider_id = $1",
      [krishna],
    );
    return {
      offers: Number(rows[0]?.overbook_offers ?? 0),
      misses: Number(rows[0]?.overbook_misses ?? 0),
      withdrawals: Number(rows[0]?.withdrawals ?? 0),
    };
  }

  it("counts the moment an offer appears, and only then", async () => {
    await clear();
    await setCrew(1);
    const before = await statsFor();

    const id = await book({ provider: null, at: TWO_PM });
    await pg.admin.query(
      "update public.bookings set overbook_offered_by = $1, overbook_offered_at = now() where id = $2",
      [krishna, id],
    );
    expect((await statsFor()).offers).toBe(before.offers + 1);

    // Clearing one — a claim that lost its race — must not count backwards.
    await pg.admin.query(
      "update public.bookings set overbook_offered_by = null, overbook_offered_at = null where id = $1",
      [id],
    );
    expect((await statsFor()).offers).toBe(before.offers + 1);
  });

  it("counts a miss and writes NO refusal", async () => {
    /*
     * THE POINT OF THE WHOLE DESIGN. A refusal row keeps somebody out of that
     * customer's replacement list and stops the job coming back to them. Right
     * for a professional who said no; wrong for one who tried to take an extra
     * job and ran out of day, and applying it here would teach everybody never
     * to offer.
     */
    await clear();
    await setCrew(1);
    const before = await statsFor();

    const id = await book({ provider: null, at: TWO_PM });
    await pg.admin.query(
      `update public.bookings
          set overbook_offered_by = $1, overbook_offered_at = now(),
              provider_id = $1, status = 'accepted'
        where id = $2`,
      [krishna, id],
    );
    await pg.admin.query(
      `update public.bookings
          set status = 'pending', provider_id = null,
              overbook_missed_at = now(), opened_at = now()
        where id = $1`,
      [id],
    );

    const after = await statsFor();
    expect(after.misses).toBe(before.misses + 1);
    // Not a withdrawal, and not a refusal.
    expect(after.withdrawals).toBe(before.withdrawals);

    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.booking_refusals where booking_id = $1",
      [id],
    );
    expect(rows[0].n).toBe(0);
  });

  it("still records an ordinary withdrawal as one", async () => {
    // The suppression is narrow on purpose: without this test it could widen
    // into "no release is ever counted" and nobody would notice.
    await clear();
    await setCrew(1);
    const before = await statsFor();

    const id = await book({ provider: krishna, at: TWO_PM });
    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [id],
    );
    await pg.admin.query(
      "update public.bookings set status = 'pending', provider_id = null where id = $1",
      [id],
    );

    expect((await statsFor()).withdrawals).toBe(before.withdrawals + 1);
    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.booking_refusals where booking_id = $1",
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("refuses a customer stamping a miss from their own session", async () => {
    // A counter a caller can move is a counter that measures nothing.
    await clear();
    await setCrew(1);
    const id = await book({ provider: null, at: TWO_PM });
    const anita = await pg.asUser(ANITA);
    await expect(
      anita.query(
        "update public.bookings set overbook_missed_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/professional's to make/);
    await anita.end();
  });
});
