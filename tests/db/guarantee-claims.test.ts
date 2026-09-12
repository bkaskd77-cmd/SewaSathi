import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The guarantee, against the real policies and triggers.
 *
 * THE ONE RULE WORTH THE WHOLE FILE: `resolved` is reachable only from
 * `attended`. Every cheap version of a guarantee has a route to the expensive
 * half that skips the visit — support closing a claim from a description typed
 * into a box — and that route is a repeatable way to get free work. It is
 * checked here rather than trusted to `lib/booking/claim-status.ts`, because
 * the interface is the half that can be bypassed and the database is not.
 *
 * The second is that money back needs a person. No verdict fills in
 * `refund_decided_by`, and a refund without it is refused for every caller,
 * service role included.
 */

const ANITA = "aaaaaaaa-9111-4111-8111-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-9222-4222-8222-bbbbbbbbbbbb";
const SITA = "dddddddd-9444-4444-8444-dddddddddddd";
const ADMIN = "cccccccc-9333-4333-8333-cccccccccccc";
const STRANGER = "eeeeeeee-9555-4555-8555-eeeeeeeeeeee";

let pg: Harness;
let booking: string;
let anitaAddress: string;
let krishnaProvider: string;
let sitaProvider: string;

/** A booking that has been done and paid for — the only kind you may claim on. */
async function completedBooking(reference: string): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, 'plumbing', $4, 'Kitchen tap drips', 900, 4500)
     returning id`,
    [reference, ANITA, krishnaProvider, anitaAddress],
  );

  const id = rows[0].id as string;
  for (const status of ["accepted", "en_route", "in_progress", "completed"]) {
    await pg.admin.query("update public.bookings set status = $1 where id = $2", [
      status,
      id,
    ]);
  }
  return id;
}

async function openClaim(bookingId: string): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.guarantee_claims
       (booking_id, customer_id, provider_id, category_slug, description)
     values ($1, $2, $3, 'plumbing', 'It is dripping again')
     returning id`,
    [bookingId, ANITA, krishnaProvider],
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
    [SITA, "Sita Gurung", "provider"],
    [ADMIN, "Admin", "admin"],
    [STRANGER, "Passer By", "customer"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779812${id.slice(0, 6)}`, role],
    );
  }

  const { rows: krishnaRows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, 'Krishna Tamang', 900) returning id`,
    [KRISHNA],
  );
  krishnaProvider = krishnaRows[0].id as string;

  const { rows: sitaRows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, 'Sita Gurung', 1100) returning id`,
    [SITA],
  );
  sitaProvider = sitaRows[0].id as string;

  const { rows: addressRows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  anitaAddress = addressRows[0].id as string;

  booking = await completedBooking("SK-CLAIM1");
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the visit is the verification", () => {
  it("refuses to resolve a claim that nobody attended", async () => {
    const claim = await openClaim(await completedBooking("SK-CLAIM2"));

    await expect(
      pg.admin.query(
        `update public.guarantee_claims
         set status = 'resolved', verdict = 'sameFault', payer = 'provider'
         where id = $1`,
        [claim],
      ),
    ).rejects.toThrow(/cannot go from open to resolved/i);
  });

  it("refuses to resolve straight from dispatched", async () => {
    const claim = await openClaim(await completedBooking("SK-CLAIM3"));
    await pg.admin.query(
      `update public.guarantee_claims
       set status = 'dispatched', attending_provider_id = $2 where id = $1`,
      [claim, sitaProvider],
    );

    await expect(
      pg.admin.query(
        `update public.guarantee_claims
         set status = 'resolved', verdict = 'sameFault', payer = 'provider'
         where id = $1`,
        [claim],
      ),
    ).rejects.toThrow(/cannot go from dispatched to resolved/i);
  });

  it("refuses to mark a claim attended by nobody", async () => {
    const claim = await openClaim(await completedBooking("SK-CLAIM4"));

    await expect(
      pg.admin.query(
        "update public.guarantee_claims set status = 'dispatched' where id = $1",
        [claim],
      ),
    ).resolves.toBeTruthy();

    await expect(
      pg.admin.query(
        "update public.guarantee_claims set status = 'attended' where id = $1",
        [claim],
      ),
    ).rejects.toThrow(/attended by nobody/i);
  });

  it("resolves once somebody has been and recorded what they found", async () => {
    const claim = await openClaim(await completedBooking("SK-CLAIM5"));

    await pg.admin.query(
      `update public.guarantee_claims
       set status = 'dispatched', attending_provider_id = $2 where id = $1`,
      [claim, sitaProvider],
    );
    await pg.admin.query(
      "update public.guarantee_claims set status = 'attended' where id = $1",
      [claim],
    );
    await pg.admin.query(
      `update public.guarantee_claims
       set status = 'resolved', verdict = 'sameFault', payer = 'provider'
       where id = $1`,
      [claim],
    );

    const { rows } = await pg.admin.query(
      "select status, attended_at, closed_at from public.guarantee_claims where id = $1",
      [claim],
    );
    expect(rows[0].status).toBe("resolved");
    expect(rows[0].attended_at).not.toBeNull();
    expect(rows[0].closed_at).not.toBeNull();
  });

  it("refuses a verdict-free resolution even with an attending professional", async () => {
    const claim = await openClaim(await completedBooking("SK-CLAIM6"));
    await pg.admin.query(
      `update public.guarantee_claims
       set status = 'dispatched', attending_provider_id = $2 where id = $1`,
      [claim, sitaProvider],
    );
    await pg.admin.query(
      "update public.guarantee_claims set status = 'attended' where id = $1",
      [claim],
    );

    await expect(
      pg.admin.query(
        "update public.guarantee_claims set status = 'resolved' where id = $1",
        [claim],
      ),
    ).rejects.toThrow(/without a verdict/i);
  });

  /**
   * The professional sent to look declined it. Same shape as a booking release
   * and the only backwards move here: the customer's fault has not gone away.
   */
  it("clears the assignment when a dispatched claim goes back to open", async () => {
    const claim = await openClaim(await completedBooking("SK-CLAIM7"));
    await pg.admin.query(
      `update public.guarantee_claims
       set status = 'dispatched', attending_provider_id = $2 where id = $1`,
      [claim, sitaProvider],
    );
    await pg.admin.query(
      "update public.guarantee_claims set status = 'open' where id = $1",
      [claim],
    );

    const { rows } = await pg.admin.query(
      `select attending_provider_id, dispatched_at
       from public.guarantee_claims where id = $1`,
      [claim],
    );
    expect(rows[0].attending_provider_id).toBeNull();
    expect(rows[0].dispatched_at).toBeNull();
  });
});

describe("money back needs a person", () => {
  it("refuses a refund nobody signed, service role included", async () => {
    const claim = await openClaim(await completedBooking("SK-CLAIM8"));

    await expect(
      pg.admin.query(
        "update public.guarantee_claims set refund_rupees = 2000 where id = $1",
        [claim],
      ),
    ).rejects.toThrow(/decided by somebody/i);
  });

  it("allows one an admin decided", async () => {
    const claim = await openClaim(await completedBooking("SK-CLAIM9"));

    await pg.admin.query(
      `update public.guarantee_claims
       set refund_rupees = 2000, refund_decided_by = $2 where id = $1`,
      [claim, ADMIN],
    );

    const { rows } = await pg.admin.query(
      "select refund_rupees from public.guarantee_claims where id = $1",
      [claim],
    );
    expect(rows[0].refund_rupees).toBe(2000);
  });
});

describe("who may claim", () => {
  it("refuses a claim on a job that is not finished", async () => {
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quoted_min, quoted_max)
       values ('SK-OPEN1', $1, 'plumbing', $2, 'Tap drips', 900, 4500)
       returning id`,
      [ANITA, anitaAddress],
    );

    await expect(
      pg.admin.query(
        `insert into public.guarantee_claims
           (booking_id, customer_id, category_slug, description)
         values ($1, $2, 'plumbing', 'Still dripping')`,
        [rows[0].id, ANITA],
      ),
    ).rejects.toThrow(/only a finished job/i);
  });

  it("refuses a claim raised on somebody else's booking", async () => {
    await expect(
      pg.admin.query(
        `insert into public.guarantee_claims
           (booking_id, customer_id, category_slug, description)
         values ($1, $2, 'plumbing', 'Mine now')`,
        [booking, STRANGER],
      ),
    ).rejects.toThrow(/belongs to the customer/i);
  });

  it("allows two claims on one booking and refuses the third", async () => {
    const own = await completedBooking("SK-LIMIT1");

    const first = await openClaim(own);
    await pg.admin.query(
      "update public.guarantee_claims set status = 'rejected' where id = $1",
      [first],
    );

    const second = await openClaim(own);
    await pg.admin.query(
      "update public.guarantee_claims set status = 'rejected' where id = $1",
      [second],
    );

    await expect(openClaim(own)).rejects.toThrow(/already had two claims/i);
  });

  /**
   * A withdrawn claim does not count. Somebody who raised one and then found
   * the real cause themselves has done us a favour, and spending one of their
   * two on it teaches the opposite lesson. `countsAgainstLimit` is the same
   * rule in TypeScript.
   */
  it("does not spend an attempt on a claim the customer withdrew", async () => {
    const own = await completedBooking("SK-LIMIT2");

    for (let i = 0; i < 3; i += 1) {
      const claim = await openClaim(own);
      await pg.admin.query(
        "update public.guarantee_claims set status = 'withdrawn' where id = $1",
        [claim],
      );
    }

    await expect(openClaim(own)).resolves.toBeTruthy();
  });

  it("refuses a second live claim on the same booking", async () => {
    const own = await completedBooking("SK-LIVE1");
    await openClaim(own);

    await expect(openClaim(own)).rejects.toThrow(/guarantee_claims_one_live_idx/);
  });
});

