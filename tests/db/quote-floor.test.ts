import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The floor of a quote belongs to whoever is actually doing the job.
 *
 * WHAT THIS REPLACES. `quoted_min` was the category's floor whoever held the
 * booking, so the number a professional sets on their own dashboard reached
 * their card and then nothing — not the review screen, not the commission
 * basis, not the receipt. A control whose value changes nothing downstream is
 * one people stop setting honestly.
 *
 * WHY IT IS A TRIGGER AND NOT FOUR CALL SITES. A booking gains or loses a
 * professional through createBooking, chooseProvider, claimJob, declineJob and
 * the dispatch sweep. The one that matters most is the hand-off: a job widened
 * away from somebody who starts at Rs 2,000 and claimed by somebody who starts
 * at Rs 900 must not charge the second person a commission floor built from the
 * first person's price.
 */

const ANITA = "aaaaaaaa-7333-4333-8333-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-7444-4444-8444-bbbbbbbbbbbb";
const SITA = "cccccccc-7555-4555-8555-cccccccccccc";

/*
 * Plumbing's published band, READ FROM THE CATALOGUE rather than written here.
 * It was hardcoded and broke the day the band was researched and moved — a test
 * that pins a product decision fails every time the decision legitimately
 * changes, which teaches people to edit tests instead of reading them.
 */
let BAND: { low: number; high: number };

let pg: Harness;
let cheap: string;
let dear: string;
let cheapRate: number;
let dearRate: number;
let address: string;
let counter = 0;

async function booking(providerId: string | null): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, 'plumbing', $4, 'Tap is dripping', $5, $6)
     returning id`,
    [
      `SK-QF${(counter += 1)}`,
      ANITA,
      providerId,
      address,
      BAND.low,
      BAND.high,
    ],
  );
  return rows[0].id as string;
}

/** Walk a booking to the state where a final amount is legal to record. */
async function finish(id: string, amount: number): Promise<void> {
  for (const status of ["accepted", "en_route", "in_progress", "completed"]) {
    await pg.admin.query(
      "update public.bookings set status = $1 where id = $2",
      [status, id],
    );
  }
  await pg.admin.query(
    "update public.bookings set final_amount = $1 where id = $2",
    [amount, id],
  );
}

async function quote(id: string): Promise<{ min: number; max: number }> {
  const { rows } = await pg.admin.query(
    "select quoted_min, quoted_max from public.bookings where id = $1",
    [id],
  );
  return { min: Number(rows[0].quoted_min), max: Number(rows[0].quoted_max) };
}

beforeAll(async () => {
  pg = await startPostgres();

  const { rows: band } = await pg.admin.query(
    "select base_price_min, base_price_max from public.categories where slug = 'plumbing'",
  );
  BAND = {
    low: Number(band[0].base_price_min),
    high: Number(band[0].base_price_max),
  };

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
    [SITA, "Sita Rai", "provider"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779814${id.slice(0, 6)}`, role],
    );
  }

  // Derived from the band so the "cheap" one is its floor and the "dear" one
  // is comfortably inside — the relationship is what the tests assert, not the
  // particular rupees.
  cheapRate = BAND.low;
  dearRate = Math.round((BAND.low + BAND.high) / 2 / 100) * 100;

  for (const [profile, name, rate] of [
    [KRISHNA, "Krishna Tamang", cheapRate],
    [SITA, "Sita Rai", dearRate],
  ] as const) {
    const { rows } = await pg.admin.query(
      `insert into public.providers (profile_id, display_name, base_rate, availability)
       values ($1, $2, $3, 'now') returning id`,
      [profile, name, rate],
    );
    const id = rows[0].id as string;
    await pg.admin.query(
      "insert into public.provider_categories (provider_id, category_slug) values ($1, 'plumbing')",
      [id],
    );
    if (profile === KRISHNA) cheap = id;
    else dear = id;
  }

  const { rows: addressRows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  address = addressRows[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the floor follows the professional", () => {
  it("rises to the rate of whoever takes the job", async () => {
    const id = await booking(null);
    expect((await quote(id)).min).toBe(BAND.low);

    await pg.admin.query(
      "update public.bookings set provider_id = $1 where id = $2",
      [dear, id],
    );

    expect(await quote(id)).toEqual({ min: dearRate, max: BAND.high });
  });

  it("goes back to ours when the job is released", async () => {
    // A departed professional's price is not a promise about whoever comes
    // next, and the customer is about to be shown this number again.
    const id = await booking(dear);

    await pg.admin.query(
      "update public.bookings set provider_id = null where id = $1",
      [id],
    );

    expect((await quote(id)).min).toBe(BAND.low);
  });

  it("does not charge a replacement the first professional's floor", async () => {
    /*
     * The whole reason this is a trigger. Sita starts at 2,400; the job is
     * widened; Krishna, who starts at 900, claims it. The commission is
     * charged on max(final_amount, quoted_min), so a stale 2,400 would take a
     * fee from Krishna built out of a price he never set.
     */
    const id = await booking(dear);
    await pg.admin.query(
      "update public.bookings set provider_id = null where id = $1",
      [id],
    );
    await pg.admin.query(
      "update public.bookings set provider_id = $1 where id = $2",
      [cheap, id],
    );

    expect((await quote(id)).min).toBe(cheapRate);
  });

  it("never lifts the floor above our ceiling", async () => {
    // A multi-trade professional is clamped against the union of their bands,
    // so they can legally sit above a given category's maximum. quoted_min
    // must still never cross quoted_max — the table's own check refuses it.
    await pg.admin.query(
      "update public.providers set base_rate = $1 where id = $2",
      [BAND.high * 4, dear],
    );

    try {
      const id = await booking(null);
      await pg.admin.query(
        "update public.bookings set provider_id = $1 where id = $2",
        [dear, id],
      );

      expect(await quote(id)).toEqual({ min: BAND.high, max: BAND.high });
    } finally {
      // Restored even on a failure: the band check at the bottom of this file
      // reads every listing, and a leftover would fail it for the wrong reason.
      await pg.admin.query(
        "update public.providers set base_rate = $1 where id = $2",
        [dearRate, dear],
      );
    }
  });
});

