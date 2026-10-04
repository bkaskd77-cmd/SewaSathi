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
    /*
     * AND THE PAYMENT IT CLAIMS. This fixture set `trip_rupees_paid = 350` with no
     * ledger row — which was an accurate model of the product until
     * `trip_compensation` existed, and is now exactly the state "a past-tense money
     * column has money behind it" exists to catch. A fixture that cannot satisfy the
     * invariant is a fixture describing a bug.
     */
    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, booking_id, kind, amount_rupees)
       values ($1, $2, 'trip_compensation', 350)`,
      [manojProvider, anitaBooking],
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

/*
 * WHAT USED TO BE HERE: two cases over `customer_match_keys` — that only an admin
 * could read it, and that a non-hash was refused. Both were correct and both are
 * gone with the table (`20261002000006`), because nothing ever wrote a key and the
 * gate the matcher would have fed is `armConfirmation`, which is wired. Deleting a
 * passing test is worth a sentence: these did not become wrong, their subject
 * stopped existing.
 */

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

describe("one incident counts once, however many ways it was recorded", () => {
  /*
   * THE DEFECT THIS CLOSES. `customer_risk.no_shows` was INCREMENTED, and the
   * moment a second path writes to it the same visit is counted twice — a
   * professional ticking `not_at_address` and then filing a formal no-show
   * claim for the same booking. A counter cannot be reconciled after that: the
   * number is of RECORDS, not of things that happened, and nobody can tell
   * which by looking.
   *
   * It is also what makes decay real. A count recomputed over a window simply
   * stops including what is old; an incremented one would need somebody to
   * remember to decrement it, which is decay as decoration.
   */

  /*
   * ITS OWN CUSTOMER, because the tests above leave Anita with an upheld
   * no-show claim and a counter that starts at one. Sharing her would make
   * every number here depend on what ran before it, which is the kind of test
   * that passes until somebody reorders the file.
   */
  const RIA = "dddddddd-4444-4444-8444-dddddddddddd";
  let riaAddress: string;
  let counter = 0;

  beforeAll(async () => {
    await pg.admin.query("insert into auth.users (id) values ($1)", [RIA]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, 'Ria Gurung', '+9779812222444', 'customer')
       on conflict (id) do nothing`,
      [RIA],
    );
    const { rows } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Sanepa', 'Red gate')
       returning id`,
      [RIA],
    );
    riaAddress = rows[0].id as string;
  });

  async function bookingFor(input: {
    status?: string;
    ageMonths?: number;
  } = {}): Promise<string> {
    counter += 1;
    // Every booking starts pending — `enforce_booking_transition` says so, and
    // a fixture that wrote a finished job directly would be testing a row the
    // product cannot produce.
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, category_slug, address_id,
          description, quoted_min, quoted_max, created_at, scheduled_for)
       values ($1, $2, $3, 'plumbing', $4, 'Tap is dripping', 900, 4500,
               now() - ($5 || ' months')::interval, $6)
       returning id`,
      [
        `SK-RISK${counter}`,
        RIA,
        manojProvider,
        riaAddress,
        String(input.ageMonths ?? 0),
        new Date(Date.UTC(2027, 0, counter, 8, 15)).toISOString(),
      ],
    );
    const id = rows[0].id as string;

    if (input.status === "completed") {
      for (const step of ["accepted", "en_route", "in_progress", "completed"]) {
        await pg.admin.query(
          "update public.bookings set status = $1 where id = $2",
          [step, id],
        );
      }
    }
    return id;
  }

  async function risk(): Promise<{ noShows: number; falseAddresses: number; completed: number }> {
    await pg.admin.query("select public.refresh_customer_risk($1)", [RIA]);
    const { rows } = await pg.admin.query(
      "select no_shows, false_addresses, completed_jobs from public.customer_risk where profile_id = $1",
      [RIA],
    );
    return {
      noShows: Number(rows[0]?.no_shows ?? 0),
      falseAddresses: Number(rows[0]?.false_addresses ?? 0),
      completed: Number(rows[0]?.completed_jobs ?? 0),
    };
  }

  async function clear(): Promise<void> {
    await pg.admin.query("delete from public.customer_visit_flags");
    await pg.admin.query(
      "delete from public.bookings where reference like 'SK-RISK%'",
    );
  }

  it("counts a flagged visit once", async () => {
    await clear();
    const id = await bookingFor();
    await pg.admin.query(
      `insert into public.customer_visit_flags
         (booking_id, provider_id, customer_id, flag)
       values ($1, $2, $3, 'not_at_address')`,
      [id, manojProvider, RIA],
    );
    expect((await risk()).noShows).toBe(1);
  });

  it("STILL counts it once when the same visit is also claimed formally", async () => {
    /*
     * The whole point. Two paths, one booking, one incident — and the count
     * comes from `count(distinct b.id)` rather than from two writes that each
     * add one.
     */
    await clear();
    const id = await bookingFor();
    await pg.admin.query(
      `insert into public.customer_visit_flags
         (booking_id, provider_id, customer_id, flag)
       values ($1, $2, $3, 'not_at_address')`,
      [id, manojProvider, RIA],
    );
    await pg.admin.query(
      `insert into public.no_show_claims
         (booking_id, provider_id, customer_id, status)
       values ($1, $2, $3, 'upheld')
       on conflict (booking_id) do update set status = 'upheld'`,
      [id, manojProvider, RIA],
    );
    expect((await risk()).noShows).toBe(1);
  });

  it("refuses the same flag twice on one booking", async () => {
    await clear();
    const id = await bookingFor();
    const write = () =>
      pg.admin.query(
        `insert into public.customer_visit_flags
           (booking_id, provider_id, customer_id, flag)
         values ($1, $2, $3, 'abusive')`,
        [id, manojProvider, RIA],
      );
    await write();
    await expect(write()).rejects.toThrow(/duplicate key|unique/i);
  });

  it("counts two separate visits as two", async () => {
    // The guard is against double-counting one incident, not against counting.
    await clear();
    for (const id of [await bookingFor(), await bookingFor()]) {
      await pg.admin.query(
        `insert into public.customer_visit_flags
           (booking_id, provider_id, customer_id, flag)
         values ($1, $2, $3, 'not_at_address')`,
        [id, manojProvider, RIA],
      );
    }
    expect((await risk()).noShows).toBe(2);
  });

  it("stops counting a flag older than the window", async () => {
    /*
     * DECAY IS REAL BECAUSE THE NUMBER IS RECOMPUTED. Nothing decrements and
     * nothing has to be remembered — a booking outside the horizon is simply
     * not in the query any more.
     */
    await clear();
    const old = await bookingFor({ ageMonths: 18 });
    await pg.admin.query(
      `insert into public.customer_visit_flags
         (booking_id, provider_id, customer_id, flag)
       values ($1, $2, $3, 'not_at_address')`,
      [old, manojProvider, RIA],
    );
    expect((await risk()).noShows).toBe(0);
  });

  it("ages the credit out with the strikes, not after them", async () => {
    /*
     * `completed_jobs` retires strikes — that is what stops the ladder being a
     * ratchet. Ageing the strikes out on a 12-month window but keeping the
     * credit for ever would quietly harden it in the customer's favour; the
     * reverse would harden it against them. Both sides use the same horizon.
     */
    await clear();
    await bookingFor({ status: "completed", ageMonths: 0 });
    await bookingFor({ status: "completed", ageMonths: 18 });
    expect((await risk()).completed).toBe(1);
  });

  it("is the same answer run twice", async () => {
    // A recomputation that drifts is an increment wearing a different name.
    await clear();
    const id = await bookingFor();
    await pg.admin.query(
      `insert into public.customer_visit_flags
         (booking_id, provider_id, customer_id, flag)
       values ($1, $2, $3, 'address_unusable')`,
      [id, manojProvider, RIA],
    );
    const first = await risk();
    const second = await risk();
    expect(second).toEqual(first);
    expect(first.falseAddresses).toBe(1);
  });

  it("grants the customer no way to read what was recorded about them", async () => {
    /*
     * The uncomfortable half of the design, and deliberate. A record somebody
     * can read is one they will argue about on the spot with the professional
     * who wrote it, which is the retaliation channel the whole shape closes.
     * What protects them instead is that it decides nothing on its own.
     */
    await clear();
    const id = await bookingFor();
    await pg.admin.query(
      `insert into public.customer_visit_flags
         (booking_id, provider_id, customer_id, flag)
       values ($1, $2, $3, 'abusive')`,
      [id, manojProvider, RIA],
    );
    const ria = await pg.asUser(RIA);
    const { rows } = await ria.query(
      "select id from public.customer_visit_flags",
    );
    expect(rows).toHaveLength(0);
    await ria.end();
  });

  it("lets nobody write one through a browser", async () => {
    const manoj = await pg.asUser(MANOJ);
    await expect(
      manoj.query(
        `insert into public.customer_visit_flags
           (booking_id, provider_id, customer_id, flag)
         values ($1, $2, $3, 'abusive')`,
        [await bookingFor(), manojProvider, RIA],
      ),
    ).rejects.toThrow(/row-level security/i);
    await manoj.end();
  });
});

