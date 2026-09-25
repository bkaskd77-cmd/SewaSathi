import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { refundCeiling } from "@/lib/payments/refund";
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
  /**
   * A finished job somebody actually paid for.
   *
   * `completedBooking` leaves `payment_status` unpaid with no final amount,
   * which is the right default for most of this file — but a refund has to
   * come out of money that was collected, so every case below needs one of
   * these instead.
   */
  async function settledBooking(
    reference: string,
    amount = 3000,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const id = await completedBooking(reference);
    const sets = Object.keys(over)
      .map((k, i) => `${k} = $${i + 3}`)
      .join(", ");
    await pg.admin.query(
      `update public.bookings
          set payment_status = 'paid', final_amount = $2,
              completed_at = now()${sets ? ", " + sets : ""}
        where id = $1`,
      [id, amount, ...Object.values(over)],
    );
    return id;
  }

  it("refuses a refund nobody signed, service role included", async () => {
    /*
     * THE ANTI-FARMING DESIGN IN ONE CONSTRAINT, and the reason
     * `enforce_claim_refund` returns early on an unsigned refund rather than
     * refusing it first: this sentence describes what is actually wrong, and
     * it would otherwise be preempted by a complaint about the booking.
     */
    const claim = await openClaim(await settledBooking("SK-CLAIM8"));

    await expect(
      pg.admin.query(
        "update public.guarantee_claims set refund_rupees = 2000 where id = $1",
        [claim],
      ),
    ).rejects.toThrow(/decided by somebody/i);
  });

  it("allows one an admin decided", async () => {
    const claim = await openClaim(await settledBooking("SK-CLAIM9"));

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

  /*
   * THE FOUR THINGS NO PERSON MAY DECIDE. A refund is the only part of the
   * guarantee that moves real money, so these are in the database rather than
   * only in `lib/payments/refund.ts` — no service-role bypass, because none
   * of them has a legitimate case.
   */
  const pay = (claim: string, amount: number) =>
    pg.admin.query(
      `update public.guarantee_claims
          set refund_rupees = $2, refund_decided_by = $3 where id = $1`,
      [claim, amount, ADMIN],
    );

  it("never pays twice on one claim", async () => {
    const claim = await openClaim(await settledBooking("SK-REF01"));
    await pay(claim, 1000);

    // A second figure, and an edit of the first, are the same event.
    await expect(pay(claim, 500)).rejects.toThrow(/already been refunded/i);
    await expect(pay(claim, 2000)).rejects.toThrow(/already been refunded/i);
  });

  it("never pays more than was collected", async () => {
    const claim = await openClaim(await settledBooking("SK-REF02", 3000));
    await expect(pay(claim, 3001)).rejects.toThrow(/more than the amount recorded/i);
    // And the ceiling itself is payable — full labour is a real rung.
    await pay(claim, 3000);
  });

  it("covers the settled figure once a person has adjudicated, not the customer's typed one", async () => {
    /*
     * THE RULE REVERSED, DELIBERATELY. This test used to assert the lower of
     * the two figures, because the cash screen's "up to the amount you enter"
     * was read as a ceiling. It is a FLOOR now, and the confirmation screen
     * says so in both languages: somebody who really paid 3,000 and mistyped
     * 1,800 should not be covered for their own slip once a person has
     * established what was actually handed over.
     *
     * WHAT STOPS SOMEBODY NAMING A FIGURE AND BEING REFUNDED IT — the concern
     * the old rule existed for, and it is answered by WHERE the number comes
     * from rather than by which is smaller. A customer's typed amount lands in
     * `customer_reported_amount`, which is evidence and is not the cap. It
     * only becomes `final_amount` when an admin adjudicates, and a browser
     * cannot write `final_amount`, the resolution stamp, or who resolved it —
     * `tests/db/booking-rls.test.ts` pins all four against the trigger.
     */
    const claim = await openClaim(
      await settledBooking("SK-REF03", 3000, {
        customer_reported_amount: 1800,
        amount_mismatch_at: new Date(),
        amount_mismatch_resolved_at: new Date(),
        amount_settled_source: "adjudicated",
        amount_mismatch_note: "both wrong; 3,000 agreed on the phone",
      }),
    );

    await expect(pay(claim, 3001)).rejects.toThrow(/more than the amount recorded/i);
    // Above what the customer typed, up to what was settled.
    await pay(claim, 2500);
  });

  /*
   * THE TWO HALVES OF ONE RULE, ON ONE FIXTURE.
   *
   * `refundCeiling` in TypeScript and `enforce_claim_refund` in Postgres both
   * decide the most a booking can pay back, and they disagreed: the migration
   * that let a person settle a disputed amount changed the trigger to cap at
   * `final_amount` and left the TypeScript capping at the lower of two figures.
   * The screen showed the adjudicator one number and the database would have
   * taken a larger one. Neither side's own tests caught it, because the missing
   * thing was never either half — it was the comparison.
   *
   * `tests/unit/refund-ceiling.test.ts` asserts the same numbers in TypeScript.
   * Change one without the other and one of the two goes red.
   */
  it("agrees with refundCeiling on a settled disagreement", async () => {
    const claim = await openClaim(
      await settledBooking("SK-REF07", 3000, {
        customer_reported_amount: 1800,
        amount_mismatch_at: new Date(),
        amount_mismatch_resolved_at: new Date(),
        amount_settled_source: "adjudicated",
      }),
    );

    // The settled figure, not the 1,800 the customer originally typed.
    await expect(pay(claim, 3001)).rejects.toThrow(/more than the amount recorded/i);
    await pay(claim, 3000);
  });

  /* ---------------------------------------------------------------- *
   * The parts are not the labour
   * ---------------------------------------------------------------- */

  /**
   * THE SAME FIXTURE, JUDGED BY BOTH HALVES OF THE RULE.
   *
   * `enforce_claim_refund` and `refundCeiling` are two implementations of one
   * money rule, and the last time that was true they diverged — silently, for
   * weeks, with both halves green, because nothing ever put them side by side.
   * So every case below states a ceiling in SQL and asserts `refundCeiling`
   * reaches the same number on the same inputs. Change one and this goes red.
   */
  async function agreesWithTypeScript(
    bookingId: string,
    claimId: string,
    partsFailed: boolean | null,
  ): Promise<number> {
    if (partsFailed !== null) {
      await pg.admin.query(
        "update public.guarantee_claims set parts_failed = $2 where id = $1",
        [claimId, partsFailed],
      );
    }
    const { rows } = await pg.admin.query(
      `select payment_status, final_amount, customer_reported_amount,
              amount_mismatch_at, amount_mismatch_resolved_at, materials_rupees
         from public.bookings where id = $1`,
      [bookingId],
    );
    const b = rows[0];
    const verdict = refundCeiling({
      finalAmount: Number(b.final_amount),
      customerReportedAmount:
        b.customer_reported_amount == null
          ? null
          : Number(b.customer_reported_amount),
      amountMismatchAt: b.amount_mismatch_at ?? null,
      amountMismatchResolvedAt: b.amount_mismatch_resolved_at ?? null,
      paymentStatus: b.payment_status as string,
      materialsRupees:
        b.materials_rupees == null ? null : Number(b.materials_rupees),
      partsFailed,
    });
    if (!verdict.ok) throw new Error(`refundCeiling refused: ${verdict.reason}`);
    return verdict.ceiling;
  }

  it("takes the parts off when the attending professional says they were sound", async () => {
    const booking = await settledBooking("SK-MAT01", 6000, {
      materials_rupees: 2000,
    });
    const claim = await openClaim(booking);
    const ceiling = await agreesWithTypeScript(booking, claim, false);

    expect(ceiling).toBe(4000);
    // A rupee over what TypeScript showed the adjudicator is refused here too.
    await expect(pay(claim, ceiling + 1)).rejects.toThrow(
      /more than the amount recorded/i,
    );
    await pay(claim, ceiling);
  });

  it("leaves the whole figure when the parts themselves failed", async () => {
    // Deducting them would refuse to pay back the one thing that went wrong.
    const booking = await settledBooking("SK-MAT02", 6000, {
      materials_rupees: 2000,
    });
    const claim = await openClaim(booking);
    const ceiling = await agreesWithTypeScript(booking, claim, true);

    expect(ceiling).toBe(6000);
    await expect(pay(claim, 6001)).rejects.toThrow(
      /more than the amount recorded/i,
    );
    await pay(claim, 6000);
  });

  /**
   * RULE 6, IN THE DATABASE. `is false` is a positive test, so a claim from
   * before the question existed — `parts_failed` null — keeps the whole
   * settled figure. An unanswered question must not quietly cost a customer
   * the price of the parts, and `= false` would have done exactly that.
   */
  it("deducts nothing when nobody recorded whether the parts failed", async () => {
    const booking = await settledBooking("SK-MAT03", 6000, {
      materials_rupees: 2000,
    });
    const claim = await openClaim(booking);
    const ceiling = await agreesWithTypeScript(booking, claim, null);

    expect(ceiling).toBe(6000);
    await pay(claim, 6000);
  });

  /**
   * THE ANTI-INFLATION GATE, AND THE ROUNDING THAT HAS TO MATCH.
   *
   * `(final_amount * 5000) / 10000` truncates on integers; `Math.floor` does
   * the same in TypeScript. An odd settled figure is the case where a
   * disagreement would show up as exactly one rupee, which is small enough to
   * survive a long time unnoticed — so the fixture is deliberately odd.
   */
  it("never lets a parts line take more than half, rounding the same way", async () => {
    const booking = await settledBooking("SK-MAT04", 4001, {
      materials_rupees: 4000,
    });
    const claim = await openClaim(booking);
    const ceiling = await agreesWithTypeScript(booking, claim, false);

    expect(ceiling).toBe(2001);
    await expect(pay(claim, 2002)).rejects.toThrow(
      /more than the amount recorded/i,
    );
    await pay(claim, 2001);
  });

  /**
   * A parts line above the bill is an entry error every time — it would drive
   * the ceiling below zero. `recordFinalAmount` says which figure is wrong;
   * this is the floor under it.
   */
  it("refuses a parts figure larger than the job", async () => {
    const id = await completedBooking("SK-MAT05");
    await expect(
      pg.admin.query(
        `update public.bookings
            set payment_status = 'paid', final_amount = 3000,
                materials_rupees = 3001, completed_at = now()
          where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/bookings_materials_within_amount/i);
  });

  it("never pays out of a job nobody settled", async () => {
    const claim = await openClaim(await completedBooking("SK-REF04"));
    await expect(pay(claim, 500)).rejects.toThrow(/has not been settled/i);
  });

  it("never pays while the two figures are in dispute", async () => {
    /*
     * A standing mismatch means a person is already deciding which number is
     * true. Refunding against either picks a side silently, in whichever
     * direction happened to be written down.
     */
    const claim = await openClaim(
      await settledBooking("SK-REF05", 3000, { amount_mismatch_at: new Date() }),
    );
    await expect(pay(claim, 1000)).rejects.toThrow(/still in dispute/i);
  });

  it("never pays after the trade's window has closed", async () => {
    /*
     * `claimIsAllowed` checked the window when the claim was filed. A refund
     * is decided later, sometimes much later, and a claim that sat open past
     * its window must not become payable by waiting.
     */
    const id = await settledBooking("SK-REF06");
    await pg.admin.query(
      "update public.bookings set completed_at = now() - interval '40 days' where id = $1",
      [id],
    );
    const claim = await openClaim(id);
    await expect(pay(claim, 1000)).rejects.toThrow(/window has closed/i);
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

/**
 * Approved and sent are two states of a refund, and the database says so.
 *
 * WHY THIS IS WORTH A DATABASE TEST. Two of our three rails cannot move money
 * from inside this product — eSewa has no merchant-initiated refund on ePay v2
 * and cash comes back the way it went out — so a person leaves, sends it, and
 * comes back to record that they did. `refunds_processed_shape` is what makes
 * "recorded as sent" and "actually has a date it went" the same fact; without
 * it, `status = 'completed'` would be a word anybody could write.
 *
 * And a customer must be able to read their own, or the whole two-step is
 * invisible to the person waiting on it.
 */
describe("a refund that has been agreed but not yet sent", () => {
  async function settledPayment(reference: string): Promise<string> {
    const bookingId = await completedBooking(reference);
    await pg.admin.query(
      `update public.bookings
          set payment_status = 'paid', final_amount = 3000, completed_at = now()
        where id = $1`,
      [bookingId],
    );
    // A payment starts `pending` and is walked to `paid`, because
    // `payment_transition_allowed` refuses a row born settled — the same
    // machine the product uses, rather than a shortcut this test invents.
    const { rows } = await pg.admin.query(
      `insert into public.payments
         (booking_id, method, amount, our_reference)
       values ($1, 'cash', 3000, $2)
       returning id`,
      [bookingId, `${reference}-PAY`],
    );
    await pg.admin.query(
      "update public.payments set status = 'paid', settled_at = now() where id = $1",
      [rows[0].id],
    );
    return rows[0].id as string;
  }

  it("is born at 'requested' with nothing recorded as sent", async () => {
    const payment = await settledPayment("SK-REF1");
    const { rows } = await pg.admin.query(
      `insert into public.refunds (payment_id, amount, reason, requested_by_role)
       values ($1, 2000, 'Same fault after a redo', 'admin')
       returning status, processed_at`,
      [payment],
    );
    expect(rows[0].status).toBe("requested");
    expect(rows[0].processed_at).toBeNull();
  });

  it("refuses 'completed' with no date it actually went", async () => {
    const payment = await settledPayment("SK-REF2");
    await expect(
      pg.admin.query(
        `insert into public.refunds
           (payment_id, amount, reason, requested_by_role, status)
         values ($1, 2000, 'Same fault after a redo', 'admin', 'completed')`,
        [payment],
      ),
    ).rejects.toThrow(/refunds_processed_shape/i);
  });

  it("refuses a date on one nobody has sent", async () => {
    // The mirror, and the one that matters more: a timestamp on a `requested`
    // row would make "when did this go?" answerable about money still sitting
    // in our account.
    const payment = await settledPayment("SK-REF3");
    await expect(
      pg.admin.query(
        `insert into public.refunds
           (payment_id, amount, reason, requested_by_role, processed_at)
         values ($1, 2000, 'Same fault after a redo', 'admin', now())`,
        [payment],
      ),
    ).rejects.toThrow(/refunds_processed_shape/i);
  });

  it("takes the completion once both halves are there", async () => {
    const payment = await settledPayment("SK-REF4");
    const { rows } = await pg.admin.query(
      `insert into public.refunds (payment_id, amount, reason, requested_by_role)
       values ($1, 2000, 'Same fault after a redo', 'admin')
       returning id`,
      [payment],
    );

    await pg.admin.query(
      `update public.refunds
          set status = 'completed', processed_at = now(), provider_txn_id = $2
        where id = $1 and status = 'requested'`,
      [rows[0].id, "ESW-9912"],
    );

    const after = await pg.admin.query(
      "select status, provider_txn_id from public.refunds where id = $1",
      [rows[0].id],
    );
    expect(after.rows[0].status).toBe("completed");
    // The reference is the point: it is what answers somebody who says the
    // money never arrived, rather than arguing with them.
    expect(after.rows[0].provider_txn_id).toBe("ESW-9912");
  });

  it("is readable by the customer it belongs to and nobody else", async () => {
    const payment = await settledPayment("SK-REF5");
    await pg.admin.query(
      `insert into public.refunds (payment_id, amount, reason, requested_by_role)
       values ($1, 2000, 'Same fault after a redo', 'admin')`,
      [payment],
    );

    const anita = await pg.asUser(ANITA);
    const mine = await anita.query(
      "select count(*)::int as n from public.refunds",
    );
    expect(mine.rows[0].n).toBeGreaterThan(0);
    await anita.end();

    const stranger = await pg.asUser(STRANGER);
    const theirs = await stranger.query(
      "select count(*)::int as n from public.refunds",
    );
    expect(theirs.rows[0].n).toBe(0);
    await stranger.end();
  });

  it("is not writable through a browser, by anybody", async () => {
    // RLS grants no insert or update on `refunds` to any role. Every write
    // goes through `lib/data/claims.ts` under the service role, which re-reads
    // the claim rather than believing what it was handed.
    const payment = await settledPayment("SK-REF6");
    const anita = await pg.asUser(ANITA);
    await expect(
      anita.query(
        `insert into public.refunds (payment_id, amount, reason)
         values ($1, 99999, 'I would like my money back please')`,
        [payment],
      ),
    ).rejects.toThrow(/row-level security/i);
    await anita.end();
  });
});
