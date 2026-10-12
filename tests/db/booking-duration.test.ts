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

/**
 * A BAND NOW NEEDS A SOURCE, so the default is one rather than null.
 *
 * `bookings_band_needs_source` refuses a product with no provenance, which is
 * the state a live guarantee visit was writing. These fixtures were writing it
 * too — the constraint caught ten of them — and that is the guard working
 * rather than a fixture to loosen: a product nobody named is exactly what the
 * duration loop must not read as evidence.
 */
async function book(
  bandSlug: string | null,
  bandSource: "model" | "matcher" | "inherited" = "model",
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
            actual_working_minutes, actual_elapsed_minutes, actual_elapsed_days,
            duration_implausible_at
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

/**
 * Walk to completed with the start stamp a whole number of Nepal days back.
 *
 * `days` IS THE INCLUSIVE SPAN, so 1 is a same-day job and 3 means the start
 * stamp lands two Nepal dates earlier. Fixed at 10:00 NPT on that date rather
 * than "N × 24 hours ago", because the second one crosses one boundary or two
 * depending on what time the suite happens to run — and a test whose expected
 * value moves with the clock either gets loosened until it proves nothing, or
 * asserts the trigger's own arithmetic back at it.
 */
async function completeAcrossDays(id: string, days: number): Promise<void> {
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
  await pg.admin.query(
    `update public.bookings
        set started_at =
              (((now() + interval '5 hours 45 minutes')::date - ($2::integer - 1))
                + time '10:00') - interval '5 hours 45 minutes'
      where id = $1`,
    [id, days],
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
   * say both, and `categories.max_concurrent_jobs = 3` was a single number
   * trying — which is why that column is now gone.
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
/**
 * A product always records who named it.
 *
 * THE LIVE ROW THIS CAME FROM. `SK-RDKW7` carries `band_slug = burst` and a
 * null source, written two days AFTER the column and its check existed — so
 * not the usual "the column shipped later" silence. `lib/data/claims.ts`
 * copied the parent booking's band onto a guarantee visit and copied no
 * source.
 *
 * It matters beyond tidiness: everything measured per sub-band reads that
 * column, and a guarantee visit is the SAME fault revisited rather than fresh
 * evidence about the product. A source of `inherited` is what lets the
 * duration loop tell the two apart; a null tells it nothing.
 */
describe("a band cannot be written without a source", () => {
  it("refuses a product with no provenance", async () => {
    await expect(
      pg.admin.query(
        `insert into public.bookings
           (reference, customer_id, category_slug, address_id, description,
            quoted_min, quoted_max, band_slug, band_source)
         values ('SK-NOSRC', $1, 'painting', $2, 'Living room needs doing',
                 $3, $4, 'touch-up', null)`,
        [ANITA, address, band.low, band.high],
      ),
      "a band with no source is what SK-RDKW7 is, and it must not happen again",
    ).rejects.toThrow(/bookings_band_needs_source/);
  });

  it("refuses one on update too, not only on insert", async () => {
    const id = await book("touch-up", "model");
    await expect(
      pg.admin.query(
        "update public.bookings set band_source = null where id = $1",
        [id],
      ),
    ).rejects.toThrow(/bookings_band_needs_source/);
  });

  /* Clearing BOTH together is how a swept booking loses its product, and that
     has to stay legal or `rebandBookings` could not run at all. */
  it("allows clearing the product and its source together", async () => {
    const id = await book("touch-up", "matcher");
    await pg.admin.query(
      "update public.bookings set band_slug = null, band_source = null where id = $1",
      [id],
    );
    expect((await durationOf(id)).band_slug).toBeNull();
  });

  it("accepts inherited, which is what a guarantee visit writes", async () => {
    const id = await book("touch-up", "inherited");
    expect((await durationOf(id)).band_slug).toBe("touch-up");
  });
});

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
  /*
   * THE THIRD ROW USED TO CARRY NO SOURCE AT ALL, and that shape can no longer
   * be built: `bookings_band_needs_source` refuses a product with no
   * provenance on insert and on update alike.
   *
   * One live row still has it — `SK-RDKW7`, a guarantee visit written before
   * the visit insert carried a source — and it is deliberately not backfilled,
   * so the unfiltered sweep does still have to reach rows like it. That falls
   * out of SQL rather than needing a case: the predicate names no source, so a
   * null one is matched like any other. What this case is actually for is the
   * regression where somebody adds a default source filter, and three
   * DIFFERENT sources prove that as well as a null ever did.
   */
  it("clears regardless of source when no source is named", async () => {
    await pg.admin.query("delete from public.bookings");
    await book("touch-up", "matcher");
    await book("touch-up", "model");
    await book("touch-up", "inherited");

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
    /*
     * One seat, so what is being measured is the INTERVAL and nothing else.
     * This used to pin `categories.max_concurrent_jobs` to 1 and put it back
     * to 3 afterwards — painting's 3 being the workaround these very tests
     * exist to replace. The column is gone; a null crew is one person, which
     * is the same floor arrived at honestly.
     */
    await pg.admin.query(
      "update public.providers set crew_count = null where id = $1",
      [krishna],
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
  /*
   * IT IS `span_source` THAT OPENS THIS GATE, NOT `duration_source`.
   *
   * These cases set the minutes' provenance when the phase shipped, because one
   * column answered both questions. Promoting the minutes — which is all a
   * same-day completion can ever evidence — would then have handed this
   * sub-band its four-day hold for free.
   */
  const researched = async (on: boolean) =>
    pg.admin.query(
      `update public.category_price_bands
          set span_source = $1, span_checked_at = $2
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

/**
 * ELAPSED IS NOT WORKED, AND ONE COLUMN WAS RECORDING BOTH.
 *
 * `record_booking_duration` subtracted the stamps and wrote the answer into
 * `actual_working_minutes` under a comment calling it how long the work took.
 * Same-day that is true. Across a day boundary the night is inside it — a
 * whole-flat repaint is researched at 3,600 working minutes over 7 days, and
 * the stamps would have said 10,080. The promotion loop reads this column, so
 * the first thing it would have learnt is painting's span dressed as its
 * hands-on time.
 */
describe("a completion records what it measured and not more", () => {
  it("writes worked minutes only for a job that ran inside one Nepal day", async () => {
    const id = await book("touch-up");
    await completeAcrossDays(id, 1);

    const row = await durationOf(id);
    expect(Number(row.actual_elapsed_days)).toBe(1);
    expect(Number(row.actual_elapsed_minutes)).toBeGreaterThan(0);
    // Same measurement, so the two agree exactly rather than approximately.
    expect(Number(row.actual_working_minutes)).toBe(
      Number(row.actual_elapsed_minutes),
    );
  });

  /*
   * THE BUG, PINNED. Three Nepal days of elapsed time is upwards of 2,800
   * minutes; the sub-band's researched figure for a supplied repaint is 960.
   * The old trigger wrote the former into the column the loop reads.
   */
  it("refuses a worked figure on a job that crossed a day boundary", async () => {
    const id = await book("room-supplied");
    await completeAcrossDays(id, 3);

    const row = await durationOf(id);
    expect(Number(row.actual_elapsed_days)).toBe(3);
    expect(Number(row.actual_elapsed_minutes)).toBeGreaterThan(24 * 60);
    expect(row.actual_working_minutes).toBeNull();
    // Null here is "not recorded", never "no work" — and it is not a refusal
    // of the completion, so nothing is stamped implausible.
    expect(row.duration_implausible_at).toBeNull();
  });

  /*
   * THE FLOOR NULLS ALL THREE. A three-second completion is a walkthrough, and
   * a span of 1 derived from it is a sample the span loop never earned — so the
   * refusal has to cover the new columns too or the implausible rows quietly
   * become the span evidence.
   */
  it("records nothing at all below the plausibility floor", async () => {
    const id = await book("touch-up");
    await complete(id, 3);

    const row = await durationOf(id);
    expect(row.actual_working_minutes).toBeNull();
    expect(row.actual_elapsed_minutes).toBeNull();
    expect(row.actual_elapsed_days).toBeNull();
    expect(row.duration_implausible_at).not.toBeNull();
  });

  it("is not a browser's to write", async () => {
    const id = await book("touch-up");
    // Both layers: the column grant refuses before any row is considered
    // (`20261011000004`), and the trigger refuses anyway and says why. Asserting
    // only the first would retire the coverage of a guard that has already been
    // silently broken in production once.
    for (const sql of [
      "update public.bookings set actual_elapsed_days = 4 where id = $1",
      "update public.bookings set actual_elapsed_minutes = 99 where id = $1",
    ]) {
      await expect((await pg.asUser(ANITA)).query(sql, [id])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        (await pg.pastTheGrant(ANITA)).query(sql, [id]),
      ).rejects.toThrow(/How long a job takes/i);
    }
  });
});

/**
 * THE SPAN HAS ITS OWN PROVENANCE, AND THESE ARE THE CASES THAT PROVE IT.
 *
 * `sync_booking_days` read `duration_source` while the comment above it argued
 * — correctly, at length — that the minutes and the span must be gated
 * separately because their wrong answers cost wildly different amounts. The
 * first promotion of a researched MINUTES figure would therefore have handed
 * painting a 4-day hold on a painter's week and a customer's home, with
 * nothing observed about spans at all.
 */
describe("the span gate reads the span's own provenance", () => {
  async function setProvenance(
    slug: string,
    duration: string,
    span: string,
  ): Promise<void> {
    await pg.admin.query(
      `update public.category_price_bands
          set duration_source = $2, span_source = $3
        where category_slug = 'painting' and slug = $1`,
      [slug, duration, span],
    );
  }

  async function dayCount(id: string): Promise<number> {
    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.booking_days where booking_id = $1",
      [id],
    );
    return rows[0].n as number;
  }

  /*
   * CLEARED BETWEEN CASES, because `enforce_site_capacity` is doing its job: a
   * second painting booking at the same address across overlapping days is
   * refused, which is the whole point of the site hold and not something to
   * work around with a second address.
   */
  beforeEach(async () => {
    await pg.admin.query("delete from public.bookings");
    await setProvenance("room-supplied", "invented", "invented");
  });

  afterAll(async () => {
    await setProvenance("room-supplied", "invented", "invented");
  });

  it("holds one day while the span is invented", async () => {
    expect(await dayCount(await book("room-supplied"))).toBe(0);
  });

  /*
   * THE REGRESSION. Minutes observed, span not — which is exactly the state the
   * duration loop produces first, because same-day completions are the only
   * minutes evidence there is.
   */
  it("still holds one day when only the MINUTES were promoted", async () => {
    await setProvenance("room-supplied", "observed", "invented");
    expect(await dayCount(await book("room-supplied"))).toBe(0);
  });

  it("spans the days once the SPAN is promoted", async () => {
    await setProvenance("room-supplied", "invented", "observed");
    const id = await book("room-supplied");

    const { rows: sub } = await pg.admin.query(
      `select typical_elapsed_days from public.category_price_bands
        where category_slug = 'painting' and slug = 'room-supplied'`,
    );
    expect(await dayCount(id)).toBe(Number(sub[0].typical_elapsed_days));
  });

  /*
   * The delete that clears the old rows now lives in `clear_booking_days`, for
   * a transport reason recorded in the migration. A helper nobody can prove is
   * called is a helper that silently stops being called, so the regeneration is
   * asserted as behaviour: the rows have to follow the span down as well as up.
   */
  it("clears the days again when the span is withdrawn", async () => {
    await setProvenance("room-supplied", "invented", "observed");
    const id = await book("room-supplied");
    expect(await dayCount(id)).toBeGreaterThan(1);

    await setProvenance("room-supplied", "invented", "invented");
    await pg.admin.query(
      "update public.bookings set scheduled_for = now() + interval '2 days' where id = $1",
      [id],
    );
    expect(await dayCount(id)).toBe(0);
  });
});

/**
 * AN ESTIMATE IS WHAT WE SAID BEFOREHAND, so a product named afterwards gets none.
 *
 * The professional can now name the product on a job nobody classified, at
 * completion. `sync_booking_duration` copies the sub-band's researched figures
 * whenever the product is set — which is right at booking time and wrong here:
 * the whole value of `estimated_working_minutes` is that it is what we said the
 * job would take BEFORE anybody did it, which is the only thing that ever makes
 * the researched numbers better than a guess. Writing it with the answer in hand
 * would mint an estimate that informed no scheduling decision, and any
 * estimate-against-actual reading would then be flattered by rows that are
 * really hindsight.
 *
 * The line is `started_at` rather than the status: up to the moment work begins
 * the estimate still has a job to do, because it is what the scheduler holds.
 */
describe("naming a product after the work records it without inventing an estimate", () => {
  /* `enforce_slot_capacity` refuses a second job in the same window for one
     professional, and these cases walk jobs to in_progress without picking a
     slot each — cleared rather than scattered across invented times. */
  beforeEach(async () => {
    await pg.admin.query("delete from public.bookings");
  });

  it("still copies the estimate when the product is named before work starts", async () => {
    const id = await book(null);
    await pg.admin.query(
      "update public.bookings set provider_id = $2, status = 'accepted' where id = $1",
      [id, krishna],
    );
    await pg.admin.query(
      `update public.bookings set band_slug = 'touch-up', band_source = 'customer'
        where id = $1`,
      [id],
    );

    const row = await durationOf(id);
    expect(row.band_slug).toBe("touch-up");
    expect(Number(row.estimated_working_minutes)).toBeGreaterThan(0);
  });

  it("records the product and no estimate once work has started", async () => {
    const id = await book(null);
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
    await pg.admin.query(
      `update public.bookings
          set band_slug = 'touch-up', band_source = 'professional'
        where id = $1`,
      [id],
    );

    const row = await durationOf(id);
    expect(row.band_slug).toBe("touch-up");
    expect(row.estimated_working_minutes).toBeNull();
    expect(row.estimated_elapsed_days).toBeNull();
  });

  /*
   * AND THE ANSWER SURVIVES COMPLETION, which is the common case: the panel is
   * on the card of a finished job because that is the one chance to ask.
   */
  it("records it on a job that is already over", async () => {
    const id = await book(null);
    await complete(id, 95 * 60);
    await pg.admin.query(
      `update public.bookings
          set band_slug = 'touch-up', band_source = 'professional'
        where id = $1`,
      [id],
    );

    const row = await durationOf(id);
    expect(row.band_slug).toBe("touch-up");
    expect(row.estimated_working_minutes).toBeNull();
    // The measurement is untouched — naming the product does not re-run it.
    expect(Number(row.actual_working_minutes)).toBeGreaterThanOrEqual(95);
  });
});

/**
 * NAMING THE PRODUCT AFTER THE WORK IS DATA, AND IT MOVES NO MONEY.
 *
 * `band_source = 'professional'` exists because the other four answers can all
 * come out empty: "I'm not sure" writes null on purpose and the category picker
 * asks nothing, so a job can be booked, worked and finished with no product —
 * teaching the duration loop and the per-product bands nothing. The person who
 * just did the work knows, so they get one tap.
 *
 * AND THAT TAP MUST NOT BE A PRICE CHANGE, which is a different mechanism with
 * a different window: `canProposeCorrection` needs a stated band and runs before
 * work starts, `canNameBand` needs a null one and runs from `in_progress`. The
 * argument that they cannot overlap is written down in CLAUDE.md; what was NOT
 * written down anywhere is a test proving the write itself is inert on every
 * figure a dispute would be argued from. `freeze_booking_band()` pins `band_min`
 * and `band_revision_id` on every UPDATE and `booking_band_bounds` treats only
 * `customer` as a stated band — both read out of `pg_proc` before the panel was
 * built, which is reading the mechanism rather than asserting the outcome.
 *
 * This asserts the outcome: every money column byte-identical across the write.
 */
describe("the professional naming the product changes no figure", () => {
  const MONEY = [
    "band_min",
    "band_revision_id",
    "quoted_min",
    "quoted_max",
    "quote_model",
    "final_amount",
    "platform_fee",
    "provider_earning",
    "commission_bps",
    "commission_basis",
    "payment_status",
    "materials_rupees",
  ] as const;

  async function money(id: string) {
    const { rows } = await pg.admin.query(
      `select ${MONEY.join(", ")} from public.bookings where id = $1`,
      [id],
    );
    return rows[0] as Record<string, unknown>;
  }

  it("leaves every money column exactly as it was", async () => {
    const id = await book(null);
    await complete(id, 95 * 60);

    const before = await money(id);
    // The band floor is the figure commission is charged on, so a test that
    // started from a null one would prove nothing about the column that
    // matters. `band_min`'s own bite is in the next case — `touch-up`'s floor
    // happens to equal painting's, so a re-derivation would not show up here.
    expect(before.band_min).not.toBeNull();

    await pg.admin.query(
      `update public.bookings
          set band_slug = 'touch-up', band_source = 'professional'
        where id = $1`,
      [id],
    );

    expect(await money(id)).toEqual(before);
  });

  it("holds the floor still where the new product's band is dearer", async () => {
    /*
     * THE CASE THAT COSTS SOMEBODY MONEY IF THE FLOOR EVER FOLLOWS THE PRODUCT.
     * Commission is charged on `max(final_amount, band_min)`, so a floor that
     * moved when the professional named the job would let the label decide the
     * fee after the work: here, from painting's 1,000 up to a sub-band at
     * 25,000.
     *
     * AND THE DIRECTION IS DELIBERATE, BECAUSE THE OTHER ONE CANNOT BE TESTED
     * AGAINST THIS SEED. The intuitive case to write is a professional
     * relabelling downwards to shrink the fee — and it is blind: every
     * category's own floor equals its cheapest sub-band (checked across all
     * ten), which is what `booking_band_bounds` returns for a booking with no
     * product, so a re-derived floor would produce the identical number and the
     * assertion could never fail. The first version of this test was written
     * that way and stayed green through a break test that rewrote
     * `freeze_booking_band` to re-derive on every product change — the
     * `ACTIVITY_FLOOR` class, where a case reads as coverage and asserts that a
     * number equals itself. Upwards is the direction the data can distinguish.
     */
    const { rows: bands } = await pg.admin.query(
      `select slug, low from public.category_price_bands
        where category_slug = 'painting'
        order by low desc`,
    );
    const dearest = bands[0] as { slug: string; low: number };

    const id = await book(null);
    await complete(id, 95 * 60);
    const before = await money(id);

    // The premise, asserted rather than assumed: this sub-band's floor really
    // is a different number from the one frozen onto the booking.
    expect(Number(dearest.low)).toBeGreaterThan(Number(before.band_min));

    await pg.admin.query(
      `update public.bookings
          set band_slug = $2, band_source = 'professional'
        where id = $1`,
      [id, dearest.slug],
    );

    const after = await money(id);
    expect(after.band_min).toEqual(before.band_min);
  });

  it("still moves no figure when a stated product is relabelled", async () => {
    /*
     * THE WINDOW IS THE APPLICATION'S RULE, NOT THE DATABASE'S, AND THIS TEST
     * SAYS SO RATHER THAN IMPLYING OTHERWISE. It was first written as "refused
     * outright once a band has been stated" — and it passed, which read as
     * proof, while the update it ran had plainly succeeded: the only thing the
     * assertion established was that the money had not moved. `canNameBand`
     * requires a null `band_slug` and the panel is not offered otherwise, so no
     * real path reaches this; the SQL permits it.
     *
     * Which is the useful fact to have pinned, because it is where the safety
     * actually comes from. Even on the relabel the product's own rule forbids,
     * nothing a dispute is argued from changes — the floor, the revision and
     * the split are all `freeze_booking_band`'s, whatever the caller does to
     * the label.
     */
    const id = await book("room-supplied", "model");
    await complete(id, 95 * 60);

    const before = await money(id);
    await pg.admin.query(
      `update public.bookings
          set band_slug = 'touch-up', band_source = 'professional'
        where id = $1`,
      [id],
    );

    const { rows } = await pg.admin.query(
      "select band_slug, band_source from public.bookings where id = $1",
      [id],
    );
    // The label did move: this is not a refusal, and calling it one would be a
    // comment describing behaviour the code does not have.
    expect(rows[0].band_slug).toBe("touch-up");
    expect(rows[0].band_source).toBe("professional");

    expect(await money(id)).toEqual(before);
  });
});