describe("the professional is actually paid for the trip", () => {
  /**
   * WHY THIS IS A DATABASE TEST AND NOT A UNIT ONE. The gap it closes was never a
   * wrong calculation — `TRIP_COMPENSATION.rupees` has been correct and written onto
   * `no_show_claims.trip_rupees_paid` since Phase 10. What was missing is that no row
   * existed anywhere a payout could find, so only a test that looks at
   * `provider_ledger` and `provider_balance` can tell the two states apart. A unit
   * test of the amount would have passed throughout.
   */
  /*
   * Each booking gets its own slot: `enforce_slot_capacity` refuses a second one for
   * the same professional at the same time, which is correct and nothing to do with
   * trips — three cases failed on it before the offset was added.
   */
  let slot = 90;

  async function upheldClaim(reference: string): Promise<string> {
    slot += 1;
    const { rows: bookingRows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, category_slug, address_id,
          description, quoted_min, quoted_max, scheduled_for)
       values ($1, $2, $3, 'plumbing', $4, 'Nobody home', 900, 4500,
               now() + ($5 || ' days')::interval)
       returning id`,
      [reference, ANITA, manojProvider, anitaAddress, String(slot)],
    );
    return bookingRows[0].id as string;
  }

  /**
   * The rows `settleNoShowClaim` writes, in its order: the ledger first, then the
   * claim. Both, because a payment with no claim behind it is the converse fault and
   * the invariant cases below check for it — a fixture that writes only half of what
   * the product writes would make one of them fail for a reason the product does not
   * have.
   */
  async function payTrip(bookingId: string): Promise<void> {
    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, booking_id, kind, amount_rupees, note)
       values ($1, $2, 'trip_compensation', 350, 'Trip to an address where nobody answered')`,
      [manojProvider, bookingId],
    );
    await pg.admin.query(
      `insert into public.no_show_claims
         (booking_id, provider_id, customer_id, status, trip_rupees_paid)
       values ($1, $2, $3, 'upheld', 350)
       on conflict (booking_id) do update set trip_rupees_paid = 350`,
      [bookingId, manojProvider, ANITA],
    );
  }

  it("raises what we owe them, which is what a payout run can see", async () => {
    const booking = await upheldClaim("SK-TRIP1");

    const { rows: before } = await pg.admin.query(
      "select public.provider_balance($1) as balance",
      [manojProvider],
    );
    await payTrip(booking);
    const { rows: after } = await pg.admin.query(
      "select public.provider_balance($1) as balance",
      [manojProvider],
    );

    expect(after[0].balance - before[0].balance).toBe(350);
  });

  /*
   * ONE PAYMENT PER BOOKING, REFUSED BY THE DATABASE. A claim can be looked at again
   * — the queue allows it — and `settleNoShowClaim` is an ordinary update that cannot
   * know whether it has run before. The index is the rule, not the application's
   * memory, which is the idiom `our_reference` and the recovery indexes already use.
   */
  it("refuses a second payment for the same trip", async () => {
    const booking = await upheldClaim("SK-TRIP2");
    await payTrip(booking);

    await expect(payTrip(booking)).rejects.toThrow();
  });

  /*
   * THE DEBT IS THE CUSTOMER'S AND IS NOT ON THIS ACCOUNT. If `trip_compensation`
   * ever reached `provider_outstanding`, paying somebody for a wasted trip would read
   * as them owing us money and the redo sweep would start recovering it out of their
   * next payout — the opposite of what the terms promise.
   */
  it("is not a guarantee debt against the professional", async () => {
    const booking = await upheldClaim("SK-TRIP3");

    const { rows: before } = await pg.admin.query(
      "select public.provider_outstanding($1) as owed",
      [manojProvider],
    );
    await payTrip(booking);
    const { rows: after } = await pg.admin.query(
      "select public.provider_outstanding($1) as owed",
      [manojProvider],
    );

    expect(after[0].owed).toBe(before[0].owed);
  });
});

