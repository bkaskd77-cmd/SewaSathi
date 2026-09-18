import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * A booking learns its own length, and refuses to learn a fake one.
 *
 * TWO TRIGGERS AND THEY ANSWER DIFFERENT QUESTIONS. `sync_booking_duration`
 * copies the researched figure off the product at the moment the product is
 * named — a trigger rather than a call site, because a booking is created in
 * one place today and will be created in three, and the copy that gets
 * forgotten is the one that silently schedules a four-day repaint as a
 * two-hour call. `record_booking_duration` writes what actually happened at
 * completion, and REFUSES a figure too small to have been work.
 *
 * That refusal is not hypothetical. Every completed booking in the live
 * database when this shipped had `started_at` and `completed_at` three to
 * twenty-nine SECONDS apart — walkthroughs by our own test accounts. Recording
 * those would have written numbers that look measured into the one column the
 * researched durations are eventually meant to come from.
 */

const ANITA = "aaaaaaaa-7666-4666-8666-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb";

let pg: Harness;
let krishna: string;
let address: string;
let band: { low: number; high: number };
let counter = 0;

async function book(
  bandSlug: string | null,
  bandSource: "model" | "matcher" | null = null,
): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, category_slug, address_id, description,
        quoted_min, quoted_max, band_slug, band_source)
     values ($1, $2, 'painting', $3, 'Living room needs doing', $4, $5, $6, $7)
     returning id`,
    [
      `SK-DUR${(counter += 1)}`,
      ANITA,
      address,
      band.low,
      band.high,
      bandSlug,
      bandSlug ? bandSource : null,
    ],
  );
  return rows[0].id as string;
}

async function durationOf(id: string) {
  const { rows } = await pg.admin.query(
    `select band_slug, estimated_working_minutes, estimated_elapsed_days,
            actual_working_minutes, duration_implausible_at
       from public.bookings where id = $1`,
    [id],
  );
  return rows[0];
}

/**
 * Walk the status machine to completed with a chosen amount of work done.
 *
 * `started_at` IS BACK-DATED IN A SEPARATE UPDATE, and it has to be:
 * `enforce_booking_transition` stamps `started_at := now()` itself on the move
 * to `in_progress`, and it sorts alphabetically before
 * `bookings_record_duration`, so anything passed in the same statement is
 * overwritten before this trigger ever sees it. That is correct product
 * behaviour — the stamp is ours, not the caller's — and it means a test
 * pretending time passed has to say so afterwards.
 */
async function complete(id: string, seconds: number): Promise<void> {
  await pg.admin.query(
    "update public.bookings set provider_id = $2, status = 'accepted' where id = $1",
    [id, krishna],
  );
  await pg.admin.query(
    "update public.bookings set status = 'en_route' where id = $1",
    [id],
  );
  await pg.admin.query(
    "update public.bookings set status = 'in_progress' where id = $1",
    [id],
  );
  // Status unchanged, so `record_booking_duration` early-returns here.
  await pg.admin.query(
    "update public.bookings set started_at = now() - make_interval(secs => $2) where id = $1",
    [id, seconds],
  );
  await pg.admin.query(
    "update public.bookings set status = 'completed' where id = $1",
    [id],
  );
}

beforeAll(async () => {
  pg = await startPostgres();

  const { rows: cat } = await pg.admin.query(
    "select base_price_min, base_price_max from public.categories where slug = 'painting'",
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
    "insert into public.provider_categories (provider_id, category_slug) values ($1, 'painting')",
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

describe("the estimate follows the product", () => {
  it("copies the researched figure when a product is named", async () => {
    const id = await book("room-supplied");
    const row = await durationOf(id);

    const { rows: sub } = await pg.admin.query(
      `select typical_working_minutes, typical_elapsed_days
         from public.category_price_bands
        where category_slug = 'painting' and slug = 'room-supplied'`,
    );
    expect(Number(row.estimated_working_minutes)).toBe(
      Number(sub[0].typical_working_minutes),
    );
    expect(Number(row.estimated_elapsed_days)).toBe(
      Number(sub[0].typical_elapsed_days),
    );
  });

  /*
   * THE CASE THE WHOLE TWO-NUMBER MODEL EXISTS FOR. A painter is on the tools
   * for part of each day and the room is unusable for all of them, so the span
   * must exceed what the working minutes could fill. A single number could not
   * say both, and `max_concurrent_jobs = 3` was a single number trying.
   */
  it("gives a supplied repaint more days than its working hours fill", async () => {
    const row = await durationOf(await book("room-supplied"));
    const minutes = Number(row.estimated_working_minutes);
    const days = Number(row.estimated_elapsed_days);

    expect(days).toBeGreaterThan(1);
    expect(minutes / days).toBeLessThan(8 * 60);
  });

  /*
   * NULL IS A REAL ANSWER. "I need a painter" does not say whether that is a
   * touch-up or a whole flat, and the scheduler has a defined behaviour for a
   * booking with no estimate — it holds what every booking held before
   * duration existed.
   */
  it("leaves a booking with no product with no estimate at all", async () => {
    const row = await durationOf(await book(null));
    expect(row.band_slug).toBeNull();
    expect(row.estimated_working_minutes).toBeNull();
    expect(row.estimated_elapsed_days).toBeNull();
  });

  /*
   * A product from another trade would reserve painting's seven days for a tap
   * washer. The composite foreign key is what makes it impossible, rather than
   * a check somebody has to remember at each of the call sites.
   */
  it("refuses a product this trade does not sell", async () => {
    await expect(book("blockage")).rejects.toThrow(
      /foreign key|violates/i,
    );
  });

  it("clears the estimate when the product is cleared", async () => {
    const id = await book("room-supplied");
    await pg.admin.query(
      "update public.bookings set band_slug = null where id = $1",
      [id],
    );
    const row = await durationOf(id);
    expect(row.estimated_working_minutes).toBeNull();
    expect(row.estimated_elapsed_days).toBeNull();
  });

  /*
   * FROZEN AT BOOKING TIME, like band_min and quoted_max beside it. Re-timing
   * a product must not silently restate how long a job somebody already booked
   * was supposed to take — the estimate is the figure an overrun is later
   * judged against.
   */
  it("does not rewrite a booked job when the product is re-timed", async () => {
    const id = await book("touch-up");
    const before = Number((await durationOf(id)).estimated_working_minutes);

    await pg.admin.query(
      `update public.category_price_bands set typical_working_minutes = 999
        where category_slug = 'painting' and slug = 'touch-up'`,
    );
    await pg.admin.query(
      "update public.bookings set description = 'still the same job' where id = $1",
      [id],
    );

    expect(Number((await durationOf(id)).estimated_working_minutes)).toBe(before);

    await pg.admin.query(
      `update public.category_price_bands set typical_working_minutes = $1
        where category_slug = 'painting' and slug = 'touch-up'`,
      [before],
    );
  });
});

describe("what actually happened, and what is refused as evidence", () => {
  it("records the worked minutes on a real job", async () => {
    const id = await book("touch-up");
    await complete(id, 95 * 60);

    const row = await durationOf(id);
    expect(Number(row.actual_working_minutes)).toBeGreaterThanOrEqual(95);
    expect(row.duration_implausible_at).toBeNull();
  });

  /*
   * THE REGRESSION GUARD, and the numbers in it are the real ones. Four
   * completed bookings in production, three to twenty-nine seconds long.
   * Recording those as 0 would put a measured-looking value into the column
   * the researched durations are meant to grow out of — the same class of
   * mistake as 26 seeded "verified" providers nearly reaching the landing
   * page.
   */
  it("refuses a three-second completion and says it refused", async () => {
    const id = await book("touch-up");
    await complete(id, 3);

    const row = await durationOf(id);
    expect(row.actual_working_minutes).toBeNull();
    expect(row.duration_implausible_at).not.toBeNull();
  });

  it("refuses twenty-nine seconds too, which is the longest real one", async () => {
    const id = await book("touch-up");
    await complete(id, 29);
    expect((await durationOf(id)).actual_working_minutes).toBeNull();
  });

  /*
   * A MISSING MEASUREMENT AND A REFUSED ONE ARE DIFFERENT THINGS, which is why
   * the stamp exists rather than just leaving the column null. A reader
   * counting how much evidence exists needs to tell "nobody has finished a job
   * yet" from "somebody finished one in three seconds".
   */
  it("leaves both blank when the job was never started", async () => {
    const id = await book("touch-up");
    await pg.admin.query(
      "update public.bookings set provider_id = $2, status = 'accepted' where id = $1",
      [id, krishna],
    );
    await pg.admin.query(
      "update public.bookings set status = 'cancelled', cancelled_at = now() where id = $1",
      [id],
    );
    const row = await durationOf(id);
    expect(row.actual_working_minutes).toBeNull();
    expect(row.duration_implausible_at).toBeNull();
  });
});


/**
 * Clearing the bookings a band rule got wrong.
 *
 * THE SWEEP THESE TESTS EXIST FOR is the one that could not be written. Three
 * of the five sub-band rules in the keyword matcher shipped wrong, and
 * `no-water` from the defective `dhara` match is the same three bytes as
 * `no-water` from the model reading a whole sentence. `band_source` is what
 * makes them separable, and this is the proof on rows rather than on an empty
 * table — the live database happened to hold none, which is exactly the
 * condition under which a cleanup tool goes untested and then does not work.
 *
 * SQL here rather than calling `rebandBookings`: that function needs a
 * Supabase client and this harness is raw Postgres. The predicate is what
 * matters and it is the same one — category, product, window, and optionally
 * the source.
 */
describe("clearing a product a rule got wrong", () => {
  const clear = async (source?: "model" | "matcher") =>
    (
      await pg.admin.query(
        `update public.bookings
            set band_slug = null, band_source = null
          where category_slug = 'painting'
            and band_slug = 'touch-up'
            and created_at >= now() - interval '1 hour'
            ${source ? "and band_source = $1" : ""}
          returning id`,
        source ? [source] : [],
      )
    ).rows.length;

  it("clears the matcher's and leaves the model's", async () => {
    await pg.admin.query("delete from public.bookings");
    const fromMatcher = await book("touch-up", "matcher");
    const fromModel = await book("touch-up", "model");

    expect(await clear("matcher")).toBe(1);

    expect((await durationOf(fromMatcher)).band_slug).toBeNull();
    expect((await durationOf(fromModel)).band_slug).toBe("touch-up");
  });

  /*
   * AND THE ESTIMATE GOES WITH IT. `sync_booking_duration` nulls the figures
   * when the product is cleared, so a swept booking falls back to the hold
   * every unbanded booking already uses rather than keeping a length derived
   * from a product we have just decided was wrong.
   */
  it("takes the estimate away with the product", async () => {
    await pg.admin.query("delete from public.bookings");
    const id = await book("touch-up", "matcher");
    expect((await durationOf(id)).estimated_working_minutes).not.toBeNull();

    await clear("matcher");

    const row = await durationOf(id);
    expect(row.estimated_working_minutes).toBeNull();
    expect(row.estimated_elapsed_days).toBeNull();
  });

  /*
   * THE SOURCE IS A HINT, so a sweep that has to be certain omits it. Over-
   * clearing costs a scheduling estimate; under-clearing leaves a wrong one in
   * the evidence, and only one of those is recoverable.
   */
  it("clears regardless of source when no source is named", async () => {
    await pg.admin.query("delete from public.bookings");
    await book("touch-up", "matcher");
    await book("touch-up", "model");
    await book("touch-up", null);

    expect(await clear()).toBe(3);
  });

  it("leaves other products alone", async () => {
    await pg.admin.query("delete from public.bookings");
    const other = await book("room-supplied", "matcher");
    await clear();
    expect((await durationOf(other)).band_slug).toBe("room-supplied");
  });
});

/**
 * The scheduler, through the trigger rather than through TypeScript.
 *
 * `lib/booking/capacity.ts` is what greys a row out before somebody taps it.
 * THIS is the rule that actually holds, and it is a trigger because a booking
 * gains a professional five ways. The two have to agree, which is what
 * `npm run check:duration` asserts about their constants and what these
 * assert about their behaviour.
 */
describe("a long job and a short one, in Postgres", () => {
  const TEN_AM = "2026-10-01T04:15:00Z";
  const ONE_PM = "2026-10-01T07:15:00Z";
  const THREE_PM = "2026-10-01T09:15:00Z";

  /**
   * A booking with an explicit length, assigned, at a given time.
   *
   * THE LENGTH GOES IN THE PROFESSIONAL'S COLUMN, and it has to. Writing
   * `estimated_working_minutes` directly does nothing: `sync_booking_duration`
   * nulls it whenever `band_slug` is null, because our estimate is the
   * sub-band's figure and a booking with no product has no estimate to carry.
   * That is the rule working — and it means a test that wants a length without
   * inventing a product uses the column that belongs to somebody who saw the
   * job. It exercises the precedence at the same time.
   */
  async function scheduled(minutes: number | null, at: string): Promise<string> {
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, category_slug, address_id,
          description, quoted_min, quoted_max, scheduled_for,
          provider_estimated_working_minutes, status)
       values ($1, $2, $3, 'painting', $4, 'Living room', $5, $6, $7, $8, 'pending')
       returning id`,
      [
        `SK-INT${(counter += 1)}`,
        ANITA,
        krishna,
        address,
        band.low,
        band.high,
        at,
        minutes,
      ],
    );
    return rows[0].id as string;
  }

  beforeEach(async () => {
    await pg.admin.query("delete from public.bookings");
    await pg.admin.query(
      "update public.categories set max_concurrent_jobs = 1 where slug = 'painting'",
    );
  });

  afterAll(async () => {
    await pg.admin.query(
      "update public.categories set max_concurrent_jobs = 3 where slug = 'painting'",
    );
  });

  /*
   * THE COLLISION THE OLD RULE MISSED, and it missed it in the database as
   * well as on the screen. A four-hour job from ten runs to two; a
   * forty-five-minute job at one lands inside it. Under the hardcoded
   * `interval '120 minutes'` the first ended at noon and the two never met, so
   * the second customer was told somebody was coming.
   */
  it("refuses a short job inside a long one", async () => {
    await scheduled(240, TEN_AM);
    await expect(scheduled(45, ONE_PM)).rejects.toThrow(
      /already booked for this time/,
    );
  });

  it("allows it once the long job has finished", async () => {
    await scheduled(240, TEN_AM);
    await expect(scheduled(45, THREE_PM)).resolves.toBeTruthy();
  });

  /*
   * AND IT IS ASYMMETRIC, which one constant cannot be. Swap the lengths and
   * the same two start times stop colliding.
   */
  it("allows the same two times when the lengths are swapped", async () => {
    await scheduled(45, TEN_AM);
    await expect(scheduled(240, ONE_PM)).resolves.toBeTruthy();
  });

  /*
   * A JOB NOBODY SIZED STILL HOLDS TWO HOURS, so nothing regresses for the
   * rows that have no product — which today is all of them.
   */
  it("holds the default on both sides when neither is estimated", async () => {
    await scheduled(null, TEN_AM);
    await expect(scheduled(null, "2026-10-01T05:15:00Z")).rejects.toThrow(
      /already booked for this time/,
    );
    await expect(scheduled(null, ONE_PM)).resolves.toBeTruthy();
  });
});

