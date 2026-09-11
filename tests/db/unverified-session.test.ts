import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * An unverified session may write one emergency booking and read nothing.
 *
 * THE CONSTRAINT IS IN THIS FILE BECAUSE A DOCUMENT CANNOT FAIL A BUILD. The
 * booking path it guards is deliberately unbuilt — it only becomes necessary
 * if a gateway tells us codes can be delayed or barred overnight — but the day
 * somebody does build it, they will be building it because sign-in is broken
 * at 2am, which is the worst possible moment to be re-deriving a security rule
 * from a paragraph in ARCHITECTURE.md.
 *
 * The trade being guarded: letting a stranger book without a code buys
 * availability. Letting that same session *read* would sell account takeover
 * to anybody who can type a phone number. The first is worth having; the
 * second is worse than the problem it solves.
 *
 * Today every account is confirmed, because verifying an OTP is what confirms
 * it and OTP is the only way in. So these tests construct the unverified user
 * that cannot yet occur naturally, and assert the door is already shut.
 */

let pg: Harness;

const VERIFIED = "11111111-aaaa-4aaa-8aaa-111111111111";
const UNVERIFIED = "22222222-bbbb-4bbb-8bbb-222222222222";

let verifiedBooking: string;
let unverifiedBooking: string;
let verifiedAddress: string;
let unverifiedAddress: string;

beforeAll(async () => {
  pg = await startPostgres();

  await pg.admin.query(
    `insert into auth.users (id, phone, phone_confirmed_at)
     values ($1, '9779800000501', now())`,
    [VERIFIED],
  );
  // The account that cannot exist yet: created from a phone nobody proved.
  await pg.admin.query(
    `insert into auth.users (id, phone, phone_confirmed_at)
     values ($1, '9779800000502', null)`,
    [UNVERIFIED],
  );

  for (const [id, name] of [
    [VERIFIED, "Verified"],
    [UNVERIFIED, "Unverified"],
  ] as const) {
    await pg.admin.query(
      `insert into public.profiles (id, full_name)
       values ($1, $2)
       on conflict (id) do update set full_name = excluded.full_name`,
      [id, name],
    );
  }

  const mkAddress = async (owner: string) => {
    const { rows } = await pg.admin.query<{ id: string }>(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
       returning id`,
      [owner],
    );
    return rows[0].id;
  };

  verifiedAddress = await mkAddress(VERIFIED);
  unverifiedAddress = await mkAddress(UNVERIFIED);

  const mkBooking = async (customer: string, addressId: string) => {
    const { rows } = await pg.admin.query<{ id: string }>(
      `insert into public.bookings
         (reference, customer_id, address_id, category_slug, description,
          quoted_min, quoted_max)
       values ($1, $2, $3, 'plumbing', 'Water everywhere', 1500, 4000)
       returning id`,
      [`SK-UV-${customer.slice(0, 4)}`, customer, addressId],
    );
    return rows[0].id;
  };

  verifiedBooking = await mkBooking(VERIFIED, verifiedAddress);
  unverifiedBooking = await mkBooking(UNVERIFIED, unverifiedAddress);
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("an unverified session reads nothing", () => {
  it("cannot read its own booking", async () => {
    // Not "cannot read somebody else's" — cannot read ITS OWN. The session is
    // trusted to create the emergency, never to prove who it belongs to, so
    // the booking it just wrote is not evidence that the phone is theirs.
    const client = await pg.asUser(UNVERIFIED);
    const { rows } = await client.query(
      "select id from public.bookings where id = $1",
      [unverifiedBooking],
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("cannot read its own address", async () => {
    const client = await pg.asUser(UNVERIFIED);
    const { rows } = await client.query(
      "select id from public.addresses where id = $1",
      [unverifiedAddress],
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("cannot read anybody else's booking", async () => {
    // The attack the constraint exists for: sign up as a number you do not
    // own, and read what its real owner has booked.
    const client = await pg.asUser(UNVERIFIED);
    const { rows } = await client.query(
      "select id from public.bookings where id = $1",
      [verifiedBooking],
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("cannot read anybody else's address", async () => {
    const client = await pg.asUser(UNVERIFIED);
    const { rows } = await client.query(
      "select id from public.addresses where id = $1",
      [verifiedAddress],
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("sees an empty list, not an error", async () => {
    // RLS filters rather than refuses, which is what keeps a page rendering an
    // empty state instead of a 500. Asserted so nobody "fixes" it into a throw.
    const client = await pg.asUser(UNVERIFIED);
    const { rows } = await client.query("select id from public.bookings");
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("the guard is inert for everybody who verified", () => {
  it("lets a confirmed customer read their own booking", async () => {
    // The whole product runs through this policy. If the predicate is ever
    // wrong in this direction, every signed-in customer sees an empty account.
    const client = await pg.asUser(VERIFIED);
    const { rows } = await client.query(
      "select id from public.bookings where id = $1",
      [verifiedBooking],
    );
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("lets a confirmed customer read their own address", async () => {
    const client = await pg.asUser(VERIFIED);
    const { rows } = await client.query(
      "select id from public.addresses where id = $1",
      [verifiedAddress],
    );
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("still hides another customer's booking from a confirmed customer", async () => {
    // The guard is an addition, not a replacement. Ownership still decides.
    const client = await pg.asUser(VERIFIED);
    const { rows } = await client.query(
      "select id from public.bookings where id = $1",
      [unverifiedBooking],
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("session_is_verified fails open only where it is safe", () => {
  it("is true when there is no session at all", async () => {
    // A guard on every read must not be able to lock out a legitimate customer
    // because a lookup returned nothing. It refuses only a user it can see and
    // can prove is unconfirmed — so no claim means true, not false.
    await pg.admin.query("select set_config('request.jwt.claim.sub', '', true)");
    const { rows } = await pg.admin.query<{ verified: boolean }>(
      "select public.session_is_verified() as verified",
    );
    expect(rows[0].verified).toBe(true);
  });

  it("is not callable by an anonymous visitor", async () => {
    // Nothing signed out reads `bookings` or `addresses` — both policies are
    // `to authenticated` — so `anon` has no business calling the predicate.
    // Asserted because the opposite mistake is the one that matters on the
    // other side: revoking it from `authenticated` would empty the account
    // page for every signed-in customer, the same trap as `is_admin()`.
    const client = await pg.asAnon();
    await expect(
      client.query("select public.session_is_verified()"),
    ).rejects.toThrow(/permission denied/i);
    await client.end();
  });

  it("is true for a confirmed user and false for an unconfirmed one", async () => {
    for (const [id, expected] of [
      [VERIFIED, true],
      [UNVERIFIED, false],
    ] as const) {
      const client = await pg.asUser(id);
      const { rows } = await client.query<{ verified: boolean }>(
        "select public.session_is_verified() as verified",
      );
      expect(rows[0].verified).toBe(expected);
      await client.end();
    }
  });

  it("does not stand between the service role and a booking", async () => {
    // Every server write goes through the service role, which must keep
    // working for an unverified customer — creating the emergency booking is
    // the entire point of the path this guards.
    const { rows } = await pg.admin.query(
      "select id from public.bookings where id = $1",
      [unverifiedBooking],
    );
    expect(rows).toHaveLength(1);
  });
});
