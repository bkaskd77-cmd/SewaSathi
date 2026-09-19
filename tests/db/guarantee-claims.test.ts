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

/**
 * The visit the guarantee promises, as a real booking.
 *
 * Every one of these was unreachable while `visit_booking_id` was null on
 * every claim — which it was, for every claim, since the table was written.
 */
describe("the return visit is a real booking", () => {
  /*
   * A DAY OF ITS OWN PER BOOKING.
   *
   * Without this every fixture here lands in the same ASAP window and
   * `enforce_slot_capacity` refuses the second one — which is the feature
   * working, and is exactly what this describe block exists to prove, but it
   * makes the fixtures collide with each other rather than with the thing
   * under test. Same pattern `survey-quote.test.ts` uses.
   */
  let day = 0;
  const slot = (): string => {
    day += 1;
    return new Date(Date.UTC(2026, 10, day, 9, 0)).toISOString();
  };

  /** A visit as `createGuaranteeVisit` builds one. */
  async function visitFor(
    claimId: string,
    parentId: string,
    reference: string,
  ): Promise<string> {
    const { rows: parent } = await pg.admin.query(
      `select customer_id, address_id, category_slug, urgency, payment_method,
              quote_model, quoted_min, quoted_max, band_min, band_slug
         from public.bookings where id = $1`,
      [parentId],
    );
    const p = parent[0];
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, status, address_id, category_slug,
          description, urgency, payment_method, quote_model,
          quoted_min, quoted_max, band_min, band_slug,
          guarantee_claim_id, billable, scheduled_for)
       values ($1, $2, $3, 'pending', $4, $5, 'It is dripping again', $6, $7, $8,
               $9, $10, $11, $12, $13, false, $14)
       returning id`,
      [
        reference,
        p.customer_id,
        krishnaProvider,
        p.address_id,
        p.category_slug,
        p.urgency,
        p.payment_method,
        p.quote_model,
        p.quoted_min,
        p.quoted_max,
        p.band_min,
        p.band_slug,
        claimId,
        slot(),
      ],
    );
    const visitId = rows[0].id as string;
    await pg.admin.query(
      "update public.guarantee_claims set visit_booking_id = $1 where id = $2",
      [visitId, claimId],
    );
    return visitId;
  }

  it("carries the parent's band, so the professional's time is worth something", async () => {
    const parent = await completedBooking("SK-VIS01");
    const claim = await openClaim(parent);
    const visit = await visitFor(claim, parent, "SK-VIS02");

    const { rows } = await pg.admin.query(
      "select quoted_min, quoted_max, billable from public.bookings where id = $1",
      [visit],
    );
    // The same 900–4500 the parent froze. Not zero: a zero band would make the
    // visit worth nothing to capacity, duration and the commission floor.
    expect(Number(rows[0].quoted_min)).toBe(900);
    expect(Number(rows[0].quoted_max)).toBe(4500);
    expect(rows[0].billable).toBe(false);
  });

  it("refuses a free booking that is not a guarantee visit", async () => {
    /*
     * The constraint that stops a bug anywhere making an ordinary job free.
     * The two columns are one fact and the database says so.
     */
    await expect(
      pg.admin.query(
        `insert into public.bookings
           (reference, customer_id, provider_id, category_slug, address_id,
            description, quoted_min, quoted_max, billable, scheduled_for)
         values ('SK-VIS03', $1, $2, 'plumbing', $3, 'Free for no reason', 900, 4500, false, $4)`,
        [ANITA, krishnaProvider, anitaAddress, slot()],
      ),
    ).rejects.toThrow(/bookings_free_only_for_guarantee/);
  });

  it("allows only one visit per claim", async () => {
    /*
     * Two professionals tapping accept a second apart is a normal event. The
     * unique column is what makes the second one find the first's visit
     * instead of orphaning a booking that holds a capacity seat.
     */
    const parent = await completedBooking("SK-VIS04");
    const claim = await openClaim(parent);
    const first = await visitFor(claim, parent, "SK-VIS05");

    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, category_slug, address_id,
          description, quoted_min, quoted_max, guarantee_claim_id, billable,
          scheduled_for)
       values ('SK-VIS06', $1, $2, 'plumbing', $3, 'Second visit', 900, 4500, $4, false, $5)
       returning id`,
      [ANITA, krishnaProvider, anitaAddress, claim, slot()],
    );

    await expect(
      pg.admin.query(
        "update public.guarantee_claims set visit_booking_id = $1 where id = $2",
        [rows[0].id, claim],
      ),
    ).rejects.toThrow(/already has a return visit/i);

    const { rows: still } = await pg.admin.query(
      "select visit_booking_id from public.guarantee_claims where id = $1",
      [claim],
    );
    expect(still[0].visit_booking_id).toBe(first);
  });

  it("takes a capacity seat like any other job", async () => {
    /*
     * THE REASON THIS EXISTS AT ALL. While the visit was only a claim row it
     * consumed none of the professional's day — no seat here, nothing against
     * crew_count — so somebody could be sent back to a job the scheduler
     * believed they were free for.
     */
    const parent = await completedBooking("SK-VIS07");
    const claim = await openClaim(parent);
    const visit = await visitFor(claim, parent, "SK-VIS08");

    const { rows } = await pg.admin.query(
      `select count(*)::int as held
         from public.bookings
        where provider_id = $1
          and status in ('pending', 'accepted', 'en_route', 'in_progress')`,
      [krishnaProvider],
    );
    expect(rows[0].held).toBeGreaterThan(0);

    const { rows: mine } = await pg.admin.query(
      "select guarantee_claim_id from public.bookings where id = $1",
      [visit],
    );
    expect(mine[0].guarantee_claim_id).toBe(claim);
  });

  it("drops its visit when the professional hands the claim back", async () => {
    /*
     * The one legitimate value->null, and the reason the repoint guard cannot
     * simply be "never changes once set". `enforce_claim_transition` clears
     * the link on a move back to `open`, because a released claim gets a new
     * visit when somebody else accepts.
     */
    const parent = await completedBooking("SK-VIS10");
    const claim = await openClaim(parent);
    await visitFor(claim, parent, "SK-VIS11");

    await pg.admin.query(
      "update public.guarantee_claims set status = 'dispatched', attending_provider_id = $1 where id = $2",
      [krishnaProvider, claim],
    );
    await pg.admin.query(
      "update public.guarantee_claims set status = 'open' where id = $1",
      [claim],
    );

    const { rows } = await pg.admin.query(
      "select visit_booking_id, attending_provider_id from public.guarantee_claims where id = $1",
      [claim],
    );
    expect(rows[0].visit_booking_id).toBeNull();
    expect(rows[0].attending_provider_id).toBeNull();
  });

  it("leaves no visit holding a seat once the claim is handed back", async () => {
    /*
     * THE ORPHAN. The trigger clears the link, so without `cancelOrphanedVisit`
     * the booking it pointed at stays `accepted` for ever: unreachable from the
     * claim, invisible to the customer, and still consuming one of the
     * professional's capacity seats on that day.
     *
     * Asserted as the state `releaseClaim` leaves behind, since the cancel
     * itself is TypeScript — a trigger writing `bookings` from
     * `guarantee_claims` would re-enter that table's triggers, which is the
     * recursion this schema already has `is_admin()` to break.
     */
    const parent = await completedBooking("SK-VIS12");
    const claim = await openClaim(parent);
    const visit = await visitFor(claim, parent, "SK-VIS13");

    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [visit],
    );
    await pg.admin.query(
      "update public.guarantee_claims set status = 'dispatched', attending_provider_id = $1 where id = $2",
      [krishnaProvider, claim],
    );

    // What releaseClaim does: read the link, move the claim, cancel the visit.
    await pg.admin.query(
      "update public.guarantee_claims set status = 'open' where id = $1",
      [claim],
    );
    await pg.admin.query(
      `update public.bookings
          set status = 'cancelled', cancelled_at = now(), cancelled_by_role = 'system'
        where id = $1 and status in ('pending', 'accepted', 'en_route')`,
      [visit],
    );

    const { rows } = await pg.admin.query(
      "select status from public.bookings where id = $1",
      [visit],
    );
    expect(rows[0].status).toBe("cancelled");

    const { rows: held } = await pg.admin.query(
      `select count(*)::int as n from public.bookings
        where id = $1 and status in ('pending','accepted','en_route','in_progress')`,
      [visit],
    );
    expect(held[0].n).toBe(0);
  });

  /*
   * THE GATE. Diagnosis is free; the charge for a different problem is agreed
   * BEFORE remedial work, never sprung at the door and never applied
   * afterwards.
   */
  describe("who pays, and when it stops being changeable", () => {
    async function visitWithProposal(tag: string) {
      const parent = await completedBooking(`SK-G${tag}A`);
      const claim = await openClaim(parent);
      const visit = await visitFor(claim, parent, `SK-G${tag}B`);
      await pg.admin.query(
        `update public.bookings
            set provider_band_slug = 'blockage',
                provider_band_reason = 'The old joint is fine; a different pipe has split',
                provider_band_at = now()
          where id = $1`,
        [visit],
      );
      return { claim, visit };
    }

    it("refuses to charge before the customer has agreed", async () => {
      const { visit } = await visitWithProposal("01");
      await expect(
        pg.admin.query(
          "update public.bookings set billable = true where id = $1",
          [visit],
        ),
      ).rejects.toThrow(/once the customer has agreed/i);
    });

    it("charges once they have", async () => {
      const { visit } = await visitWithProposal("02");
      await pg.admin.query(
        `update public.bookings
            set band_change_approved_at = now(), billable = true
          where id = $1`,
        [visit],
      );
      const { rows } = await pg.admin.query(
        "select billable from public.bookings where id = $1",
        [visit],
      );
      expect(rows[0].billable).toBe(true);
    });

    it("will not let work start while the question is open", async () => {
      /*
       * `enforce_price_correction`, unchanged and with no service-role bypass.
       * On a visit booking its last clause means exactly this.
       */
      const { visit } = await visitWithProposal("03");
      for (const status of ["accepted", "en_route"]) {
        await pg.admin.query(
          "update public.bookings set status = $1 where id = $2",
          [status, visit],
        );
      }
      await expect(
        pg.admin.query(
          "update public.bookings set status = 'in_progress' where id = $1",
          [visit],
        ),
      ).rejects.toThrow(/has not answered the corrected price/i);
    });

    it("freezes who pays once work has begun", async () => {
      /*
       * `started_at` is stamped by the status trigger, so the line is a
       * recorded moment rather than an argument afterwards. This is what stops
       * the charge arriving at settlement.
       */
      const { visit } = await visitWithProposal("04");
      await pg.admin.query(
        `update public.bookings
            set band_change_declined_at = now() where id = $1`,
        [visit],
      );
      for (const status of ["accepted", "en_route", "in_progress"]) {
        await pg.admin.query(
          "update public.bookings set status = $1 where id = $2",
          [status, visit],
        );
      }

      await expect(
        pg.admin.query(
          `update public.bookings
              set band_change_approved_at = now(), billable = true
            where id = $1`,
          [visit],
        ),
      ).rejects.toThrow(/work has already started/i);
    });

    it("never turns a chargeable visit free again", async () => {
      const { visit } = await visitWithProposal("05");
      await pg.admin.query(
        `update public.bookings
            set band_change_approved_at = now(), billable = true
          where id = $1`,
        [visit],
      );
      await expect(
        pg.admin.query(
          "update public.bookings set billable = false where id = $1",
          [visit],
        ),
      ).rejects.toThrow(/cannot be made free again/i);
    });

    it("leaves ordinary bookings entirely alone", async () => {
      // The function returns early on a null guarantee_claim_id. A guard that
      // reached ordinary jobs would refuse every settlement in the product.
      const parent = await completedBooking("SK-G06A");
      const { rows } = await pg.admin.query(
        "select billable, guarantee_claim_id from public.bookings where id = $1",
        [parent],
      );
      expect(rows[0].billable).toBe(true);
      expect(rows[0].guarantee_claim_id).toBeNull();
    });
  });

  it("is not free-able from a browser", async () => {
    /*
     * Both directions are real: a customer who could clear `billable` has a
     * free job for the asking, a professional who could set it bills for a
     * redo of their own defect.
     *
     * AGAINST A LIVE BOOKING, AND THE FIRST VERSION OF THIS TEST WAS WORTHLESS
     * BECAUSE IT WAS NOT. It ran against a `completed` booking, which no
     * customer update policy covers — so the statement matched zero rows and
     * "succeeded" without the trigger ever being reached. A test that cannot
     * fail is worse than no test, because it reads as coverage.
     */
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, category_slug, address_id,
          description, quoted_min, quoted_max, scheduled_for)
       values ('SK-VIS09', $1, $2, 'plumbing', $3, 'Tap drips', 900, 4500, $4)
       returning id`,
      [ANITA, krishnaProvider, anitaAddress, slot()],
    );

    const anita = await pg.asUser(ANITA);
    await expect(
      anita.query(
        "update public.bookings set billable = false where id = $1",
        [rows[0].id],
      ),
    ).rejects.toThrow(/Who pays for a return visit/i);
    await anita.end();
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
