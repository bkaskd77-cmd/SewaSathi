import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * Moving a published band, against the real triggers.
 *
 * THE ONE RULE WORTH THE WHOLE FILE: approving a band cannot reach a quote that
 * already exists. Every screen says so, `/providers/standards` implies it, and the
 * thing that actually makes it true is `freeze_booking_band()` — so it is checked
 * here against a database rather than trusted to a sentence in a comment. If it
 * were ever false, a customer's agreed ceiling would move after they agreed it and
 * our commission basis would move with it.
 *
 * THE SECOND IS THAT THE HISTORY CANNOT BE EDITED. `category_price_revisions` is
 * the record of who moved a price and why; a record the application can rewrite
 * proves nothing, which is why `refuse_rewrite()` is on it and why the refusal is
 * asserted as the service role rather than as a browser. The service role is the
 * caller that could otherwise tidy up.
 */

const ADMIN = "cccccccc-9333-4333-8333-cccccccccccc";
const ANITA = "aaaaaaaa-9111-4111-8111-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-9222-4222-8222-bbbbbbbbbbbb";

let pg: Harness;
let anitaAddress: string;
let krishnaProvider: string;

/**
 * A booking quoted under whatever band is published at the moment it is made.
 *
 * EACH ONE GETS ITS OWN SLOT. `enforce_slot_capacity` refuses a second booking for
 * the same professional at the same time, which is correct and has nothing to do
 * with bands — the first version of this fixture left `scheduled_for` null on all
 * of them and three cases failed with "already booked for this time". Worth the
 * comment because the error names a product rule and reads like a real finding.
 */
let slot = 0;

async function quote(reference: string): Promise<{
  id: string;
  bandMin: number | null;
  quotedMax: number;
  revision: string | null;
}> {
  slot += 1;
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max, scheduled_for)
     values ($1, $2, $3, 'plumbing', $4, 'Kitchen tap drips', 900, 4500,
             now() + ($5 || ' days')::interval)
     returning id, band_min, quoted_max, band_revision_id`,
    [reference, ANITA, krishnaProvider, anitaAddress, String(slot)],
  );
  return {
    id: rows[0].id as string,
    bandMin: rows[0].band_min as number | null,
    quotedMax: rows[0].quoted_max as number,
    revision: rows[0].band_revision_id as string | null,
  };
}

/** An approval, written the way `approveBand` writes it. */
async function approve(low: number, high: number): Promise<string> {
  const { rows: before } = await pg.admin.query(
    "select base_price_min, base_price_max from public.categories where slug = 'plumbing'",
  );

  const { rows } = await pg.admin.query(
    `insert into public.category_price_revisions
       (category_slug, decision, old_min, old_max, new_min, new_max,
        proposed_min, proposed_max, sample, winsorised, capped, actor_id, reason)
     values ('plumbing', 'approved', $1, $2, $3, $4, $3, $4, 42, 2, false, $5,
             'Our own settled jobs say so')
     returning id`,
    [before[0].base_price_min, before[0].base_price_max, low, high, ADMIN],
  );

  await pg.admin.query(
    `update public.categories
        set base_price_min = $1, base_price_max = $2,
            pricing_source = 'observed', pricing_checked_at = current_date
      where slug = 'plumbing'`,
    [low, high],
  );

  return rows[0].id as string;
}

/** A stated band, written the way `stateBand` writes it: no proposal columns. */
async function state(low: number, high: number): Promise<string> {
  const { rows: before } = await pg.admin.query(
    "select base_price_min, base_price_max from public.categories where slug = 'plumbing'",
  );

  const { rows } = await pg.admin.query(
    `insert into public.category_price_revisions
       (category_slug, decision, source, old_min, old_max, new_min, new_max,
        actor_id, reason)
     values ('plumbing', 'approved', 'stated', $1, $2, $3, $4, $5,
             'We had this trade mispriced at both ends')
     returning id`,
    [before[0].base_price_min, before[0].base_price_max, low, high, ADMIN],
  );

  /* No `pricing_source` write, which is the stated path's own rule: `observed`
     would claim the figure came out of our settled jobs. */
  await pg.admin.query(
    `update public.categories
        set base_price_min = $1, base_price_max = $2, pricing_checked_at = current_date
      where slug = 'plumbing'`,
    [low, high],
  );

  return rows[0].id as string;
}

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
    [ADMIN, "Admin", "admin"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779813${id.slice(0, 6)}`, role],
    );
  }

  const { rows: providerRows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, 'Krishna Tamang', 900) returning id`,
    [KRISHNA],
  );
  krishnaProvider = providerRows[0].id as string;

  const { rows: addressRows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  anitaAddress = addressRows[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("a band change is forward only", () => {
  /*
   * THE ASSERTION IS ABOUT THE OLD BOOKING, NOT ABOUT THE FUNCTION. Reading
   * `freeze_booking_band`'s source and finding `new.band_min := old.band_min`
   * would prove the text and not the behaviour — and the behaviour is what a
   * customer is owed. So: quote, move the band a long way, and look at the row
   * again.
   */
  it("leaves an existing quote's floor, ceiling and revision untouched", async () => {
    const before = await quote("SK-BAND1");
    await approve(2500, 9000);

    const { rows } = await pg.admin.query(
      "select band_min, quoted_max, band_revision_id from public.bookings where id = $1",
      [before.id],
    );

    expect(rows[0].band_min).toBe(before.bandMin);
    expect(rows[0].quoted_max).toBe(before.quotedMax);
    expect(rows[0].band_revision_id).toBe(before.revision);
  });

  /*
   * And the other half, which is what makes the first half meaningful: the NEW
   * band does reach a new booking. A test that only pinned the old row would pass
   * just as well against a band editor that changed nothing at all.
   */
  it("reaches the next booking, and names the decision behind it", async () => {
    const revision = await approve(1200, 7000);
    const after = await quote("SK-BAND2");

    expect(after.bandMin).toBe(1200);
    expect(after.revision).toBe(revision);
  });

  /*
   * RULE 6, AND IT IS THE COMMON CASE RATHER THAN AN EDGE. Every band published
   * today came from the launch research, so a booking in a category nobody has
   * revised carries null — "no revision on record", never "unknown" and never
   * backfilled into something that looks like a decision somebody took.
   */
  it("carries no revision for a category nobody has revised", async () => {
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, provider_id, category_slug, address_id,
          description, quoted_min, quoted_max, scheduled_for)
       values ('SK-BAND3', $1, $2, 'carpentry', $3, 'Door hinge', 600, 3000,
               now() + interval '40 days')
       returning band_revision_id, band_min`,
      [ANITA, krishnaProvider, anitaAddress],
    );

    expect(rows[0].band_revision_id).toBeNull();
    // The floor is still frozen: the two facts are independent.
    expect(rows[0].band_min).not.toBeNull();
  });

  /*
   * The revision is pinned on update like the floor beside it. An ordinary status
   * write must not be able to re-date which band a booking was quoted under —
   * that is how a report comes to describe a decision made after the job.
   */
  it("pins the revision through an ordinary status write", async () => {
    const booking = await quote("SK-BAND4");
    const newer = await approve(1400, 7500);
    expect(newer).not.toBe(booking.revision);

    await pg.admin.query(
      "update public.bookings set band_revision_id = $1, status = 'accepted' where id = $2",
      [newer, booking.id],
    );

    const { rows } = await pg.admin.query(
      "select band_revision_id from public.bookings where id = $1",
      [booking.id],
    );
    expect(rows[0].band_revision_id).toBe(booking.revision);
  });
});

