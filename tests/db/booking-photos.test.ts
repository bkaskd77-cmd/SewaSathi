import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * Three photographs on a booking, and who may see them.
 *
 * WHAT THESE PROTECT. A booking photograph is the inside of somebody's home. The single
 * `bookings.photo_url` had three readers — the customer, the assigned professional while
 * the job is live, and an admin — and the set has to have exactly the same three, or
 * widening from one column to a table would quietly widen who can look.
 */
let pg: Harness;

const CUSTOMER = "cccccccc-7777-4777-8777-cccccccccccc";
const OTHER = "dddddddd-7777-4777-8777-dddddddddddd";
let bookingId = "";

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name] of [
    [CUSTOMER, "Customer"],
    [OTHER, "Somebody else"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, 'customer')
       on conflict (id) do nothing`,
      [id, name, `+97798${id.slice(0, 7)}`],
    );
  }

  /* A booking needs an address its own customer owns — `enforce_booking_address_ownership`
     has no service-role bypass, because no path books a job at somebody else's door. */
  const { rows: addressRows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [CUSTOMER],
  );

  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, category_slug, address_id, description,
        quoted_min, quoted_max)
     values ('SK-PHOTO', $1, 'plumbing', $2, 'A leaking tap', 500, 1500)
     returning id`,
    [CUSTOMER, addressRows[0].id],
  );
  bookingId = rows[0].id;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("a booking carries at most three photographs", () => {
  /*
   * THE KEY IS THE LIMIT, NOT A TRIGGER AND NOT THE APPLICATION. A count-and-insert in
   * TypeScript is a race: two uploads reading "two so far" both write a third. A unique
   * (booking_id, position) with position checked to 0-2 means a fourth has nowhere to go,
   * and the database refuses it rather than the application remembering not to.
   */
  it("refuses a fourth by having nowhere to put it", async () => {
    for (const position of [0, 1, 2]) {
      await pg.admin.query(
        `insert into public.booking_photos (booking_id, storage_path, position)
         values ($1, $2, $3)`,
        [bookingId, `${CUSTOMER}/photo-${position}.jpg`, position],
      );
    }

    const fourth = await pg.admin
      .query(
        `insert into public.booking_photos (booking_id, storage_path, position)
         values ($1, $2, 3)`,
        [bookingId, `${CUSTOMER}/photo-3.jpg`],
      )
      .then(
        () => "allowed",
        (error: { message: string }) => error.message,
      );
    expect(fourth).toMatch(/position/i);

    /* And the race: a second photograph claiming a slot that is taken. */
    const collision = await pg.admin
      .query(
        `insert into public.booking_photos (booking_id, storage_path, position)
         values ($1, $2, 1)`,
        [bookingId, `${CUSTOMER}/another.jpg`],
      )
      .then(
        () => "allowed",
        (error: { message: string }) => error.message,
      );
    expect(collision).toMatch(/booking_photos_one_per_slot/i);
  });

  it("holds exactly three", async () => {
    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.booking_photos where booking_id = $1",
      [bookingId],
    );
    expect(rows[0].n).toBe(3);
  });
});

describe("who may see a photograph of the inside of a home", () => {
  it("lets the customer who sent them read their own", async () => {
    const client = await pg.asUser(CUSTOMER);
    const { rows } = await client.query(
      "select position from public.booking_photos where booking_id = $1",
      [bookingId],
    );
    expect(rows).toHaveLength(3);
    await client.end();
  });

  /* The case that matters: another signed-in customer is a stranger to this booking. */
  it("shows another customer nothing", async () => {
    const client = await pg.asUser(OTHER);
    const { rows } = await client.query("select position from public.booking_photos");
    expect(rows).toEqual([]);
    await client.end();
  });

  /*
   * ANON IS REFUSED BY THE GRANT, NOT BY A POLICY — `permission denied` from the planner
   * before any row is considered, which is a different fact from an empty result and the
   * reason `20261002000001` exists.
   */
  it("refuses anon outright", async () => {
    const anon = await pg.asAnon();
    const result = await anon
      .query("select position from public.booking_photos")
      .then(
        () => "allowed",
        (error: { message: string }) => error.message,
      );
    expect(result).toMatch(/permission denied/i);
    await anon.end();
  });

  it("refuses a write from the browser, by either customer", async () => {
    for (const id of [CUSTOMER, OTHER]) {
      const client = await pg.asUser(id);
      const result = await client
        .query(
          `insert into public.booking_photos (booking_id, storage_path, position)
           values ($1, 'x/y.jpg', 0)`,
          [bookingId],
        )
        .then(
          () => "allowed",
          (error: { message: string }) => error.message,
        );
      expect(result).toMatch(/permission denied/i);
      await client.end();
    }
  });
});