describe("a priced job's quote never moves again", () => {
  it("refuses the change for the service role too", async () => {
    /*
     * `enforce_booking_immutability` lets the service role through, which is
     * right for everything it guards. This one has no legitimate caller at
     * all: a quote that moves after somebody has been charged against it makes
     * every receipt arguable.
     */
    const id = await booking(cheap);
    await finish(id, 1500);

    await expect(
      pg.admin.query(
        "update public.bookings set quoted_min = 1000 where id = $1",
        [id],
      ),
    ).rejects.toThrow(/quote cannot change/i);
  });

  it("leaves the floor alone when a settled job changes hands", async () => {
    const id = await booking(cheap);
    await finish(id, 1500);

    await pg.admin.query(
      "update public.bookings set provider_id = null where id = $1",
      [id],
    );

    expect((await quote(id)).min).toBe(cheapRate);
  });
});

describe("the guards that make this survive an edit", () => {
  it("fires the floor sync after the immutability check", async () => {
    /*
     * LOAD-BEARING AND INVISIBLE. Postgres fires BEFORE triggers in
     * alphabetical order. `enforce_booking_immutability` raises whenever
     * quoted_min changed and auth.uid() is not null, and `claimJob` writes
     * through the professional's OWN session. Invert this ordering and
     * claiming an open job starts failing with "Prices and payment state are
     * not editable from a browser", with nothing in the application code to
     * explain it.
     */
    const { rows } = await pg.admin.query(
      `select t.tgname
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where c.relname = 'bookings'
          and not t.tgisinternal
          and t.tgname in ('bookings_enforce_immutability', 'bookings_sync_quote_floor')
        order by t.tgname`,
    );

    expect(rows.map((row) => row.tgname)).toEqual([
      "bookings_enforce_immutability",
      "bookings_sync_quote_floor",
    ]);
  });

  it("has no professional listed outside their own band", async () => {
    /*
     * `clampRate` has always said a "from" price may not leave the published
     * band — and it only ever ran when a professional pressed Save. Approval
     * wrote a flat Rs 500, below every floor we publish, so every professional
     * approved through the real flow was listed at a price the product refuses
     * from them. The catalog is read rather than a list somebody maintains, so
     * a listing added later is checked the moment it exists.
     */
    const { rows } = await pg.admin.query(
      `with bands as (
         select pc.provider_id,
                min(c.base_price_min) as low,
                max(c.base_price_max) as high
           from public.provider_categories pc
           join public.categories c on c.slug = pc.category_slug
          group by pc.provider_id
       )
       select p.display_name, p.base_rate, b.low, b.high
         from public.providers p
         join bands b on b.provider_id = p.id
        where p.base_rate < b.low or p.base_rate > b.high`,
    );

    expect(rows).toEqual([]);
  });
});