describe("the history cannot be rewritten", () => {
  it("refuses an update, for the service role too", async () => {
    const revision = await approve(1500, 7600);

    await expect(
      pg.admin.query(
        "update public.category_price_revisions set reason = 'something else' where id = $1",
        [revision],
      ),
    ).rejects.toThrow();
  });

  it("refuses a delete", async () => {
    const revision = await approve(1600, 7700);

    await expect(
      pg.admin.query("delete from public.category_price_revisions where id = $1", [
        revision,
      ]),
    ).rejects.toThrow();
  });

  /*
   * A reason is the part a future reader has, so a blank one is refused by the
   * database rather than only by the form. The form can be bypassed; this cannot.
   */
  it("refuses a blank reason", async () => {
    await expect(
      pg.admin.query(
        `insert into public.category_price_revisions
           (category_slug, decision, old_min, old_max, new_min, new_max,
            proposed_min, proposed_max, sample, winsorised, capped, actor_id, reason)
         values ('plumbing', 'rejected', 900, 4500, 900, 4500, 1000, 3400, 40, 1,
                 false, $1, '   ')`,
        [ADMIN],
      ),
    ).rejects.toThrow();
  });
});

describe("who may read it", () => {
  /*
   * A browser may ask at all only because the migration grants SELECT; which rows
   * come back is the policy's job. Both halves are asserted, because the grant and
   * the policy fail differently and a missing grant answers `permission denied`
   * however correct the policy is — the trap `20261002000001` created.
   */
  it("lets an admin read and a customer read nothing", async () => {
    await approve(1700, 7800);

    const admin = await pg.asUser(ADMIN);
    const asAdmin = await admin.query(
      "select count(*)::int as n from public.category_price_revisions",
    );
    expect(asAdmin.rows[0].n).toBeGreaterThan(0);

    const customer = await pg.asUser(ANITA);
    const asCustomer = await customer.query(
      "select count(*)::int as n from public.category_price_revisions",
    );
    expect(asCustomer.rows[0].n).toBe(0);
  });
});