describe("a past-tense money column has money behind it", () => {
  /**
   * THE OTHER HALF OF `tests/unit/money-assertions.test.ts`. That one makes a new
   * `*_paid` column impossible to add without declaring what pays it; this one
   * checks the payment is actually there, against a database, for the declarations
   * whose timing is `immediate`.
   *
   * It is written against the rows rather than against `settleNoShowClaim`, because
   * the failure it exists to catch was never in that function's logic — the figure
   * was always right. What was missing was a row somewhere else entirely, and only a
   * query that starts from the claim and goes looking can tell those apart.
   */
  it("pays every upheld no-show claim it says it paid", async () => {
    const { rows } = await pg.admin.query(`
      select c.booking_id, c.trip_rupees_paid,
             (select count(*) from public.provider_ledger l
               where l.booking_id = c.booking_id
                 and l.kind = 'trip_compensation') as ledger_rows
        from public.no_show_claims c
       where c.trip_rupees_paid > 0
    `);

    const unpaid = rows.filter((row) => Number(row.ledger_rows) === 0);
    expect(
      unpaid.map((row) => row.booking_id),
      "these claims say they paid the professional and no trip_compensation row exists",
    ).toEqual([]);
  });

  /*
   * And the converse, which is the one a double-payment would trip: a ledger row
   * for a trip nobody claimed. The partial unique index stops two rows per booking;
   * this stops a row with no claim behind it at all.
   */
  it("pays nothing for a trip nobody claimed", async () => {
    const { rows } = await pg.admin.query(`
      select l.booking_id
        from public.provider_ledger l
       where l.kind = 'trip_compensation'
         and not exists (
           select 1 from public.no_show_claims c where c.booking_id = l.booking_id
         )
    `);

    expect(rows.map((row) => row.booking_id)).toEqual([]);
  });
});

