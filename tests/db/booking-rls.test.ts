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
    ).// Two independent rules refuse this now and either is enough: the insert
      // policy (the customer_id is not the caller's) and the address-ownership
      // trigger (the address is not that customer's). The trigger happens to
      // fire first, which is why this asserts the refusal rather than one
      // specific sentence — a test that pins the wording would fail the next
      // time a second lock is added, and a second lock is good news.
      rejects.toThrow(/row-level security|somebody else's address/i);
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

/**
 * The professional's phone, and who is allowed to have it.
 *
 * This is the one genuinely new privacy surface in Phase 8. `providers` is
 * world-readable — it is the public directory — so a phone number on that
 * table would be every professional's number on the open internet. It lives on
 * `provider_contacts` instead, behind a policy that releases it only while a
 * job of theirs is live.
 *
 * The window is asserted from both ends: it opens at `accepted` and it closes
 * again when the job is over. A finished job is not a standing right to
 * somebody's number, and that is the half nobody would notice was missing.
 */
describe("a professional's number is not public", () => {
  let providerId: string;
  // Its own booking, deliberately. Earlier blocks in this file advance
  // `aliceBooking` through the machine, and a test whose fixture is whatever
  // the previous describe left behind is a test that passes for the wrong
  // reason — which is how the first version of this block "passed" the
  // pending case while the booking was actually en_route.
  let job: string;

  beforeAll(async () => {
    const { rows } = await pg.admin.query(
      `insert into public.providers
         (display_name, service_areas, base_rate, is_verified, profile_id)
       values ('Ramesh', '{lalitpur-4}', 800, true, null)
       returning id`,
    );
    providerId = rows[0].id as string;

    await pg.admin.query(
      "insert into public.provider_contacts (provider_id, phone) values ($1, '+9779812345678')",
      [providerId],
    );

    const { rows: address } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Kupondole', 'Green gate')
       returning id`,
      [ALICE],
    );
    const { rows: booking } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, category_slug, address_id,
          description, quoted_min, quoted_max)
       values ('SK-PHONE', $1, $2, 'plumbing', $3, 'Leaking tap', 900, 4500)
       returning id`,
      [ALICE, providerId, address[0].id],
    );
    job = booking[0].id as string;
  });

  const phoneVisibleTo = async (userId: string) => {
    const client = await pg.asUser(userId);
    const { rows } = await client.query(
      "select phone from public.provider_contacts where provider_id = $1",
      [providerId],
    );
    return rows;
  };

  it("hides it while the job is still only requested", async () => {
    // pending: nobody has agreed to anything, so there is nothing to call about.
    expect(await phoneVisibleTo(ALICE)).toHaveLength(0);
  });

  it("releases it to the customer once the job is accepted", async () => {
    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [job],
    );
    const rows = await phoneVisibleTo(ALICE);
    expect(rows[0]?.phone).toBe("+9779812345678");
  });

  it("keeps it hidden from a customer with no job with them", async () => {
    expect(await phoneVisibleTo(BOB)).toHaveLength(0);
  });

  it("takes it away again once the job is over", async () => {
    // The half that is easy to forget. A finished job is not a permanent
    // right to somebody's phone number.
    for (const status of ["en_route", "in_progress", "completed"]) {
      await pg.admin.query(
        "update public.bookings set status = $1 where id = $2",
        [status, job],
      );
    }
    expect(await phoneVisibleTo(ALICE)).toHaveLength(0);
  });

  it("lets nobody write one through the client", async () => {
    const client = await pg.asUser(ALICE);
    await expect(
      client.query(
        "insert into public.provider_contacts (provider_id, phone) values ($1, '+9779800000009')",
        [providerId],
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });
});

describe("notifications belong to the person they are about", () => {
  it("shows a person only their own", async () => {
    await pg.admin.query(
      `insert into public.notifications (profile_id, booking_id, kind)
       values ($1, $2, 'booking.accepted')`,
      [ALICE, aliceBooking],
    );

    const alice = await pg.asUser(ALICE);
    const { rows: mine } = await alice.query(
      "select id from public.notifications",
    );
    expect(mine.length).toBeGreaterThan(0);

    const bob = await pg.asUser(BOB);
    const { rows: theirs } = await bob.query(
      "select id from public.notifications",
    );
    expect(theirs).toHaveLength(0);
  });

  it("lets nobody forge one", async () => {
    // A notification a client can write is one an attacker can write, and
    // these say things like "your professional is on the way".
    const client = await pg.asUser(BOB);
    await expect(
      client.query(
        `insert into public.notifications (profile_id, kind) values ($1, 'booking.paid')`,
        [BOB],
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it("lets a person mark their own read", async () => {
    const client = await pg.asUser(ALICE);
    const { rows } = await client.query(
      "update public.notifications set read_at = now() where profile_id = $1 returning id",
      [ALICE],
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

/**
 * Nobody reads another professional's work.
 *
 * `/provider/jobs` shows customer names, phone numbers and home addresses. The
 * page resolves the listing from the session — `getMyProvider` filters on
 * `profile_id = auth.uid()` — but "the code looks right" is not what protects
 * those addresses. The policy is, and a policy is only true if a database says
 * so. Both directions are asserted: an ordinary customer gets nothing, and a
 * real professional asking for somebody else's provider id gets nothing.
 */
describe("a provider's job list is theirs alone", () => {
  // Alice's account is linked to a listing; Bob's is an ordinary customer.
  const ALICE_LISTING = "Alice's Plumbing";
  let aliceProviderId: string;
  let strangerProviderId: string;

  beforeAll(async () => {
    const { rows: mine } = await pg.admin.query(
      `insert into public.providers
         (display_name, service_areas, base_rate, is_verified, profile_id)
       values ($1, '{lalitpur-4}', 700, true, $2)
       returning id`,
      [ALICE_LISTING, ALICE],
    );
    aliceProviderId = mine[0].id as string;

    const { rows: theirs } = await pg.admin.query(
      `insert into public.providers
         (display_name, service_areas, base_rate, is_verified, profile_id)
       values ('Someone Else', '{lalitpur-3}', 700, true, null)
       returning id`,
    );
    strangerProviderId = theirs[0].id as string;

    // A job for each listing, both belonging to Bob as the customer — so the
    // only thing separating them is the provider assignment.
    const { rows: address } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Pulchowk', 'Yellow gate')
       returning id`,
      [BOB],
    );
    for (const [reference, provider] of [
      ["SK-MINE1", aliceProviderId],
      ["SK-THEIR", strangerProviderId],
    ] as const) {
      await pg.admin.query(
        `insert into public.bookings
           (reference, customer_id, provider_id, category_slug, address_id,
            description, quoted_min, quoted_max)
         values ($1, $2, $3, 'plumbing', $4, 'Blocked drain', 900, 4500)`,
        [reference, BOB, provider, address[0].id],
      );
    }
  });

  it("shows a professional the jobs assigned to their own listing", async () => {
    const client = await pg.asUser(ALICE);
    const { rows } = await client.query(
      "select reference from public.bookings where provider_id = $1",
      [aliceProviderId],
    );
    expect(rows.map((r) => r.reference)).toContain("SK-MINE1");
  });

  it("refuses a professional asking for another listing's jobs by id", async () => {
    // The attack is trivial — swap the provider id — so the policy, not the
    // page, has to be what stops it.
    const client = await pg.asUser(ALICE);
    const { rows } = await client.query(
      "select reference from public.bookings where provider_id = $1",
      [strangerProviderId],
    );
    expect(rows).toHaveLength(0);
  });

  it("gives an ordinary customer nothing from either listing", async () => {
    // Bob has no linked listing. He is the *customer* on both bookings, so his
    // own policy lets him see them — what must not happen is the provider
    // policy granting him anything, which this proves by asking as a third
    // party with no relationship at all.
    const client = await pg.asUser(ALICE);
    const { rows } = await client.query(
      `select b.reference from public.bookings b
       where b.customer_id = $1 and b.provider_id = $2`,
      [BOB, strangerProviderId],
    );
    expect(rows).toHaveLength(0);
  });

  it("does not let a customer claim a listing by writing profile_id", async () => {
    // The one write that would turn any signed-in person into a professional.
    const client = await pg.asUser(BOB);
    const { rows } = await client.query(
      "update public.providers set profile_id = $1 where id = $2 returning id",
      [BOB, strangerProviderId],
    );
    expect(rows).toHaveLength(0);
  });
});

/**
 * One address per doorstep.
 *
 * `createAddress` inserted unconditionally, so every booking from the same flat
 * added another identical "home" — a customer with five bookings saw five
 * identical options on the address step, which is worse than showing none.
 *
 * The index is what makes it true. The data layer looks for a match first so
 * the customer gets their existing address rather than an error, but that is a
 * courtesy; this is the guarantee, and it has to hold against a caller that
 * forgets to look.
 */
describe("an address cannot be saved twice", () => {
  const place = {
    area: "lalitpur-4",
    city: "Lalitpur",
    ward: 4,
    tole: "Jhamsikhel",
    landmark: "Blue gate",
  };

  const save = (
    profile: string,
    tole: string,
    landmark: string,
    label = "home",
  ) =>
    pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [profile, label, place.area, place.city, place.ward, tole, landmark],
    );

  it("refuses the same place twice for the same person", async () => {
    await save(BOB, "Sanepa", "Green shutters");
    await expect(save(BOB, "Sanepa", "Green shutters")).rejects.toThrow(
      /duplicate key|unique/i,
    );
  });

  it("treats different case and stray spaces as the same place", async () => {
    // Somebody retyping their address does not capitalise it identically, and
    // that is not a second home.
    await save(BOB, "Kupondole", "Red door");
    await expect(save(BOB, "  kupondole ", "RED DOOR")).rejects.toThrow(
      /duplicate key|unique/i,
    );
  });

  it("does not let a different label split one place into two", async () => {
    // The label is not identity. "Sanepa / Green shutters" was already saved
    // as "home" above, so saving it again as "flat" must still collide — the
    // temptation to add `label` to the index is real, and doing so would put
    // every duplicate straight back.
    await expect(
      save(BOB, "Sanepa", "Green shutters", "flat"),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("still lets two people save the same building", async () => {
    // Flatmates, or a landlord and a tenant. The key is per person.
    await expect(save(ALICE, "Sanepa", "Green shutters")).resolves.toBeTruthy();
  });

  it("still lets one person save two different places", async () => {
    await expect(save(BOB, "Sanepa", "Blue awning")).resolves.toBeTruthy();
  });
});

/**
 * An open job, and the race to take it.
 *
 * When first refusal lapses the booking is unassigned and offered to everybody
 * who works that category in that ward. Two things have to hold and neither is
 * visible by reading the page: a professional must not see open work they
 * cannot do, and when two people tap "Take this job" at the same second,
 * exactly one must get it. The second is settled by the policy's `using`
 * clause matching only rows that are still unassigned — checking first and
 * writing after is precisely the gap that sends two professionals to one house.
 */
describe("open jobs, and who may take them", () => {
  let openBooking: string;
  let aliceListing: string;

  beforeAll(async () => {
    const { rows: listing } = await pg.admin.query(
      `insert into public.providers
         (display_name, service_areas, base_rate, is_verified, profile_id)
       values ('Alice Electrical', '{lalitpur-4}', 900, true, $1)
       returning id`,
      [ALICE],
    );
    aliceListing = listing[0].id as string;
    await pg.admin.query(
      `insert into public.provider_categories (provider_id, category_slug)
       values ($1, 'electrical') on conflict do nothing`,
      [aliceListing],
    );

    const { rows: address } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Dhobighat', 'Steel gate')
       returning id`,
      [BOB],
    );

    const { rows: booking } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max, opened_at)
       values ('SK-OPEN1', $1, 'electrical', $2, 'No power in the kitchen',
               900, 4500, now())
       returning id`,
      [BOB, address[0].id],
    );
    openBooking = booking[0].id as string;
  });

  it("shows an open job to a professional who works that category and ward", async () => {
    const client = await pg.asUser(ALICE);
    const { rows } = await client.query(
      "select reference from public.bookings where id = $1",
      [openBooking],
    );
    expect(rows.map((r) => r.reference)).toContain("SK-OPEN1");
  });

  it("hides an open job from a professional who does not do that category", async () => {
    // Alice does electrical, not plumbing. Seeing every open booking in the
    // valley would make this a directory of strangers' addresses.
    const { rows: other } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max, opened_at)
       select 'SK-OPEN2', customer_id, 'plumbing', address_id, 'Blocked drain',
              900, 4500, now()
       from public.bookings where id = $1
       returning id`,
      [openBooking],
    );
    const client = await pg.asUser(ALICE);
    const { rows } = await client.query(
      "select id from public.bookings where id = $1",
      [other[0].id],
    );
    expect(rows).toHaveLength(0);
  });

  it("lets an eligible professional claim it", async () => {
    const client = await pg.asUser(ALICE);
    const { rows } = await client.query(
      `update public.bookings
       set provider_id = $1, status = 'accepted'
       where id = $2 returning id`,
      [aliceListing, openBooking],
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses the second claimant, rather than stealing the job", async () => {
    /*
     * The job is now Alice's. This is the case that found a real hole: the
     * rival here is also the *customer* on this booking, and "Customers cancel
     * their own open bookings" made the row updatable for them. RLS is
     * row-level — once a row is updatable every column on it is — so the
     * second claim went straight through and reassigned Alice's job.
     *
     * `enforce_booking_immutability` is what refuses it now, and it refuses by
     * raising rather than matching zero rows, which is the stronger answer:
     * the caller cannot mistake it for "nothing to do".
     */
    const { rows: rival } = await pg.admin.query(
      `insert into public.providers
         (display_name, service_areas, base_rate, is_verified, profile_id)
       values ('Bob Electrical', '{lalitpur-4}', 900, true, $1)
       returning id`,
      [BOB],
    );
    await pg.admin.query(
      `insert into public.provider_categories (provider_id, category_slug)
       values ($1, 'electrical') on conflict do nothing`,
      [rival[0].id],
    );

    const client = await pg.asUser(BOB);
    await expect(
      client.query(
        `update public.bookings
         set provider_id = $1, status = 'accepted'
         where id = $2`,
        [rival[0].id, openBooking],
      ),
    ).rejects.toThrow(/already assigned cannot be reassigned/i);
  });

  it("does not let a customer rewrite the price of their own job", async () => {
    /*
     * The other half of the same hole, and the one that costs money. A
     * customer could set `quoted_max` and `final_amount` on their own booking,
     * and `openPayment` judges the amount against exactly those columns — so
     * every server-side check would have agreed that Rs 100 was the right
     * price for a Rs 4,000 job.
     */
    const client = await pg.asUser(BOB);
    await expect(
      client.query(
        "update public.bookings set quoted_max = 100 where id = $1",
        [bobBooking],
      ),
    ).rejects.toThrow(/not editable from a browser/i);

    await expect(
      client.query(
        "update public.bookings set final_amount = 100 where id = $1",
        [bobBooking],
      ),
    ).rejects.toThrow(/not editable from a browser/i);
  });

  it("does not let a customer mark their own booking paid", async () => {
    const client = await pg.asUser(BOB);
    await expect(
      client.query(
        "update public.bookings set payment_status = 'paid' where id = $1",
        [bobBooking],
      ),
    ).rejects.toThrow(/not editable from a browser/i);
  });

  it("still lets a customer cancel, which is the one thing that policy is for", async () => {
    const client = await pg.asUser(BOB);
    const { rows } = await client.query(
      `update public.bookings set status = 'cancelled', cancelled_by = 'customer'
       where id = $1 returning id`,
      [bobBooking],
    );
    expect(rows).toHaveLength(1);
  });

  it("does not let a professional claim a job in somebody else's name", async () => {
    const { rows: fresh } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max, opened_at)
       select 'SK-OPEN3', customer_id, 'electrical', address_id, 'Fuse blown',
              900, 4500, now()
       from public.bookings where id = $1
       returning id`,
      [openBooking],
    );

    // Alice tries to hand the job to a listing that is not hers. The `with
    // check` clause is what refuses this.
    const { rows: stranger } = await pg.admin.query(
      `insert into public.providers
         (display_name, service_areas, base_rate, is_verified, profile_id)
       values ('Unclaimed Sparks', '{lalitpur-4}', 900, true, null)
       returning id`,
    );
    // Given the category and the ward deliberately: this listing *could* do
    // the job, so the only thing left to refuse the write is the `with check`
    // clause — which is what this test is about. Without it the immutability
    // trigger raises first and the policy is never exercised.
    await pg.admin.query(
      `insert into public.provider_categories (provider_id, category_slug)
       values ($1, 'electrical') on conflict do nothing`,
      [stranger[0].id],
    );
    const client = await pg.asUser(ALICE);
    await expect(
      client.query(
        `update public.bookings set provider_id = $1, status = 'accepted'
         where id = $2`,
        [stranger[0].id, fresh[0].id],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

/**
 * A professional withdrawing puts the job back, it does not end it.
 *
 * Declining an accepted job used to write `cancelled`, and the customer was
 * shown "This booking was cancelled. Nothing is owed." on a job they still
 * needed doing — appliance still broken, product simply stopped. Nothing owed,
 * and nothing happening.
 *
 * `accepted -> pending` and `en_route -> pending` are therefore the only
 * backwards moves in this machine, and the stamps have to come off with them:
 * an `accepted_at` on a booking nobody has accepted is a lie, and it is the
 * kind a report repeats without anyone noticing.
 */
describe("releasing a job, rather than cancelling it", () => {
  const fresh = async (status: string) => {
    const { rows: address } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, $2, 'Gate')
       returning id`,
      [ALICE, `Tole-${Math.random().toString(36).slice(2, 8)}`],
    );
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ($1, $2, 'plumbing', $3, 'Dripping tap', 900, 4500)
       returning id`,
      [`SK-R${Math.random().toString(36).slice(2, 7).toUpperCase()}`, ALICE, address[0].id],
    );
    const id = rows[0].id as string;
    if (status !== "pending") {
      await pg.admin.query(
        "update public.bookings set status = 'accepted' where id = $1",
        [id],
      );
    }
    if (status === "en_route") {
      await pg.admin.query(
        "update public.bookings set status = 'en_route' where id = $1",
        [id],
      );
    }
    return id;
  };

  it("allows accepted back to pending", async () => {
    const id = await fresh("accepted");
    const { rows } = await pg.admin.query(
      "update public.bookings set status = 'pending' where id = $1 returning status",
      [id],
    );
    expect(rows[0].status).toBe("pending");
  });

  it("allows en_route back to pending, because a van can break down", async () => {
    const id = await fresh("en_route");
    const { rows } = await pg.admin.query(
      "update public.bookings set status = 'pending' where id = $1 returning status",
      [id],
    );
    expect(rows[0].status).toBe("pending");
  });

  it("clears the stamps of the assignment that lapsed", async () => {
    const id = await fresh("en_route");
    await pg.admin.query(
      "update public.bookings set status = 'pending' where id = $1",
      [id],
    );
    const { rows } = await pg.admin.query(
      "select accepted_at, en_route_at, provider_id from public.bookings where id = $1",
      [id],
    );
    expect(rows[0].accepted_at).toBeNull();
    expect(rows[0].en_route_at).toBeNull();
    expect(rows[0].provider_id).toBeNull();
  });

  it("still refuses to reopen a job that is finished or cancelled", async () => {
    // The release is for work in flight. Resurrecting a completed or cancelled
    // booking would let somebody redo a job that is already paid for.
    const id = await fresh("accepted");
    await pg.admin.query(
      "update public.bookings set status = 'cancelled', cancelled_by = 'customer' where id = $1",
      [id],
    );
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'pending' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/cannot go from cancelled to pending/i);
  });

  it("still refuses to reopen work already under way", async () => {
    // in_progress is deliberately absent: somebody is in the customer's house
    // with the floor up. Walking out of that is a support call, not a button.
    const id = await fresh("en_route");
    await pg.admin.query(
      "update public.bookings set status = 'in_progress' where id = $1",
      [id],
    );
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'pending' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/cannot go from in_progress to pending/i);
  });
});

/*
 * A REFUSAL IS A FACT, AND THREE THINGS DEPEND ON IT.
 *
 * When a professional says no, the job must not be offered back to them, the
 * customer must not be handed them as a suggestion, and the count against
 * their listing must go up. All three read one table, and the table is written
 * by a trigger rather than by the button — because the button is not the only
 * way a booking loses its professional, and a rule that lives in one caller is
 * a rule the second caller does not have.
 *
 * The case that made this necessary: a professional refusing a job still at
 * `pending` wrote a status identical to the one already there. No transition,
 * no trigger, `provider_id` untouched — the job stayed theirs and their screen
 * went on saying it was waiting for them.
 */
describe("saying no to a job, and what it costs", () => {
  const CARL = "33333333-3333-4333-8333-333333333333";
  const DEEPA = "44444444-4444-4444-8444-444444444444";

  let carlListing: string;
  let deepaListing: string;
  let jobAddress: string;

  const freshJob = async (reference: string, provider: string | null) => {
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max, provider_id, first_choice_provider_id)
       values ($1, $2, 'ac-servicing', $3, 'AC not cooling', 1200, 6000, $4, $4)
       returning id`,
      [reference, ALICE, jobAddress, provider],
    );
    return rows[0].id as string;
  };

  beforeAll(async () => {
    for (const [id, name, phone] of [
      [CARL, "Carl", "+9779800000021"],
      [DEEPA, "Deepa", "+9779800000022"],
    ] as const) {
      await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
      await pg.admin.query(
        `insert into public.profiles (id, full_name, phone, role)
         values ($1, $2, $3, 'provider')
         on conflict (id) do update set full_name = excluded.full_name`,
        [id, name, phone],
      );
    }

    for (const [profile, name] of [
      [CARL, "Carl Cooling"],
      [DEEPA, "Deepa Cooling"],
    ] as const) {
      const { rows } = await pg.admin.query(
        `insert into public.providers
           (display_name, service_areas, base_rate, is_verified, profile_id)
         values ($1, '{lalitpur-4}', 1200, true, $2)
         returning id`,
        [name, profile],
      );
      const id = rows[0].id as string;
      await pg.admin.query(
        `insert into public.provider_categories (provider_id, category_slug)
         values ($1, 'ac-servicing') on conflict do nothing`,
        [id],
      );
      if (profile === CARL) carlListing = id;
      else deepaListing = id;
    }

    const { rows: address } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'flat', 'lalitpur-4', 'Lalitpur', 4, 'Kupondole', 'Red door')
       returning id`,
      [ALICE],
    );
    jobAddress = address[0].id as string;
  });

  it("cannot be done by the professional's own browser write", async () => {
    /*
     * THE FINDING THAT SHAPED THIS WHOLE PATH, and it is a property of
     * Postgres rather than a missing policy.
     *
     * On UPDATE the table's SELECT policies are applied to the NEW row as well
     * as the update policy's own `with check`: an update may not make a row
     * vanish from the person making it. An unassigned booking is exactly that
     * to the professional letting go of it — it stops matching "Providers read
     * their assigned bookings" the instant `provider_id` is null. No update
     * policy can rescue that, which is why a release is a server-side write
     * with the ownership proved by an RLS read first.
     */
    const job = await freshJob("SK-WD001", carlListing);
    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [job],
    );

    const carl = await pg.asUser(CARL);
    await expect(
      carl.query(
        `update public.bookings set status = 'pending', provider_id = null
         where id = $1`,
        [job],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("is the professional's own job to give up, and RLS says so", async () => {
    // The half that still goes through the policies: the read that proves the
    // job is theirs before the server writes anything.
    const carl = await pg.asUser(CARL);
    const { rows } = await carl.query(
      "select provider_id from public.bookings where reference = 'SK-WD001'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_id).toBe(carlListing);
  });

  it("records the withdrawal against the professional", async () => {
    const job = await freshJob("SK-WD002", carlListing);
    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [job],
    );
    const before = await pg.admin.query(
      "select withdrawals from public.provider_stats where provider_id = $1",
      [carlListing],
    );

    await pg.admin.query(
      "update public.bookings set status = 'pending', provider_id = null where id = $1",
      [job],
    );

    const { rows: refusal } = await pg.admin.query(
      "select kind from public.booking_refusals where booking_id = $1",
      [job],
    );
    expect(refusal[0].kind).toBe("withdrawn");

    const { rows: after } = await pg.admin.query(
      "select withdrawals from public.provider_stats where provider_id = $1",
      [carlListing],
    );
    expect(Number(after[0].withdrawals)).toBe(
      Number(before.rows[0]?.withdrawals ?? 0) + 1,
    );
  });

  it("records a refusal before acceptance too, where there is no transition", async () => {
    // pending -> pending is not a status change. The fact that identifies this
    // refusal is `provider_id` going to null, which is why the trigger fires
    // on the row rather than on the status column.
    const job = await freshJob("SK-DC001", carlListing);

    await pg.admin.query(
      "update public.bookings set provider_id = null where id = $1",
      [job],
    );

    const { rows } = await pg.admin.query(
      "select kind from public.booking_refusals where booking_id = $1",
      [job],
    );
    expect(rows[0].kind).toBe("declined");
  });

  it("never offers the job back to the professional who refused it", async () => {
    const job = await freshJob("SK-DC002", carlListing);
    await pg.admin.query(
      "update public.bookings set provider_id = null, opened_at = now() where id = $1",
      [job],
    );

    const carl = await pg.asUser(CARL);
    const { rows } = await carl.query(
      "select id from public.bookings where id = $1",
      [job],
    );
    expect(rows).toHaveLength(0);
  });

  it("still offers it to everybody else who can do it", async () => {
    // The other half of the same policy: refusing must remove the job from one
    // professional's list, not from the pool.
    const { rows } = await (await pg.asUser(DEEPA)).query(
      "select reference from public.bookings where reference = 'SK-DC002'",
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses to hand the job back to them even when the customer asks", async () => {
    // The customer's own suggestion list excludes them, but the list is a
    // screen and this is the rule. Raised rather than silently ignored: a
    // caller must not be able to mistake it for having worked.
    const alice = await pg.asUser(ALICE);
    await expect(
      alice.query(
        `update public.bookings set provider_id = $1
         where reference = 'SK-DC002'`,
        [carlListing],
      ),
    ).rejects.toThrow(/already turned this job down/i);
  });

  it("lets the customer pick somebody who does cover the job", async () => {
    const alice = await pg.asUser(ALICE);
    const { rows } = await alice.query(
      `update public.bookings set provider_id = $1
       where reference = 'SK-DC002' returning provider_id`,
      [deepaListing],
    );
    expect(rows[0].provider_id).toBe(deepaListing);
  });

  it("refuses a professional who does not cover the ward or the category", async () => {
    /*
     * This was a hole before the customer could re-pick at all: the customer
     * update policy made every column on their own booking writable, so a
     * booking could be assigned to a listing that had never heard of it. It is
     * load-bearing now that re-picking is a real path, and it is enforced for
     * every caller rather than in the one action that uses it.
     */
    const { rows: outsider } = await pg.admin.query(
      `insert into public.providers
         (display_name, service_areas, base_rate, is_verified)
       values ('Bhaktapur Cooling', '{bhaktapur-2}', 1200, true)
       returning id`,
    );
    await pg.admin.query(
      `insert into public.provider_categories (provider_id, category_slug)
       values ($1, 'ac-servicing') on conflict do nothing`,
      [outsider[0].id],
    );

    const job = await freshJob("SK-FAR01", null);
    const alice = await pg.asUser(ALICE);
    await expect(
      alice.query("update public.bookings set provider_id = $1 where id = $2", [
        outsider[0].id,
        job,
      ]),
    ).rejects.toThrow(/does not cover this job/i);
  });

  it("counts acceptances, so a withdrawal rate has a denominator", async () => {
    const job = await freshJob("SK-AC001", deepaListing);
    const before = await pg.admin.query(
      "select jobs_accepted from public.provider_stats where provider_id = $1",
      [deepaListing],
    );
    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [job],
    );
    const { rows } = await pg.admin.query(
      "select jobs_accepted from public.provider_stats where provider_id = $1",
      [deepaListing],
    );
    expect(Number(rows[0].jobs_accepted)).toBe(
      Number(before.rows[0]?.jobs_accepted ?? 0) + 1,
    );
  });

  it("keeps a refusal readable by the customer whose job it was", async () => {
    // The booking page reads this to know a professional walked away rather
    // than none having taken it yet — the difference between "we are looking"
    // and "here are three others".
    const { rows } = await (await pg.asUser(ALICE)).query(
      `select r.kind from public.booking_refusals r
       join public.bookings b on b.id = r.booking_id
       where b.reference = 'SK-DC002'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("does not show one professional's refusals to another", async () => {
    const { rows } = await (await pg.asUser(DEEPA)).query(
      "select id from public.booking_refusals",
    );
    expect(rows).toHaveLength(0);
  });
});

/*
 * THE SETTLEMENT COLUMNS ARE THE SERVER'S.
 *
 * The commission floor only removes the motive to under-report if the figures
 * it is computed from cannot be edited by the people it applies to. RLS is
 * row-level, so every column on an updatable row is updatable — which is how
 * the original money bug happened — and the answer is the same trigger that
 * already guards the price: name the columns.
 *
 * `customer_reported_amount` and `amount_mismatch_at` matter most. They are
 * the record of a customer's independent answer and of the two figures
 * disagreeing; a browser that could write either could erase the only evidence
 * a cash handover produces.
 */
describe("the settlement figures cannot be typed from a browser", () => {
  let liveBooking: string;

  beforeAll(async () => {
    // A booking of Alice's that is still updatable by her: earlier tests in
    // this file end hers, and an update matching zero rows would pass these
    // assertions without the trigger ever running.
    const { rows: address } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Sanepa', 'Green gate')
       returning id`,
      [ALICE],
    );
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ('SK-FEE01', $1, 'plumbing', $2, 'Leaking tap', 900, 4500)
       returning id`,
      [ALICE, address[0].id],
    );
    liveBooking = rows[0].id as string;
  });

  const columns = [
    ["commission_basis", "400"],
    ["commission_floor_waived", "true"],
    ["customer_reported_amount", "100"],
    ["amount_mismatch_at", "now()"],
    ["payout_due_at", "now()"],
  ] as const;

  for (const [column, value] of columns) {
    it(`refuses a customer writing ${column}`, async () => {
      const alice = await pg.asUser(ALICE);
      await expect(
        alice.query(
          `update public.bookings set ${column} = ${value} where id = $1`,
          [liveBooking],
        ),
      ).rejects.toThrow(/not editable from a browser/i);
    });
  }

  it("still lets the server write them", async () => {
    // auth.uid() is null for the service role, which is how every legitimate
    // settlement passes through the same trigger untouched.
    const { rows } = await pg.admin.query(
      `update public.bookings
       set commission_basis = 900, customer_reported_amount = 1500,
           payout_due_at = now()
       where id = $1 returning commission_basis`,
      [liveBooking],
    );
    expect(Number(rows[0].commission_basis)).toBe(900);
  });
});

describe("an appeal against the commission floor", () => {
  it("is readable by the professional whose job it was", async () => {
    const { rows: listing } = await pg.admin.query(
      "select id from public.providers where profile_id = $1 limit 1",
      [ALICE],
    );
    const { rows: booking } = await pg.admin.query(
      "select id from public.bookings where customer_id = $1 limit 1",
      [BOB],
    );
    await pg.admin.query(
      `insert into public.commission_appeals (booking_id, provider_id, reason)
       values ($1, $2, 'Only needed a washer')`,
      [booking[0].id, listing[0].id],
    );

    const { rows } = await (await pg.asUser(ALICE)).query(
      "select reason from public.commission_appeals",
    );
    expect(rows).toHaveLength(1);
  });

  it("is invisible to everybody else", async () => {
    const { rows } = await (await pg.asUser(BOB)).query(
      "select id from public.commission_appeals",
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot be raised, edited or withdrawn from a browser", async () => {
    // An appeal decides money, so it follows the same rule as `payments`: RLS
    // grants nobody insert or update, and the write happens in lib/data under
    // the service role after the ownership check.
    const { rows: booking } = await pg.admin.query(
      "select id from public.bookings where customer_id = $1 limit 1",
      [ALICE],
    );
    const { rows: listing } = await pg.admin.query(
      "select id from public.providers where profile_id = $1 limit 1",
      [ALICE],
    );
    const alice = await pg.asUser(ALICE);

    await expect(
      alice.query(
        `insert into public.commission_appeals (booking_id, provider_id, reason)
         values ($1, $2, 'let me off')`,
        [booking[0].id, listing[0].id],
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);

    // An update with no policy behind it is not an error — it simply matches
    // nothing, which is the quieter half of the same guarantee.
    const updated = await alice.query(
      "update public.commission_appeals set status = 'upheld'",
    );
    expect(updated.rowCount).toBe(0);
  });

  it("allows only one per booking, so a queue cannot be flooded", async () => {
    const { rows } = await pg.admin.query(
      "select booking_id, provider_id from public.commission_appeals limit 1",
    );
    await expect(
      pg.admin.query(
        `insert into public.commission_appeals (booking_id, provider_id, reason)
         values ($1, $2, 'again')`,
        [rows[0].booking_id, rows[0].provider_id],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("the pricing signal is support's number, not a customer's", () => {
  it("aggregates settled jobs per category for the service role", async () => {
    const { rows } = await pg.admin.query(
      "select * from public.category_pricing_signals",
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  it("is not readable by a signed-in person at all", async () => {
    // A view runs with the caller's own policies, so a customer reading it
    // would see their own two rows and get a meaningless average — worse than
    // no number, because it looks like one.
    const alice = await pg.asUser(ALICE);
    await expect(
      alice.query("select * from public.category_pricing_signals"),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("the payment mix is support's baseline, not a public number", () => {
  it("aggregates settled jobs by category, ward and month", async () => {
    const { rows } = await pg.admin.query(
      "select * from public.payment_mix_signals",
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  it("is not readable by a signed-in person", async () => {
    // Same rule as the pricing signals: a view runs with the caller's own
    // policies, so a customer would see their own rows and get an average of
    // nothing — a confident number that means nothing is worse than no number.
    const alice = await pg.asUser(ALICE);
    await expect(
      alice.query("select * from public.payment_mix_signals"),
    ).rejects.toThrow(/permission denied/i);
  });
});

/*
 * A BOOKING MAY ONLY BE MADE AT AN ADDRESS ITS CUSTOMER OWNS.
 *
 * Found in the Phase 9 audit, and it is the same shape as the two holes that
 * shipped before it: an id arrived from the browser and nothing checked whose
 * it was. The insert policy validated `customer_id` and stopped, so a booking
 * could be made at any address whose uuid somebody had — and the address goes
 * to the professional who accepts the job, which means a stranger at that
 * door. Address ids are uuids, but "you need to know a uuid first" is not a
 * control on a product whose sensitive core is people's homes.
 */
describe("a booking cannot be made at somebody else's address", () => {
  it("refuses a customer booking at another customer's address", async () => {
    const { rows: bobAddress } = await pg.admin.query(
      "select id from public.addresses where profile_id = $1 limit 1",
      [BOB],
    );
    const alice = await pg.asUser(ALICE);

    await expect(
      alice.query(
        `insert into public.bookings
           (reference, customer_id, category_slug, address_id, description,
            quoted_min, quoted_max)
         values ('SK-STEAL', $1, 'plumbing', $2, 'Send somebody here', 900, 4500)`,
        [ALICE, bobAddress[0].id],
      ),
    ).rejects.toThrow(/somebody else's address/i);
  });

  it("refuses the server too — there is no legitimate caller for it", async () => {
    // Unlike the immutability trigger, this one has no service-role exception.
    // No path in this product books a job at an address its customer does not
    // own, so an exception could only ever be a bug with permission.
    const { rows: bobAddress } = await pg.admin.query(
      "select id from public.addresses where profile_id = $1 limit 1",
      [BOB],
    );
    await expect(
      pg.admin.query(
        `insert into public.bookings
           (reference, customer_id, category_slug, address_id, description,
            quoted_min, quoted_max)
         values ('SK-STEA2', $1, 'plumbing', $2, 'Send somebody here', 900, 4500)`,
        [ALICE, bobAddress[0].id],
      ),
    ).rejects.toThrow(/somebody else's address/i);
  });

  it("refuses an address that does not exist at all", async () => {
    await expect(
      pg.admin.query(
        `insert into public.bookings
           (reference, customer_id, category_slug, address_id, description,
            quoted_min, quoted_max)
         values ('SK-STEA3', $1, 'plumbing', '00000000-0000-4000-8000-000000000000',
                 'Nowhere', 900, 4500)`,
        [ALICE],
      ),
    ).rejects.toThrow(/does not exist|violates foreign key/i);
  });

  it("still allows a customer to book at their own", async () => {
    const { rows: mine } = await pg.admin.query(
      "select id from public.addresses where profile_id = $1 limit 1",
      [ALICE],
    );
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ('SK-OWNOK', $1, 'plumbing', $2, 'My own tap', 900, 4500)
       returning id`,
      [ALICE, mine[0].id],
    );
    expect(rows).toHaveLength(1);
  });

  it("cannot be moved to somebody else's address afterwards", async () => {
    const { rows: bobAddress } = await pg.admin.query(
      "select id from public.addresses where profile_id = $1 limit 1",
      [BOB],
    );
    await expect(
      pg.admin.query(
        "update public.bookings set address_id = $1 where reference = 'SK-OWNOK'",
        [bobAddress[0].id],
      ),
    ).rejects.toThrow(/somebody else's address/i);
  });
});

/*
 * EVERY TABLE, NOT EVERY TABLE SOMEBODY REMEMBERED.
 *
 * The per-table cases above prove the policies we thought to write. This block
 * proves the ones we did not: it reads the catalog, so a table added in a
 * later phase — provider documents, KYC, anything Phase 10 brings — fails here
 * the moment it exists without policies, rather than the moment somebody reads
 * it back in production.
 *
 * Supabase grants `anon` and `authenticated` full table privileges by default,
 * so RLS is the ONLY thing between a stranger and every row in this database.
 * That is the normal Supabase posture and it is why "the policy exists" is not
 * the question worth asking. The question is whether it restricts.
 */
describe("RLS covers every table, including ones nobody has written a test for", () => {
  /** Readable by anybody, on purpose: the catalogue and the public directory. */
  const PUBLIC_TO_ANON = new Set([
    "categories",
    "providers",
    "provider_categories",
    "provider_reviews",
    "provider_stats",
  ]);

  /** The one table a stranger may write to: the "join us" form. */
  const ANON_MAY_WRITE = new Set(["provider_leads"]);

  const tables = async (): Promise<
    Array<{ relname: string; rls: boolean; policies: number }>
  > => {
    const { rows } = await pg.admin.query(`
      select c.relname,
             c.relrowsecurity as rls,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `);
    return rows as Array<{ relname: string; rls: boolean; policies: number }>;
  };

  it("has row level security enabled on every table", async () => {
    const without = (await tables()).filter((t) => !t.rls).map((t) => t.relname);
    expect(without).toEqual([]);
  });

  it("has at least one policy on every table", async () => {
    // RLS with no policies denies everything, which is safe but is almost
    // always a mistake rather than a decision — the table is unreachable and
    // whoever wrote it has not noticed yet.
    const bare = (await tables())
      .filter((t) => t.policies === 0)
      .map((t) => t.relname);
    expect(bare).toEqual([]);
  });

  it("shows a stranger nothing but the catalogue", async () => {
    const anon = await pg.asAnon();
    const leaked: string[] = [];

    for (const { relname } of await tables()) {
      if (PUBLIC_TO_ANON.has(relname)) continue;
      const { rows } = await anon.query(
        `select 1 from public.${relname} limit 1`,
      );
      if (rows.length > 0) leaked.push(relname);
    }

    expect(leaked).toEqual([]);
  });

  it("still shows a stranger the catalogue, because a shop has to have a window", async () => {
    // The other half of the same guarantee. A test that only proves things are
    // hidden passes just as well on a database that has locked the product
    // out of its own front page.
    const anon = await pg.asAnon();
    const { rows } = await anon.query("select 1 from public.categories limit 1");
    expect(rows.length).toBe(1);
  });

  it("lets a stranger write to nothing but the join form", async () => {
    const { rows } = await pg.admin.query(`
      select distinct c.relname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and p.polcmd <> 'r'
        and p.polpermissive
        and 'anon' = any (select rolname from pg_roles where oid = any (p.polroles))
      order by 1
    `);
    const writable = (rows as Array<{ relname: string }>).map((r) => r.relname);
    expect(writable.filter((t) => !ANON_MAY_WRITE.has(t))).toEqual([]);
  });

  it("has no private table readable by every signed-in person", async () => {
    /*
     * The failure this is here for: a SELECT policy of `using (true)`. It
     * exists, it is listed, the advisor is happy, and it restricts nothing —
     * which is worse than no policy, because the table now reads as covered.
     */
    const { rows } = await pg.admin.query(`
      select c.relname, p.polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and p.polcmd in ('r', '*')
        and p.polpermissive
        and coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') in ('true', '(true)')
      order by 1, 2
    `);
    const open = (rows as Array<{ relname: string; polname: string }>)
      .filter((r) => !PUBLIC_TO_ANON.has(r.relname))
      .map((r) => `${r.relname}: ${r.polname}`);
    expect(open).toEqual([]);
  });

  it("has no personal table that every signed-in person can read in full", async () => {
    /*
     * The blunt version of the per-table cases above, and the one that catches
     * a table nobody wrote a case for.
     *
     * "Everyone sees everything" is the hole. "The owner sees all of it" is
     * the point — the first draft of this asserted that NOBODY saw the whole
     * table and flagged `booking_refusals`, where every fixture row happens to
     * belong to the same customer. A test that cannot tell those apart would
     * have had us weaken a correct policy.
     */
    const alice = await pg.asUser(ALICE);
    const bob = await pg.asUser(BOB);
    const shared: string[] = [];

    for (const { relname } of await tables()) {
      if (PUBLIC_TO_ANON.has(relname)) continue;

      const { rows: all } = await pg.admin.query(
        `select count(*)::int as n from public.${relname}`,
      );
      if ((all[0] as { n: number }).n < 2) continue;

      const seen = await Promise.all(
        [alice, bob].map(async (client) => {
          const { rows } = await client.query(
            `select count(*)::int as n from public.${relname}`,
          );
          return (rows[0] as { n: number }).n;
        }),
      );

      if (seen.every((n) => n === (all[0] as { n: number }).n)) {
        shared.push(relname);
      }
    }

    expect(shared).toEqual([]);
  });
});

/*
 * THE LOG HAS TO BE UNWRITEABLE BY THE THING BEING LOGGED.
 *
 * A log the application can edit proves nothing. The first thing anybody
 * holding our service role key would do is tidy up after themselves, and the
 * first thing a careless migration would do is "clean up old rows" — so the
 * trigger refuses UPDATE and DELETE for every caller, including the service
 * role that writes it. Retention, when it is decided, is a deliberate
 * migration that drops the trigger, says why, and puts it back.
 */
describe("the security log is append-only and admin-only", () => {
  let eventId: string;

  beforeAll(async () => {
    const { rows } = await pg.admin.query(
      `insert into public.security_events (kind, actor_id, actor_role, subject_type, subject_id, detail)
       values ('payment.amountRecorded', $1, 'provider', 'booking', 'SK-AUDIT', '{"amount": 2000}'::jsonb)
       returning id`,
      [ALICE],
    );
    eventId = rows[0].id as string;
  });

  it("refuses an update, even from the server", async () => {
    await expect(
      pg.admin.query(
        "update public.security_events set detail = '{}'::jsonb where id = $1",
        [eventId],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses a delete, even from the server", async () => {
    await expect(
      pg.admin.query("delete from public.security_events where id = $1", [eventId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("is invisible to the person it is about", async () => {
    // Alice is the actor on that row. She still cannot read it: an audit log
    // somebody can read is an audit log they know how to work around.
    const { rows } = await (await pg.asUser(ALICE)).query(
      "select id from public.security_events",
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot be forged from a browser", async () => {
    const alice = await pg.asUser(ALICE);
    await expect(
      alice.query(
        `insert into public.security_events (kind, actor_id, actor_role)
         values ('auth.signedIn', $1, 'admin')`,
        [BOB],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

/*
 * IDENTITY DOCUMENTS, BEFORE THERE ARE ANY.
 *
 * Phase 10 collects citizenship certificates, PAN cards and photographs of
 * people's faces. These cases exist now, against an empty table, because a
 * storage model tested after the data arrives is a model whose first test
 * subject is somebody's citizenship certificate.
 */
describe("identity documents are the owner's and the admin's, nobody else's", () => {
  beforeAll(async () => {
    await pg.admin.query(
      `insert into public.provider_documents
         (profile_id, kind, storage_path, mime_type, byte_size)
       values ($1, 'citizenship', $2, 'image/jpeg', 120000)
       on conflict (storage_path) do nothing`,
      [ALICE, `${ALICE}/citizenship/doc-1.jpg`],
    );
  });

  it("lets the owner see their own", async () => {
    const { rows } = await (await pg.asUser(ALICE)).query(
      "select id from public.provider_documents",
    );
    expect(rows).toHaveLength(1);
  });

  it("hides it from every other signed-in person", async () => {
    // Not other professionals, not customers, not their own customers. The
    // verification badge is what the product shows; the document behind it is
    // never shown to anybody.
    const { rows } = await (await pg.asUser(BOB)).query(
      "select id from public.provider_documents",
    );
    expect(rows).toHaveLength(0);
  });

  it("hides it from a stranger entirely", async () => {
    const { rows } = await (await pg.asAnon()).query(
      "select id from public.provider_documents",
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot be uploaded, edited or approved from a browser", async () => {
    // Uploads and review decisions go through the service role after the
    // server has checked who is asking — the same rule as payments, because a
    // row a client can write is a row an attacker can forge. Marking your own
    // document `verified` is the specific forgery this prevents.
    const alice = await pg.asUser(ALICE);
    await expect(
      alice.query(
        `insert into public.provider_documents
           (profile_id, kind, storage_path, mime_type, byte_size, status)
         values ($1, 'citizenship', $2, 'image/jpeg', 100, 'verified')`,
        [ALICE, `${ALICE}/citizenship/forged.jpg`],
      ),
    ).rejects.toThrow(/row-level security/i);

    const updated = await alice.query(
      "update public.provider_documents set status = 'verified'",
    );
    expect(updated.rowCount).toBe(0);
  });
});

/*
 * THE PHOTOGRAPHS OF THE INSIDE OF PEOPLE'S HOMES.
 *
 * These policies shipped in Phase 6 and had never been run by a test: the
 * harness skipped their migration because plain Postgres has no `storage`
 * schema, so the one bucket holding pictures of somebody's kitchen was the one
 * thing with no coverage. The shim in tests/support/postgres.ts models enough
 * of Supabase Storage to run them for real.
 */
describe("booking photos are the customer's, and the professional's only while the job is live", () => {
  const CARL_ID = "33333333-3333-4333-8333-333333333333";
  let photoPath: string;
  let liveJob: string;
  let carlListing: string;

  beforeAll(async () => {
    const { rows: listing } = await pg.admin.query(
      "select id from public.providers where display_name = 'Carl Cooling' limit 1",
    );
    carlListing = listing[0].id as string;

    photoPath = `${ALICE}/kitchen.jpg`;
    await pg.admin.query(
      `insert into storage.objects (bucket_id, name, owner)
       values ('booking-photos', $1, $2)`,
      [photoPath, ALICE],
    );

    const { rows: address } = await pg.admin.query(
      "select id from public.addresses where profile_id = $1 limit 1",
      [ALICE],
    );
    const { rows: booking } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max, photo_url, provider_id)
       values ('SK-PHOTO', $1, 'ac-servicing', $2, 'Photo of the unit', 1200, 6000, $3, $4)
       returning id`,
      [ALICE, address[0].id, photoPath, carlListing],
    );
    liveJob = booking[0].id as string;
  });

  it("lets the customer read their own photo", async () => {
    const { rows } = await (await pg.asUser(ALICE)).query(
      "select name from storage.objects where bucket_id = 'booking-photos'",
    );
    expect(rows.map((r) => r.name)).toContain(photoPath);
  });

  it("hides it from another customer", async () => {
    const { rows } = await (await pg.asUser(BOB)).query(
      "select name from storage.objects where name = $1",
      [photoPath],
    );
    expect(rows).toHaveLength(0);
  });

  it("hides it from a stranger", async () => {
    // The bucket is private, so there is no URL to guess either. This is the
    // second lock: even holding the object's name gets nothing.
    const { rows } = await (await pg.asAnon()).query(
      "select name from storage.objects where name = $1",
      [photoPath],
    );
    expect(rows).toHaveLength(0);
  });

  it("shows it to the assigned professional once the job is accepted", async () => {
    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [liveJob],
    );
    const { rows } = await (await pg.asUser(CARL_ID)).query(
      "select name from storage.objects where name = $1",
      [photoPath],
    );
    expect(rows).toHaveLength(1);
  });

  it("takes it away again when the job is over", async () => {
    // The window closes. A professional who did a job in January does not
    // keep a view into that kitchen for ever.
    await pg.admin.query(
      `update public.bookings set status = 'en_route' where id = $1`,
      [liveJob],
    );
    await pg.admin.query(
      `update public.bookings set status = 'in_progress' where id = $1`,
      [liveJob],
    );
    await pg.admin.query(
      `update public.bookings set status = 'completed' where id = $1`,
      [liveJob],
    );
    const { rows } = await (await pg.asUser(CARL_ID)).query(
      "select name from storage.objects where name = $1",
      [photoPath],
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses an upload into somebody else's folder", async () => {
    // The path's first segment is the owner and the policy compares it to
    // auth.uid(). Without that, one customer writes into another's folder and
    // the read policy then hands it to the wrong person.
    const bob = await pg.asUser(BOB);
    await expect(
      bob.query(
        `insert into storage.objects (bucket_id, name, owner)
         values ('booking-photos', $1, $2)`,
        [`${ALICE}/planted.jpg`, BOB],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