describe("who may read a claim", () => {
  it("shows a customer their own and nobody else's", async () => {
    const client = await pg.asUser(ANITA);
    const mine = await client.query(
      "select count(*)::int as n from public.guarantee_claims",
    );
    expect(mine.rows[0].n).toBeGreaterThan(0);
    await client.end();

    const stranger = await pg.asUser(STRANGER);
    const theirs = await stranger.query(
      "select count(*)::int as n from public.guarantee_claims",
    );
    expect(theirs.rows[0].n).toBe(0);
    await stranger.end();
  });

  it("shows a professional a claim against their work", async () => {
    const client = await pg.asUser(KRISHNA);
    const { rows } = await client.query(
      "select count(*)::int as n from public.guarantee_claims",
    );
    expect(rows[0].n).toBeGreaterThan(0);
    await client.end();
  });

  it("lets nobody write one through a browser", async () => {
    const client = await pg.asUser(ANITA);
    await expect(
      client.query(
        `insert into public.guarantee_claims
           (booking_id, customer_id, category_slug, description)
         values ($1, $2, 'plumbing', 'Straight from the browser')`,
        [booking, ANITA],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.end();
  });

  it("lets a customer see the claim but never edit it", async () => {
    const client = await pg.asUser(ANITA);
    const { rowCount } = await client.query(
      "update public.guarantee_claims set description = 'rewritten' where customer_id = $1",
      [ANITA],
    );
    expect(rowCount).toBe(0);
    await client.end();
  });
});

describe("the provider ledger", () => {
  it("is append-only for every caller, service role included", async () => {
    const { rows } = await pg.admin.query(
      `insert into public.provider_ledger (provider_id, kind, amount_rupees, note)
       values ($1, 'redo_debt', 1500, 'Sita attended the redo') returning id`,
      [krishnaProvider],
    );

    await expect(
      pg.admin.query(
        "update public.provider_ledger set amount_rupees = 1 where id = $1",
        [rows[0].id],
      ),
    ).rejects.toThrow(/append-only/i);

    await expect(
      pg.admin.query("delete from public.provider_ledger where id = $1", [
        rows[0].id,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it("nets recovery off the debt and never goes negative", async () => {
    await pg.admin.query(
      `insert into public.provider_ledger (provider_id, kind, amount_rupees)
       values ($1, 'recovery', 400), ($1, 'write_off', 5000)`,
      [krishnaProvider],
    );

    const { rows } = await pg.admin.query(
      "select public.provider_outstanding($1) as owed",
      [krishnaProvider],
    );
    expect(rows[0].owed).toBe(0);
  });

  it("shows a professional their own entries and nobody else's", async () => {
    const client = await pg.asUser(KRISHNA);
    const mine = await client.query(
      "select count(*)::int as n from public.provider_ledger",
    );
    expect(mine.rows[0].n).toBeGreaterThan(0);
    await client.end();

    const other = await pg.asUser(SITA);
    const theirs = await other.query(
      "select count(*)::int as n from public.provider_ledger",
    );
    expect(theirs.rows[0].n).toBe(0);
    await other.end();
  });

  it("is not writable through a browser", async () => {
    const client = await pg.asUser(KRISHNA);
    await expect(
      client.query(
        `insert into public.provider_ledger (provider_id, kind, amount_rupees)
         values ($1, 'recovery', 99999)`,
        [krishnaProvider],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.end();
  });
});
