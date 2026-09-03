import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * RLS isolation and the status machine, against a real Postgres running the
 * real migrations.
 *
 * Two questions the code cannot answer on its own:
 *
 *   1. Can one customer read another's booking? The whole product's privacy
 *      rests on "no", and "no" is a property of a policy, not of a function.
 *   2. Can a booking be moved somewhere it should not go? The trigger is what
 *      makes that impossible for *every* caller, including ones nobody has
 *      written yet.
 *
 * See tests/support/postgres.ts for what is real here and what is stubbed.
 */

let pg: Harness;

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

let aliceBooking: string;
let bobBooking: string;

beforeAll(async () => {
  pg = await startPostgres();

  // Fixtures go in as the owner, which bypasses RLS — this is setup, not the
  // thing under test.
  for (const [id, name] of [
    [ALICE, "Alice"],
    [BOB, "Bob"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    // The profiles migration installs a signup trigger, so the row may already
    // exist — that it does is itself the trigger working.
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, 'customer')
       on conflict (id) do update
         set full_name = excluded.full_name, phone = excluded.phone`,
      [id, name, `+97798000000${id.slice(0, 1)}`],
    );
  }

  const address = async (owner: string) => {
    const { rows } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
       returning id`,
      [owner],
    );
    return rows[0].id as string;
  };

  const booking = async (owner: string, reference: string) => {
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ($1, $2, 'plumbing', $3, 'Tap is leaking badly', 900, 4500)
       returning id`,
      [reference, owner, await address(owner)],
    );
    return rows[0].id as string;
  };

  aliceBooking = await booking(ALICE, "SK-AAAAA");
  bobBooking = await booking(BOB, "SK-BBBBB");
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("one customer cannot see another's booking", () => {
  it("shows a customer only their own", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows } = await alice.query("select id, reference from public.bookings");

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(aliceBooking);
  });

  it("returns nothing when asking for someone else's by id", async () => {
    // Not an error — an empty result. "Not found" and "not yours" are the
    // same answer, which is the right answer to give.
    const alice = await pg.asUser(ALICE);
    const { rows } = await alice.query(
      "select id from public.bookings where id = $1",
      [bobBooking],
    );

    expect(rows).toHaveLength(0);
  });

  it("hides another customer's address", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows } = await alice.query("select id from public.addresses");

    expect(rows).toHaveLength(1);
  });

  it("refuses to book a job in someone else's name", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows: mine } = await alice.query(
      "select id from public.addresses limit 1",
    );

    await expect(
      alice.query(
        `insert into public.bookings
           (reference, customer_id, category_slug, address_id, description,
            quoted_min, quoted_max)
         values ('SK-FORGE', $1, 'plumbing', $2, 'Forged booking', 900, 4500)`,
        [BOB, mine[0].id],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot reach another customer's booking history", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows } = await alice.query(
      `select h.id from public.booking_status_history h
       where h.booking_id = $1`,
      [bobBooking],
    );

    expect(rows).toHaveLength(0);
  });
});

describe("the status machine is enforced by the database", () => {
  it("rejects pending → completed", async () => {
    // The jump the spec called out. No caller can make it, whatever the app
    // believes.
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'completed' where id = $1",
        [aliceBooking],
      ),
    ).rejects.toThrow(/cannot go from pending to completed/i);
  });

  it("rejects skipping en_route", async () => {
    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [aliceBooking],
    );

    await expect(
      pg.admin.query(
        "update public.bookings set status = 'in_progress' where id = $1",
        [aliceBooking],
      ),
    ).rejects.toThrow(/cannot go from accepted to in_progress/i);
  });

  it("allows the legal step and stamps its timestamp", async () => {
    await pg.admin.query(
      "update public.bookings set status = 'en_route' where id = $1",
      [aliceBooking],
    );
    const { rows } = await pg.admin.query(
      "select status, accepted_at, en_route_at from public.bookings where id = $1",
      [aliceBooking],
    );

    expect(rows[0].status).toBe("en_route");
    // Stamped by the trigger, not by the caller.
    expect(rows[0].accepted_at).not.toBeNull();
    expect(rows[0].en_route_at).not.toBeNull();
  });

  it("records every step in the history, in order", async () => {
    const { rows } = await pg.admin.query(
      `select from_status, to_status from public.booking_status_history
       where booking_id = $1 order by created_at`,
      [aliceBooking],
    );

    expect(rows.map((r) => r.to_status)).toEqual([
      "pending",
      "accepted",
      "en_route",
    ]);
    expect(rows[0].from_status).toBeNull();
  });

  it("refuses to let a booking start anywhere but pending", async () => {
    const { rows: addr } = await pg.admin.query(
      "select id from public.addresses limit 1",
    );

    await expect(
      pg.admin.query(
        `insert into public.bookings
           (reference, customer_id, category_slug, address_id, description,
            quoted_min, quoted_max, status, accepted_at)
         values ('SK-CHEAT', $1, 'plumbing', $2, 'Starts accepted', 900, 4500,
                 'accepted', now())`,
        [ALICE, addr[0].id],
      ),
    ).rejects.toThrow(/must start as pending/i);
  });

  it("treats a terminal status as terminal", async () => {
    const { rows: addr } = await pg.admin.query(
      "select id from public.addresses where profile_id = $1 limit 1",
      [BOB],
    );
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ('SK-TERM', $1, 'plumbing', $2, 'To be cancelled', 900, 4500)
       returning id`,
      [BOB, addr[0].id],
    );
    const id = rows[0].id;

    await pg.admin.query(
      "update public.bookings set status = 'cancelled' where id = $1",
      [id],
    );

    await expect(
      pg.admin.query(
        "update public.bookings set status = 'accepted' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/cannot go from cancelled to accepted/i);
  });
});