/**
 * A multi-day job holds a site, not a slot.
 *
 * `booking_days` is generated from the parent, and the gate on it is the same
 * one `spansDays()` applies in TypeScript: an invented duration may reserve
 * minutes but may not take days out of anybody's week.
 */
describe("the days a job runs", () => {
  const researched = async (on: boolean) =>
    pg.admin.query(
      `update public.category_price_bands
          set duration_source = $1, duration_checked_at = $2
        where category_slug = 'painting' and slug = 'room-supplied'`,
      on ? ["researched", "2026-09-20"] : ["invented", null],
    );

  const daysOf = async (id: string) =>
    (
      await pg.admin.query(
        `select day, day_index, working_minutes, starts_at
           from public.booking_days where booking_id = $1 order by day_index`,
        [id],
      )
    ).rows;

  beforeEach(async () => {
    await pg.admin.query("delete from public.bookings");
    await researched(false);
  });

  afterAll(async () => {
    await researched(false);
  });

  /*
   * THE GATE. `room-supplied` claims four days and every one of those days is
   * a guess. Holding four days of a painter's week and four days of a
   * customer's home off a guess takes real bookable capacity, invisibly, and
   * nothing on any screen tells it apart from a measurement.
   */
  it("generates no days while the duration is invented", async () => {
    const id = await book("room-supplied");
    expect(await daysOf(id)).toEqual([]);
  });

  it("generates them once the duration is researched", async () => {
    await researched(true);
    const id = await book("room-supplied");
    const days = await daysOf(id);

    expect(days).toHaveLength(4);
    expect(days.map((d) => Number(d.day_index))).toEqual([1, 2, 3, 4]);
  });

  /*
   * LATER DAYS CARRY NO TIME. Day 1 is the slot the customer picked; nobody
   * has said when on day 3 the painter arrives, and an invented 09:00 would be
   * a default presented as a fact.
   */
  it("gives day one a time and the rest none", async () => {
    await researched(true);
    const days = await daysOf(await book("room-supplied"));

    expect(days[0].starts_at).not.toBeNull();
    for (const later of days.slice(1)) expect(later.starts_at).toBeNull();
  });

  /*
   * THE PAINTER IS NOT ON THE TOOLS ALL FOUR DAYS — that is what the drying
   * is. The daily figure is the total spread across the span, not the total
   * repeated on each day.
   */
  it("spreads the working minutes across the days", async () => {
    await researched(true);
    const days = await daysOf(await book("room-supplied"));
    const total = days.reduce((sum, d) => sum + Number(d.working_minutes), 0);

    const { rows } = await pg.admin.query(
      "select typical_working_minutes from public.category_price_bands where category_slug='painting' and slug='room-supplied'",
    );
    expect(total).toBeLessThanOrEqual(Number(rows[0].typical_working_minutes));
    expect(Number(days[0].working_minutes)).toBeLessThan(8 * 60);
  });

  /*
   * GENERATED, SO IT CANNOT DRIFT. Moving the booking moves its days with it,
   * rather than leaving a week held at the old dates.
   */
  it("regenerates when the booking moves", async () => {
    await researched(true);
    const id = await book("room-supplied");
    const before = (await daysOf(id)).map((d) => String(d.day));

    await pg.admin.query(
      "update public.bookings set scheduled_for = $2 where id = $1",
      [id, "2026-11-05T04:15:00Z"],
    );
    const after = (await daysOf(id)).map((d) => String(d.day));

    expect(after).toHaveLength(4);
    expect(after).not.toEqual(before);
  });

  it("clears them when the job is over", async () => {
    await researched(true);
    const id = await book("room-supplied");
    expect(await daysOf(id)).toHaveLength(4);

    await pg.admin.query(
      "update public.bookings set status = 'cancelled', cancelled_at = now() where id = $1",
      [id],
    );
    expect(await daysOf(id)).toEqual([]);
  });

  /*
   * THE PROFESSIONAL'S OWN SPAN IS EVIDENCE and passes the gate whatever our
   * provenance says. They have been to the site; what is gated is our guess.
   */
  it("spans days on the professional's figure even while ours is invented", async () => {
    const id = await book("room-supplied");
    expect(await daysOf(id)).toEqual([]);

    await pg.admin.query(
      "update public.bookings set provider_estimated_elapsed_days = 3 where id = $1",
      [id],
    );
    expect(await daysOf(id)).toHaveLength(3);
  });

  /*
   * THE SITE'S OWN HOLD. Two painters in one living room on overlapping days
   * is not a scheduling nicety — the second booking cannot physically happen.
   */
  it("refuses a second job of the same trade at the same address", async () => {
    await researched(true);
    await book("room-supplied");
    await expect(book("room-supplied")).rejects.toThrow(
      /already has this trade booked/,
    );
  });

  /*
   * A DIFFERENT TRADE IS FINE and deliberately allowed: an electrician can
   * work around a painter.
   */
  it("allows a different trade at the same address on the same days", async () => {
    await researched(true);
    await book("room-supplied");

    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ($1, $2, 'electrical', $3, 'Socket needs moving', 500, 5000)
       returning id`,
      [`SK-ELE${(counter += 1)}`, ANITA, address],
    );
    expect(rows[0].id).toBeTruthy();
  });

  /*
   * NOBODY MAY WRITE THESE ROWS. They are the trigger's: a caller who could
   * insert one could hold a professional's week without booking anything.
   */
  it("grants no write policy to anybody", async () => {
    const { rows } = await pg.admin.query(
      "select cmd from pg_policies where tablename = 'booking_days'",
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });
});