describe("the band we published is kept apart from the price they set", () => {
  /*
   * WHY BOTH FLOORS EXIST. `quoted_min` is now the holding professional's own
   * starting price. `band_min` is ours, as published when the booking was made.
   * Before this column, the pricing signal compared settled amounts against
   * `quoted_min` and therefore read "this professional is expensive" as "our
   * band is too high" — the measurement that is meant to tell us what a trade
   * really costs, answering a different question than the one it was asked.
   */
  it("fills the band from the category even when the caller omits it", async () => {
    // The insert above never mentions band_min. createBooking is the only
    // caller today; the trigger is what makes a second one safe.
    const id = await booking(dear);
    const { rows } = await pg.admin.query(
      "select band_min from public.bookings where id = $1",
      [id],
    );

    expect(Number(rows[0].band_min)).toBe(BAND.low);
  });

  it("holds the band still while the professional's floor moves", async () => {
    const id = await booking(null);
    await pg.admin.query(
      "update public.bookings set provider_id = $1 where id = $2",
      [dear, id],
    );

    const { rows } = await pg.admin.query(
      "select band_min, quoted_min from public.bookings where id = $1",
      [id],
    );
    expect(Number(rows[0].band_min)).toBe(BAND.low);
    expect(Number(rows[0].quoted_min)).toBe(dearRate);
  });

  it("cannot be rewritten, by anybody, after the fact", async () => {
    // Pinned rather than raised on: every ordinary status write touches this
    // row and none of them should have to know the column exists.
    const id = await booking(cheap);
    await pg.admin.query(
      "update public.bookings set band_min = 50 where id = $1",
      [id],
    );

    const { rows } = await pg.admin.query(
      "select band_min from public.bookings where id = $1",
      [id],
    );
    expect(Number(rows[0].band_min)).toBe(BAND.low);
  });

  it("counts a job under our band separately from one under theirs", async () => {
    /*
     * Sita starts at 2,400 and settles a job at 1,500. That is under HER floor
     * and comfortably inside OUR band — so it is a commission-floor case for
     * one person, and says nothing at all about plumbing being overpriced.
     */
    const id = await booking(null);
    // Assigning through an update is what moves quoted_min to her rate — the
    // sync is a BEFORE UPDATE trigger, and createBooking does the same
    // arithmetic in TypeScript on the insert.
    await pg.admin.query(
      "update public.bookings set provider_id = $1 where id = $2",
      [dear, id],
    );
    await finish(id, 1500);
    await pg.admin.query(
      "update public.bookings set payment_status = 'paid' where id = $1",
      [id],
    );

    const { rows } = await pg.admin.query(
      `select below_band_jobs, below_quote_jobs
         from public.category_pricing_signals
        where category_slug = 'plumbing'`,
    );

    expect(Number(rows[0].below_quote_jobs)).toBeGreaterThan(0);
    expect(Number(rows[0].below_band_jobs)).toBe(0);
  });
});