describe("a customer cannot price their own job", () => {
  it("stops them marking it completed", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows: addr } = await alice.query(
      "select id from public.addresses limit 1",
    );
    const { rows } = await alice.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ('SK-SELF1', $1, 'plumbing', $2, 'Mine', 900, 4500)
       returning id`,
      [ALICE, addr[0].id],
    );

    // Two layers stop this: the transition trigger rejects pending →
    // completed outright, and the policy's `with check` does not list
    // 'completed' either. Which one fires first is an implementation detail —
    // what matters is that the booking does not move and no price gets set.
    await alice
      .query("update public.bookings set status = 'completed' where id = $1", [
        rows[0].id,
      ])
      .catch(() => undefined);

    const { rows: after } = await pg.admin.query(
      "select status, final_amount from public.bookings where id = $1",
      [rows[0].id],
    );
    expect(after[0].status).toBe("pending");
    expect(after[0].final_amount).toBeNull();
  });

  it("lets them cancel their own while it is still pending", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows } = await alice.query(
      "select id from public.bookings where reference = 'SK-SELF1'",
    );

    const result = await alice.query(
      "update public.bookings set status = 'cancelled' where id = $1",
      [rows[0].id],
    );
    expect(result.rowCount).toBe(1);
  });
});

describe("append-only history", () => {
  it("refuses an update", async () => {
    const alice = await pg.asUser(ALICE);
    const result = await alice.query(
      "update public.booking_status_history set to_status = 'completed'",
    );
    // No insert/update/delete policy exists, so RLS matches no rows.
    expect(result.rowCount).toBe(0);
  });

  it("refuses a hand-written row", async () => {
    const alice = await pg.asUser(ALICE);
    await expect(
      alice.query(
        `insert into public.booking_status_history (booking_id, to_status)
         values ($1, 'completed')`,
        [aliceBooking],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

/**
 * Payments.
 *
 * Two properties the code cannot assert about itself: that a customer cannot
 * read another's payment record, and that no client can write one at all.
 * The second is the more important — RLS grants no insert or update on
 * `payments` to anybody, which is what forces every write through a server
 * route that has verified the money with the gateway first.
 */
describe("payments are readable only by the people involved", () => {
  let alicePayment: string;

  beforeAll(async () => {
    const { rows } = await pg.admin.query(
      `insert into public.payments (booking_id, method, amount, our_reference)
       values ($1, 'cash', 1500, 'SKP-ALICE-1') returning id`,
      [aliceBooking],
    );
    alicePayment = rows[0].id;
    await pg.admin.query(
      `insert into public.payments (booking_id, method, amount, our_reference)
       values ($1, 'esewa', 2500, 'SKP-BOB-1')`,
      [bobBooking],
    );
  });

  it("shows a customer only the payments on their own bookings", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows } = await alice.query(
      "select id, our_reference from public.payments",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].our_reference).toBe("SKP-ALICE-1");
  });

  it("returns nothing when asking for someone else's by reference", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows } = await alice.query(
      "select id from public.payments where our_reference = $1",
      ["SKP-BOB-1"],
    );

    expect(rows).toHaveLength(0);
  });

  it("lets nobody insert a payment through the client", async () => {
    // The line that matters most in the payments migration: a client that
    // could insert here could mark its own booking paid.
    const alice = await pg.asUser(ALICE);
    await expect(
      alice.query(
        `insert into public.payments (booking_id, method, amount, our_reference)
         values ($1, 'cash', 1, 'SKP-FORGED')`,
        [aliceBooking],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("lets nobody change an amount through the client", async () => {
    const alice = await pg.asUser(ALICE);
    const result = await alice.query(
      "update public.payments set amount = 1 where id = $1",
      [alicePayment],
    );
    // No update policy exists, so RLS matches no rows.
    expect(result.rowCount).toBe(0);
  });
});

describe("the payment machine is enforced by the database", () => {
  let ref = 0;
  const newPayment = async (status = "pending") => {
    ref += 1;
    const { rows } = await pg.admin.query(
      `insert into public.payments (booking_id, method, amount, our_reference)
       values ($1, 'esewa', 2000, $2) returning id`,
      [aliceBooking, `SKP-M-${ref}`],
    );
    const id = rows[0].id;
    if (status !== "pending") {
      await pg.admin.query("update public.payments set status = $2 where id = $1", [
        id,
        status,
      ]);
    }
    return id;
  };

  it("refuses to un-settle a paid payment", async () => {
    const id = await newPayment("paid");
    await expect(
      pg.admin.query("update public.payments set status = 'pending' where id = $1", [
        id,
      ]),
    ).rejects.toThrow(/cannot go from paid to pending/i);
  });

  it("refuses a payment that tries to start settled", async () => {
    await expect(
      pg.admin.query(
        `insert into public.payments (booking_id, method, amount, our_reference, status, settled_at)
         values ($1, 'cash', 900, 'SKP-CHEAT', 'paid', now())`,
        [aliceBooking],
      ),
    ).rejects.toThrow(/must start as pending/i);
  });

  it("stamps settled_at itself rather than trusting the caller", async () => {
    const id = await newPayment();
    await pg.admin.query("update public.payments set status = 'paid' where id = $1", [
      id,
    ]);
    const { rows } = await pg.admin.query(
      "select settled_at from public.payments where id = $1",
      [id],
    );
    expect(rows[0].settled_at).not.toBeNull();
  });

  it("makes the reference unique, which is what makes callbacks idempotent", async () => {
    await expect(
      pg.admin.query(
        `insert into public.payments (booking_id, method, amount, our_reference)
         values ($1, 'cash', 500, 'SKP-ALICE-1')`,
        [aliceBooking],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("treats a full refund as final", async () => {
    const id = await newPayment("paid");
    await pg.admin.query(
      "update public.payments set status = 'refunded' where id = $1",
      [id],
    );
    await expect(
      pg.admin.query("update public.payments set status = 'paid' where id = $1", [id]),
    ).rejects.toThrow(/cannot go from refunded to paid/i);
  });
});

/**
 * The hardening from 20260903000001, proved rather than assumed.
 *
 * Supabase's Security Advisor asks for EXECUTE to be revoked from PUBLIC on
 * every SECURITY DEFINER function. That is correct for the trigger functions
 * and dangerous for `is_admin()`, and the difference is not visible by reading
 * the advice — it is visible by running it. So both halves are asserted here:
 * the triggers still fire for an ordinary signed-in user with no grant, and
 * the policies that call `is_admin()` still answer instead of erroring.
 *
 * Without this, the safe-looking half of the advisor's remediation would take
 * out every read in the product and nothing would have caught it.
 */
describe("locking the functions down did not lock the product out", () => {
  it("leaves no ordinary caller able to invoke a trigger function by hand", async () => {
    const client = await pg.asUser(ALICE);
    await expect(
      client.query("select public.enforce_booking_transition()"),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      client.query("select public.touch_updated_at()"),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      client.query("select public.booking_transition_allowed('pending', 'accepted')"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("still fires those triggers on a signed-in customer's own insert", async () => {
    // The revoke would be a catastrophe if firing a trigger re-checked EXECUTE
    // against the caller. It does not — Postgres checks that when the trigger
    // is created — and this is what says so out loud.
    const client = await pg.asUser(ALICE);
    const { rows: addressRows } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'work', 'lalitpur-4', 'Lalitpur', 4, 'Sanepa', 'Red gate')
       returning id`,
      [ALICE],
    );

    const { rows } = await client.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ('SK-HARD1', $1, 'plumbing', $2, 'Sink is blocked', 900, 4500)
       returning id, status`,
      [ALICE, addressRows[0].id],
    );
    expect(rows[0].status).toBe("pending");

    // The AFTER trigger wrote the history row, under the tightened search_path.
    const { rows: history } = await pg.admin.query(
      "select to_status from public.booking_status_history where booking_id = $1",
      [rows[0].id],
    );
    expect(history.map((r) => r.to_status)).toContain("pending");

    // And the BEFORE trigger still refuses an illegal move.
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'completed' where id = $1",
        [rows[0].id],
      ),
    ).rejects.toThrow(/cannot go from pending to completed/i);
  });

  it("keeps the payment triggers working under the same revoke", async () => {
    const { rows } = await pg.admin.query(
      `insert into public.payments (booking_id, method, amount, our_reference)
       values ($1, 'cash', 1200, 'SKP-HARD-1') returning id, status`,
      [aliceBooking],
    );
    expect(rows[0].status).toBe("pending");

    await pg.admin.query(
      "update public.payments set status = 'paid' where id = $1",
      [rows[0].id],
    );
    const { rows: settled } = await pg.admin.query(
      "select settled_at, updated_at from public.payments where id = $1",
      [rows[0].id],
    );
    // settled_at from enforce_payment_transition, updated_at from
    // touch_updated_at — both now running with an empty search_path.
    expect(settled[0].settled_at).not.toBeNull();
    expect(settled[0].updated_at).not.toBeNull();
  });

  it("leaves the logged-out join form working", async () => {
    // provider_leads is the one table anon writes to, and the revoke above
    // took anon's function grants away. It has no triggers, so nothing should
    // have changed — this is here to notice if that ever stops being true.
    const client = await pg.asAnon();
    await client.query(
      `insert into public.provider_leads
         (full_name, phone, category_slug, area_key, years_experience)
       values ('Hari', '+9779800000123', 'plumbing', 'lalitpur-4', 6)`,
    );
    // And still cannot read the list back.
    const { rows } = await client.query("select id from public.provider_leads");
    expect(rows).toHaveLength(0);
  });

  it("still lets a signed-in user's policies call is_admin()", async () => {
    // The one piece of the advisor's advice that must NOT be taken. If
    // `authenticated` loses EXECUTE on is_admin(), this query stops returning
    // rows and starts raising — every booking read in the product with it.
    const client = await pg.asUser(ALICE);
    const { rows } = await client.query(
      "select id from public.bookings where id = $1",
      [aliceBooking],
    );
    expect(rows).toHaveLength(1);

    // And the function itself is still callable by a signed-in user, which is
    // the grant that makes the policies above work.
    const { rows: admin } = await client.query("select public.is_admin() as v");
    expect(admin[0].v).toBe(false);
  });
});