describe("a trip debt comes off a later bill, once", () => {
  /**
   * WHAT THIS PINS. The terms promise the debt is added to the next booking, capped
   * at a quarter of that bill. `recordFinalAmount` is re-enterable — a professional
   * correcting a typed figure runs it again — so the thing worth proving against a
   * database is not the arithmetic (that is `tripDebtOnBill`, pure and tested) but
   * that the second pass through recovers nothing.
   *
   * The rows are written the way `recordFinalAmount` writes them: the booking column
   * and the customer's balance, in that order.
   */
  /*
   * ITS OWN CUSTOMER AND ITS OWN DOOR, for the reason the block above states: the
   * cases here read a balance going down, so sharing a customer with a describe that
   * writes claims would make every figure depend on what ran before it.
   */
  const DEBTOR = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
  let debtorAddress: string;

  beforeAll(async () => {
    await pg.admin.query("insert into auth.users (id) values ($1)", [DEBTOR]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, 'Bina Shrestha', '+9779812222555', 'customer')
       on conflict (id) do nothing`,
      [DEBTOR],
    );
    const { rows } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
       returning id`,
      [DEBTOR],
    );
    debtorAddress = rows[0].id as string;
  });

  let slot = 200;

  async function billableBooking(
    reference: string,
    method: string,
    finish = true,
  ): Promise<string> {
    slot += 1;
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, category_slug, address_id,
          description, quoted_min, quoted_max, payment_method, scheduled_for)
       values ($1, $2, $3, 'plumbing', $4, 'Tap again', 900, 4500, $5,
               now() + ($6 || ' days')::interval)
       returning id`,
      [reference, DEBTOR, manojProvider, debtorAddress, method, String(slot)],
    );
    const id = rows[0].id as string;
    /* A final amount is only legal on a finished job — `bookings_final_amount_shape`
       — and the status machine refuses a jump, so the walk is the fixture. */
    if (finish) {
      for (const step of ["accepted", "en_route", "in_progress", "completed"]) {
        await pg.admin.query("update public.bookings set status = $1 where id = $2", [
          step,
          id,
        ]);
      }
    }
    return id;
  }

  async function setDebt(rupees: number): Promise<void> {
    await pg.admin.query(
      `insert into public.customer_risk (profile_id, trip_debt_rupees)
       values ($1, $2)
       on conflict (profile_id) do update set trip_debt_rupees = $2,
         trip_debt_disputed_at = null`,
      [DEBTOR, rupees],
    );
  }

  async function debtNow(): Promise<number> {
    const { rows } = await pg.admin.query(
      "select trip_debt_rupees from public.customer_risk where profile_id = $1",
      [DEBTOR],
    );
    return rows[0]?.trip_debt_rupees as number;
  }

  /** One pass of what `recordFinalAmount` does, guarded on the column. */
  async function record(bookingId: string, amount: number): Promise<void> {
    const { rows } = await pg.admin.query(
      "select trip_debt_added_rupees, payment_method, provider_id from public.bookings where id = $1",
      [bookingId],
    );
    if (rows[0].trip_debt_added_rupees !== null) return; // already judged

    /* The dispute check `tripDebtOnBill` makes, in the same order: a held debt stops
       the recovery before any arithmetic and leaves the column null. */
    const { rows: risk } = await pg.admin.query(
      "select trip_debt_rupees, trip_debt_disputed_at from public.customer_risk where profile_id = $1",
      [DEBTOR],
    );
    if (risk[0]?.trip_debt_disputed_at !== null) {
      await pg.admin.query(
        "update public.bookings set final_amount = $1 where id = $2",
        [amount, bookingId],
      );
      return;
    }

    const outstanding = await debtNow();
    const add = Math.min(outstanding, Math.floor((amount * 2500) / 10_000));

    await pg.admin.query(
      "update public.bookings set final_amount = $1, trip_debt_added_rupees = $2 where id = $3",
      [amount, add, bookingId],
    );
    if (add > 0) {
      await pg.admin.query(
        "update public.customer_risk set trip_debt_rupees = $1 where profile_id = $2",
        [outstanding - add, DEBTOR],
      );
      if (rows[0].payment_method === "cash") {
        await pg.admin.query(
          `insert into public.provider_ledger (provider_id, booking_id, kind, amount_rupees, note)
           values ($1, $2, 'commission_due', $3, 'Trip debt collected in cash with the bill')`,
          [rows[0].provider_id, bookingId, add],
        );
      }
    }
  }

  it("takes a quarter of the bill and no more", async () => {
    await setDebt(3000);
    const booking = await billableBooking("SK-DEBT1", "esewa");
    await record(booking, 4000);

    const { rows } = await pg.admin.query(
      "select trip_debt_added_rupees from public.bookings where id = $1",
      [booking],
    );
    expect(rows[0].trip_debt_added_rupees).toBe(1000);
    expect(await debtNow()).toBe(2000);
  });

  /*
   * THE CASE THE COLUMN EXISTS FOR. Without it the second call recovers again, from
   * a customer already charged once on this booking.
   */
  it("recovers nothing when the amount is recorded a second time", async () => {
    await setDebt(3000);
    const booking = await billableBooking("SK-DEBT2", "esewa");

    await record(booking, 4000);
    const afterFirst = await debtNow();
    await record(booking, 4200);
    expect(await debtNow()).toBe(afterFirst);

    const { rows } = await pg.admin.query(
      "select trip_debt_added_rupees from public.bookings where id = $1",
      [booking],
    );
    expect(rows[0].trip_debt_added_rupees).toBe(1000);
  });

  /*
   * CASH IS THE OTHER DIRECTION. The collecting professional physically takes those
   * rupees with the bill, so they owe them on — otherwise the recovery is quietly a
   * gift to whoever happened to collect it.
   */
  it("bills a cash collector for what they took", async () => {
    await setDebt(2000);
    const booking = await billableBooking("SK-DEBT3", "cash");
    await record(booking, 4000);

    const { rows } = await pg.admin.query(
      `select amount_rupees from public.provider_ledger
        where booking_id = $1 and kind = 'commission_due'`,
      [booking],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_rupees).toBe(1000);
  });

  it("bills nobody on a digital job, where the money reaches us directly", async () => {
    await setDebt(2000);
    const booking = await billableBooking("SK-DEBT4", "khalti");
    await record(booking, 4000);

    const { rows } = await pg.admin.query(
      `select 1 from public.provider_ledger
        where booking_id = $1 and kind = 'commission_due'`,
      [booking],
    );
    expect(rows).toHaveLength(0);
  });

  /*
   * THE DISPUTE HOLDS THE WHOLE CHARGE OFF THE BILL, which is the condition this
   * phase was built to meet. Not a smaller slice and not a zero written to the
   * column: nothing at all, so the column stays null and the NEXT booking asks
   * again once a person has decided. Writing 0 here would read as "considered,
   * nothing owed" and quietly forgive a debt nobody cancelled.
   */
  it("adds nothing while the customer is disputing, and keeps the question open", async () => {
    await setDebt(3000);
    await pg.admin.query(
      `update public.customer_risk
          set trip_debt_disputed_at = now(), trip_debt_dispute_note = 'I was in all day'
        where profile_id = $1`,
      [DEBTOR],
    );

    const booking = await billableBooking("SK-DEBT6", "cash");
    await record(booking, 4000);

    const { rows } = await pg.admin.query(
      "select trip_debt_added_rupees from public.bookings where id = $1",
      [booking],
    );
    expect(rows[0].trip_debt_added_rupees).toBeNull();
    expect(await debtNow()).toBe(3000);

    // And nobody was billed for collecting what was never added.
    const { rows: ledger } = await pg.admin.query(
      `select 1 from public.provider_ledger
        where booking_id = $1 and kind = 'commission_due'`,
      [booking],
    );
    expect(ledger).toHaveLength(0);
  });

  /*
   * A customer cannot clear or forge the figure from their own browser. RLS is
   * row-level, so the policy that lets them cancel their own booking would otherwise
   * let them write this column — zero to dodge the charge, null to be charged twice.
   *
   * THE BOOKING IS LEFT PENDING ON PURPOSE, and getting that wrong is what this
   * comment is for: on a finished booking the customer's update policy matches no row
   * at all, so the statement affects nothing and the trigger never runs. That passes
   * an `expect().rejects` written loosely and proves the policy rather than the guard.
   * Pending is the state where the policy DOES let them through, which is where the
   * column guard is the only thing standing between them and the figure.
   */
  it("refuses a customer editing the recovery on their own booking", async () => {
    const booking = await billableBooking("SK-DEBT5", "cash", false);
    const client = await pg.asUser(DEBTOR);

    await expect(
      client.query(
        "update public.bookings set trip_debt_added_rupees = 0 where id = $1",
        [booking],
      ),
    ).rejects.toThrow(/not editable from a browser/i);
    await client.end();
  });
});

describe("a recovery collected in cash is owed on", () => {
  /**
   * THE WHOLE-TABLE VERSION of the cash case above, and the reason it is separate is
   * the reason `MONEY_ASSERTIONS` exists: `bookings.trip_debt_added_rupees` is a
   * past-tense money column, so the question is not whether the arithmetic was right
   * but whether anything moved. On a cash job the professional physically takes those
   * rupees with the bill — if no `commission_due` row follows, the recovery is a gift
   * to whoever happened to collect it and we have simply forgiven the debt while
   * telling the customer we charged them for it.
   *
   * Written against the rows rather than against `recordFinalAmount`, like the claims
   * case above: the failure this catches has never been in the arithmetic.
   */
  it("bills the collector on every cash booking that recovered something", async () => {
    const { rows } = await pg.admin.query(`
      select b.id, b.trip_debt_added_rupees,
             (select count(*) from public.provider_ledger l
               where l.booking_id = b.id and l.kind = 'commission_due') as ledger_rows
        from public.bookings b
       where b.payment_method = 'cash'
         and coalesce(b.trip_debt_added_rupees, 0) > 0
    `);

    const uncollected = rows.filter((row) => Number(row.ledger_rows) === 0);
    expect(
      uncollected.map((row) => row.id),
      "these cash bookings added a trip charge and nobody was billed for collecting it",
    ).toEqual([]);
  });
});
