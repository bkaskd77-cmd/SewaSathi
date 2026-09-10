import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * Customer-side fraud, against real policies.
 *
 * The rule worth more than the rest: A CUSTOMER CANNOT LIFT THEIR OWN
 * CONFIRMATION GATE. `bookings` already lets somebody update their own open
 * booking, and RLS is row-level — so without the trigger they could write
 * `confirmation_required = false` from a browser and skip the entire trip
 * protection. It is the same shape as the bug that let a customer set their
 * own `final_amount`, which was also found here rather than by reading code.
 */

const ANITA = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MANOJ = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const ADMIN = "cccccccc-3333-4333-8333-cccccccccccc";

let pg: Harness;
let anitaBooking: string;
let anitaAddress: string;
let manojProvider: string;

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [MANOJ, "Manoj Yadav", "provider"],
    [ADMIN, "Admin", "admin"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779811111${id.slice(0, 3)}`, role],
    );
  }

  const { rows: addressRows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  anitaAddress = addressRows[0].id as string;

  const { rows: providerRows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, 'Manoj Yadav', 900) returning id`,
    [MANOJ],
  );
  manojProvider = providerRows[0].id as string;

  const { rows: bookingRows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max, confirmation_required)
     values ('SK-CONF1', $1, $2, 'plumbing', $3, 'Tap is leaking', 900, 4500, true)
     returning id`,
    [ANITA, manojProvider, anitaAddress],
  );
  anitaBooking = bookingRows[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("a customer cannot lift their own confirmation gate", () => {
  it("refuses un-requiring the confirmation", async () => {
    /*
     * The whole trip protection rests on this. RLS is row-level: the policy
     * that lets Anita cancel her own booking also lets her write every column
     * on it, and Postgres has no per-column clause.
     */
    const client = await pg.asUser(ANITA);
    await expect(
      client.query(
        "update public.bookings set confirmation_required = false where id = $1",
        [anitaBooking],
      ),
    ).rejects.toThrow(/not the customer's to set/i);
    await client.end();
  });

  it("refuses moving their own hold window", async () => {
    const client = await pg.asUser(ANITA);
    await expect(
      client.query(
        "update public.bookings set confirmation_hold_until = now() + interval '10 days' where id = $1",
        [anitaBooking],
      ),
    ).rejects.toThrow(/set by the server/i);
    await client.end();
  });

  it("lets the server confirm it, which is the whole point", async () => {
    // The service role writes this after the customer taps. `auth.uid()` is
    // null for it, which is how the trigger tells the two apart.
    await pg.admin.query(
      "update public.bookings set confirmed_at = now() where id = $1",
      [anitaBooking],
    );
    const { rows } = await pg.admin.query(
      "select confirmed_at from public.bookings where id = $1",
      [anitaBooking],
    );
    expect(rows[0].confirmed_at).not.toBeNull();
  });

  it("refuses rewriting a confirmation that already happened", async () => {
    const client = await pg.asUser(ANITA);
    await expect(
      client.query(
        "update public.bookings set confirmed_at = now() where id = $1",
        [anitaBooking],
      ),
    ).rejects.toThrow(/cannot be rewritten/i);
    await client.end();
  });
});

describe("arrival evidence is visible to both sides and nobody else", () => {
  beforeAll(async () => {
    await pg.admin.query(
      `insert into public.booking_arrivals
         (booking_id, provider_id, coarse_lat, coarse_lng, waited_minutes, contact_attempts)
       values ($1, $2, 27.68, 85.31, 15, 2)`,
      [anitaBooking, manojProvider],
    );
  });

  it("lets the professional see their own arrival", async () => {
    const client = await pg.asUser(MANOJ);
    const { rows } = await client.query(
      "select id from public.booking_arrivals where booking_id = $1",
      [anitaBooking],
    );
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("lets the customer see it too", async () => {
    /*
     * Not a courtesy — it is the other half of the evidence. Somebody accused
     * of not being there has to be able to see what is being claimed.
     */
    const client = await pg.asUser(ANITA);
    const { rows } = await client.query(
      "select arrived_at from public.booking_arrivals where booking_id = $1",
      [anitaBooking],
    );
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("shows nothing to a stranger or to somebody logged out", async () => {
    const anon = await pg.asAnon();
    const { rows: anonRows } = await anon.query(
      "select id from public.booking_arrivals",
    );
    expect(anonRows).toHaveLength(0);
    await anon.end();
  });

  it("does not let a professional write their own arrival from a browser", async () => {
    // A row a client can write is a row an attacker can forge, and this one
    // moves money.
    const client = await pg.asUser(MANOJ);
    await expect(
      client.query(
        `insert into public.booking_arrivals (booking_id, provider_id)
         values ($1, $2)`,
        [anitaBooking, manojProvider],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.end();
  });

  it("keeps the location coarse", async () => {
    // numeric(6,2) is about a kilometre. It answers "plausibly in the right
    // part of the city" and cannot answer "where exactly at 9:14".
    const { rows } = await pg.admin.query(
      "select coarse_lat from public.booking_arrivals where booking_id = $1",
      [anitaBooking],
    );
    expect(Number(rows[0].coarse_lat)).toBe(27.68);
  });
});

describe("the claim and the customer's record", () => {
  beforeAll(async () => {
    await pg.admin.query(
      `insert into public.no_show_claims
         (booking_id, provider_id, customer_id, status, trip_rupees_paid, debt_rupees)
       values ($1, $2, $3, 'upheld', 350, 0)`,
      [anitaBooking, manojProvider, ANITA],
    );
    await pg.admin.query(
      `insert into public.customer_risk (profile_id, no_shows, trip_debt_rupees)
       values ($1, 1, 0)`,
      [ANITA],
    );
  });

  it("lets the customer read the claim made about them", async () => {
    const client = await pg.asUser(ANITA);
    const { rows } = await client.query(
      "select status from public.no_show_claims",
    );
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("lets the customer read their own record", async () => {
    // Somebody asked for a deposit is entitled to see the count it came from.
    // A ladder nobody can read is a trap.
    const client = await pg.asUser(ANITA);
    const { rows } = await client.query(
      "select no_shows, trip_debt_rupees from public.customer_risk",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].no_shows).toBe(1);
    await client.end();
  });

  it("does not let them edit it", async () => {
    const client = await pg.asUser(ANITA);
    const result = await client.query(
      "update public.customer_risk set no_shows = 0 where profile_id = $1",
      [ANITA],
    );
    expect(result.rowCount).toBe(0);
    await client.end();
  });

  it("hides one customer's record from another", async () => {
    const client = await pg.asUser(MANOJ);
    const { rows } = await client.query(
      "select profile_id from public.customer_risk",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("keeps the paid amount separate from what is owed", async () => {
    /*
     * The professional is paid whether or not anything is recovered. A trip
     * payment conditional on recovery would be no payment at all — it would
     * move the uncertainty onto the person least able to absorb it.
     */
    const { rows } = await pg.admin.query(
      "select trip_rupees_paid, debt_rupees from public.no_show_claims where booking_id = $1",
      [anitaBooking],
    );
    expect(rows[0].trip_rupees_paid).toBe(350);
    expect(rows[0].debt_rupees).toBe(0);
  });
});

describe("customer match keys are hashed and out of reach", () => {
  beforeAll(async () => {
    await pg.admin.query(
      `insert into public.customer_match_keys (profile_id, kind, key_hash)
       values ($1, 'name', repeat('a', 64))`,
      [ANITA],
    );
  });

  it("is readable by an admin only", async () => {
    const admin = await pg.asUser(ADMIN);
    const { rows: adminRows } = await admin.query(
      "select id from public.customer_match_keys",
    );
    expect(adminRows).toHaveLength(1);
    await admin.end();

    const owner = await pg.asUser(ANITA);
    const { rows: ownerRows } = await owner.query(
      "select id from public.customer_match_keys",
    );
    expect(ownerRows).toHaveLength(0);
    await owner.end();
  });

  it("refuses a hash that is not one", async () => {
    await expect(
      pg.admin.query(
        `insert into public.customer_match_keys (profile_id, kind, key_hash)
         values ($1, 'name', 'plain text')`,
        [MANOJ],
      ),
    ).rejects.toThrow();
  });
});

describe("an upheld no-show marks the door, not just the account", () => {
  it("counts against the address", async () => {
    /*
     * Trust belongs to the address. A customer of three years can send
     * somebody to a door they invented this morning, and it is the door that
     * wasted the trip.
     */
    await pg.admin.query(
      "update public.addresses set upheld_no_shows = upheld_no_shows + 1 where id = $1",
      [anitaAddress],
    );
    const { rows } = await pg.admin.query(
      "select upheld_no_shows from public.addresses where id = $1",
      [anitaAddress],
    );
    expect(rows[0].upheld_no_shows).toBe(1);
  });
});