describe("a band a person states, with no sample behind it", () => {
  /*
   * THE RULE THAT MATTERS IS THE SAME RULE, AND IT IS ASSERTED RATHER THAN
   * INHERITED. `freeze_booking_band()` keys on the booking and knows nothing about
   * who moved the band, so the forward-only guarantee ought to hold here too —
   * but "ought to" is what a comment says. A stated band is the one that can move
   * a price a long way in one action, so it is the one where a leak would cost the
   * most, and the computed path's green case says nothing about it.
   */
  it("leaves an existing quote alone, exactly as an approval does", async () => {
    const before = await quote("SK-BANDS1");
    await state(3000, 11_000);

    const { rows } = await pg.admin.query(
      "select band_min, quoted_max, band_revision_id from public.bookings where id = $1",
      [before.id],
    );

    expect(rows[0].band_min).toBe(before.bandMin);
    expect(rows[0].quoted_max).toBe(before.quotedMax);
    expect(rows[0].band_revision_id).toBe(before.revision);
  });

  it("reaches the next booking, and names the stated decision behind it", async () => {
    const revision = await state(2000, 9500);
    const after = await quote("SK-BANDS2");

    expect(after.bandMin).toBe(2000);
    expect(after.revision).toBe(revision);

    /* And the row it points at says there was no proposal — which is the whole
       reason a dispute can tell the two kinds of decision apart. */
    const { rows } = await pg.admin.query(
      `select source, proposed_min, proposed_max, sample, winsorised, capped
         from public.category_price_revisions where id = $1`,
      [revision],
    );
    expect(rows[0].source).toBe("stated");
    expect(rows[0].proposed_min).toBeNull();
    expect(rows[0].proposed_max).toBeNull();
    expect(rows[0].sample).toBeNull();
    expect(rows[0].winsorised).toBeNull();
    expect(rows[0].capped).toBeNull();
  });

  /*
   * THE DEFAULT KEEPS THE TWO EXISTING WRITERS HONEST WITHOUT TOUCHING THEM.
   * `approveBand` and `rejectBand` name no `source`, so a row they write has to
   * land as `proposal` — if the default were `stated` the shape constraint would
   * refuse every approval, and if there were no default at all the column would be
   * null and mean nothing.
   */
  it("calls a row nobody labelled a proposal", async () => {
    const revision = await approve(1800, 8000);

    const { rows } = await pg.admin.query(
      "select source from public.category_price_revisions where id = $1",
      [revision],
    );
    expect(rows[0].source).toBe("proposal");
  });

  /*
   * RULE 6 IN SQL, AND THE FOUR SHAPES THAT MUST NOT BE WRITABLE. This table is
   * what a disputed price is argued from: a stated row carrying a sample claims
   * data was consulted when it was not, and a proposal row without one is a
   * decision nobody can audit afterwards. A CHECK constraint passes on null, so
   * dropping the NOT NULLs is exactly when these have to be asserted.
   */
  it("refuses a stated row that claims a sample", async () => {
    await expect(
      pg.admin.query(
        `insert into public.category_price_revisions
           (category_slug, decision, source, old_min, old_max, new_min, new_max,
            proposed_min, proposed_max, sample, winsorised, capped, actor_id, reason)
         values ('plumbing', 'approved', 'stated', 900, 4500, 1500, 6000,
                 1500, 6000, 30, 0, false, $1, 'a sample that was not taken')`,
        [ADMIN],
      ),
    ).rejects.toThrow();
  });

  it("refuses a proposal row with no sample behind it", async () => {
    await expect(
      pg.admin.query(
        `insert into public.category_price_revisions
           (category_slug, decision, source, old_min, old_max, new_min, new_max,
            actor_id, reason)
         values ('plumbing', 'approved', 'proposal', 900, 4500, 1500, 6000,
                 $1, 'a proposal nobody computed')`,
        [ADMIN],
      ),
    ).rejects.toThrow();
  });

  /*
   * A rejection is a verdict on somebody else's proposal, so there is nothing to
   * reject about a band a person is stating — they state a different one. Without
   * this clause a `stated` row could carry `rejected` with `new_* = old_*`, which
   * reads in the history as a decision that was taken and reversed.
   */
  it("refuses a stated rejection", async () => {
    await expect(
      pg.admin.query(
        `insert into public.category_price_revisions
           (category_slug, decision, source, old_min, old_max, new_min, new_max,
            actor_id, reason)
         values ('plumbing', 'rejected', 'stated', 900, 4500, 900, 4500,
                 $1, 'rejecting a band nobody proposed')`,
        [ADMIN],
      ),
    ).rejects.toThrow();
  });

  it("refuses a source nobody declared", async () => {
    await expect(
      pg.admin.query(
        `insert into public.category_price_revisions
           (category_slug, decision, source, old_min, old_max, new_min, new_max,
            actor_id, reason)
         values ('plumbing', 'approved', 'hunch', 900, 4500, 1500, 6000,
                 $1, 'a fifth kind of evidence')`,
        [ADMIN],
      ),
    ).rejects.toThrow();
  });

  /* A stated row is history like any other: it cannot be tidied away afterwards. */
  it("cannot be rewritten either, for the service role too", async () => {
    const revision = await state(2100, 9600);

    await expect(
      pg.admin.query(
        "update public.category_price_revisions set new_min = 1 where id = $1",
        [revision],
      ),
    ).rejects.toThrow();
    await expect(
      pg.admin.query("delete from public.category_price_revisions where id = $1", [
        revision,
      ]),
    ).rejects.toThrow();
  });
});
