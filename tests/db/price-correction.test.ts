import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The band the customer stated sets the price, and the professional may
 * correct it — before work starts, never at settlement.
 *
 * WHAT THIS IS GUARDING. The triage card asks which product a job is and shows
 * that product's published range; until this landed, the number was lost at the
 * first link and the booking froze the whole trade's band. Somebody who
 * answered "AC repair" read 500-1,500 and was quoted 500-12,000, with the 2x
 * ceiling at 24,000. Closing that is what makes a customer's answer worth
 * something — and what gives them a reason to name a cheaper product than the
 * one they have, which is the other half of this file.
 *
 * `judgeFinalAmount` never sees two bands. It takes one frozen pair, and
 * everything here exists so that pair is one both sides agreed to before
 * anybody started work.
 */

const ANITA = "aaaaaaaa-7aaa-4aaa-8aaa-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-7bbb-4bbb-8bbb-bbbbbbbbbbbb";

let pg: Harness;
let krishna: string;
let address: string;
let counter = 0;

/** A day of its own per booking, so slot capacity never interferes. */
function slotFor(n: number): string {
  return new Date(Date.UTC(2026, 10, 1 + n, 8, 15)).toISOString();
}

async function book(input: {
  band?: string | null;
  source?: string | null;
  provider?: boolean;
}): Promise<string> {
  counter += 1;
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max, quote_model,
        scheduled_for, band_slug, band_source)
     values ($1, $2, $3, 'plumbing', $4, 'Something is wrong with the tap',
             350, 6000, 'band', $5, $6, $7)
     returning id`,
    [
      `SK-PC${counter}`,
      ANITA,
      input.provider === false ? null : krishna,
      address,
      slotFor(counter),
      input.band ?? null,
      input.source ?? null,
    ],
  );
  return rows[0].id as string;
}

async function quote(id: string) {
  const { rows } = await pg.admin.query(
    "select quoted_min, quoted_max, band_min, band_slug from public.bookings where id = $1",
    [id],
  );
  return {
    min: Number(rows[0].quoted_min),
    max: Number(rows[0].quoted_max),
    bandMin: Number(rows[0].band_min),
    stated: rows[0].band_slug as string | null,
  };
}

/** The professional says it is a different product, with a reason. */
async function correct(id: string, slug: string, reason = "found a burst pipe") {
  await pg.admin.query(
    `update public.bookings
        set provider_band_slug = $1, provider_band_at = now(),
            provider_band_reason = $2
      where id = $3`,
    [slug, reason, id],
  );
}

/**
 * Nudge the floor recompute.
 *
 * `sync_booking_quote_floor` fires on a hand-off or on a correction being
 * agreed, so a fixture that wants the narrowed quote without a correction has
 * to re-seat the professional — which is the ordinary path anyway.
 */
async function reseat(id: string) {
  await pg.admin.query(
    "update public.bookings set provider_id = null where id = $1",
    [id],
  );
  await pg.admin.query(
    "update public.bookings set provider_id = $1 where id = $2",
    [krishna, id],
  );
}

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779814${id.slice(0, 6)}`, role],
    );
  }

  const { rows: provider } = await pg.admin.query(
    `insert into public.providers
       (profile_id, display_name, base_rate, availability, standing,
        is_verified, service_areas, crew_count)
     values ($1, 'Krishna Tamang', 900, 'now', 'established', true,
             array['lalitpur-4'], 5)
     returning id`,
    [KRISHNA],
  );
  krishna = provider[0].id as string;
  await pg.admin.query(
    "insert into public.provider_categories (provider_id, category_slug) values ($1, 'plumbing')",
    [krishna],
  );

  const { rows: addr } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  address = addr[0].id as string;
}, 180_000);

beforeEach(async () => {
  await pg.admin.query("delete from public.bookings");
});

afterAll(async () => {
  await pg?.stop();
});

describe("a stated product sets the price", () => {
  it("narrows the quote to the product the customer named", async () => {
    // plumbing is 350-6000 as a trade; `leak` is 500-1200. The 2x ceiling in
    // judgeFinalAmount goes from 12,000 to 2,400 — which is the whole point.
    const id = await book({ band: "leak", source: "customer" });
    await reseat(id);
    expect(await quote(id)).toMatchObject({ min: 900, max: 1200 });
  });

  it("moves band_min with it, so the mispricing signal compares like with like", async () => {
    /*
     * `band_min` is OUR floor and lib/data/pricing-signals.ts measures settled
     * amounts against it to find our own wrong prices. Left on the category
     * while quoted_min narrowed, a whole trade would look like it was bunching
     * under a figure nobody was ever quoted.
     */
    const id = await book({ band: "pipe-work", source: "customer" });
    await reseat(id);
    expect((await quote(id)).bandMin).toBe(1500);
  });

  it("freezes band_min from the stated product at insert, not on a hand-off", async () => {
    /*
     * BEHAVIOUR, NOT TRIGGER ORDER. `freeze_booking_band` fills band_min at
     * insert and `sync_booking_quote_floor` moves it on a correction; the two
     * only agree because 'f' sorts before 's', which is the kind of dependency
     * that breaks silently when somebody renames a trigger — as one did in this
     * very phase. So this asserts the number, on a booking nobody has touched.
     */
    const id = await book({ band: "pipe-work", source: "customer" });
    expect((await quote(id)).bandMin).toBe(1500);
  });

  it("leaves a model-named band on the trade's whole range", async () => {
    /*
     * Our reading of somebody's sentence is not their statement. Trusting the
     * model's slug over its own number would make the price WRONG rather than
     * merely wide, which is worse — decided when the ask shipped, enforced
     * here.
     */
    const id = await book({ band: "leak", source: "model" });
    await reseat(id);
    expect(await quote(id)).toMatchObject({ min: 900, max: 6000 });
  });

  it("leaves an unbanded booking exactly as it was", async () => {
    const id = await book({});
    await reseat(id);
    expect(await quote(id)).toMatchObject({ min: 900, max: 6000 });
  });
});

describe("the professional corrects it, the customer agrees", () => {
  it("does not move the price until the customer has agreed", async () => {
    const id = await book({ band: "leak", source: "customer" });
    await reseat(id);
    await correct(id, "pipe-work");
    // Still the customer's product. A correction nobody answered prices
    // nothing.
    expect(await quote(id)).toMatchObject({ max: 1200 });
  });

  it("moves it once they have, and the 2x ceiling moves with it", async () => {
    const id = await book({ band: "leak", source: "customer" });
    await reseat(id);
    await correct(id, "pipe-work");
    await pg.admin.query(
      "update public.bookings set band_change_approved_at = now() where id = $1",
      [id],
    );
    // pipe-work is 1500-3000. The ceiling judgeFinalAmount measures is 6,000
    // rather than 2,400 — which is what stops an honest overrun on a job the
    // customer understated being unapprovable in the app.
    expect(await quote(id)).toMatchObject({ min: 1500, max: 3000 });
  });

  it("never overwrites what the customer said", async () => {
    /*
     * The same rule provider_estimated_working_minutes follows beside
     * estimated_working_minutes. Keeping both is the only way to ask later,
     * per product, how far our published ranges sit from the work.
     */
    const id = await book({ band: "leak", source: "customer" });
    await correct(id, "pipe-work");
    await pg.admin.query(
      "update public.bookings set band_change_approved_at = now() where id = $1",
      [id],
    );
    expect((await quote(id)).stated).toBe("leak");

    await expect(
      pg.admin.query(
        "update public.bookings set band_slug = 'pipe-work' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/does not rewrite what the customer said/i);
  });

  it("refuses a correction with no reason", async () => {
    // A figure that moves needs a sentence — the same rule final_amount_reason
    // keeps, and for the same reason: a dispute needs both sides on record.
    const id = await book({ band: "leak", source: "customer" });
    await expect(
      pg.admin.query(
        `update public.bookings
            set provider_band_slug = 'pipe-work', provider_band_at = now()
          where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/needs a reason/i);
  });

  it("refuses a product this trade does not sell", async () => {
    const id = await book({ band: "leak", source: "customer" });
    await expect(correct(id, "gas")).rejects.toThrow();
  });

  it("freezes an agreed price", async () => {
    const id = await book({ band: "leak", source: "customer" });
    await correct(id, "pipe-work");
    await pg.admin.query(
      "update public.bookings set band_change_approved_at = now() where id = $1",
      [id],
    );
    // The ceiling is measured off what they agreed to; rewriting the product
    // afterwards would move it out from under an approval given for something
    // else.
    await expect(correct(id, "burst")).rejects.toThrow(
      /agreed price cannot be rewritten/i,
    );
  });
});

describe("work does not start on a price nobody answered", () => {
  it("refuses in_progress while a correction is unanswered", async () => {
    /*
     * THE RULE THE WHOLE THING EXISTS FOR. Work starting is the point after
     * which money is owed. A re-narrowed price arriving at settlement means a
     * professional standing in somebody's kitchen naming a new number, which
     * is the position lib/payments/pricing.ts exists to keep people out of.
     */
    const id = await book({ band: "leak", source: "customer" });
    await correct(id, "pipe-work");
    await pg.admin.query(
      "update public.bookings set status = 'accepted' where id = $1",
      [id],
    );
    await pg.admin.query(
      "update public.bookings set status = 'en_route' where id = $1",
      [id],
    );
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'in_progress' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/has not answered the corrected price/i);
  });

  it("allows it once they have agreed", async () => {
    const id = await book({ band: "leak", source: "customer" });
    await correct(id, "pipe-work");
    await pg.admin.query(
      `update public.bookings
          set band_change_approved_at = now(), status = 'accepted'
        where id = $1`,
      [id],
    );
    for (const step of ["en_route", "in_progress"]) {
      await expect(
        pg.admin.query(
          "update public.bookings set status = $1 where id = $2",
          [step, id],
        ),
      ).resolves.toBeTruthy();
    }
  });

  it("allows it once they have declined, because the job is ending anyway", async () => {
    // Declining is not a refusal to pay — it ends the booking. The status
    // machine and the cancellation window own what happens next; this trigger's
    // only job is that the question was answered.
    const id = await book({ band: "leak", source: "customer" });
    await correct(id, "pipe-work");
    await pg.admin.query(
      `update public.bookings
          set band_change_declined_at = now(), status = 'accepted'
        where id = $1`,
      [id],
    );
    await pg.admin.query(
      "update public.bookings set status = 'en_route' where id = $1",
      [id],
    );
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'in_progress' where id = $1",
        [id],
      ),
    ).resolves.toBeTruthy();
  });

  it("does not stand in the way of a booking with no correction at all", async () => {
    const id = await book({ band: "leak", source: "customer" });
    for (const step of ["accepted", "en_route", "in_progress"]) {
      await expect(
        pg.admin.query(
          "update public.bookings set status = $1 where id = $2",
          [step, id],
        ),
      ).resolves.toBeTruthy();
    }
  });
});

describe("the floor is the customer's, and a correction cannot lower it", () => {
  it("refuses a correction priced entirely below what the customer said", async () => {
    /*
     * THE ANTI-UNDER-REPORTING DESIGN, THROUGH A DIFFERENT DOOR. The fee is
     * charged on max(final_amount, quoted_min), so the payoff for reporting
     * less is already removed. A correction that could lower that floor would
     * put it back: the professional names a cheaper PRODUCT instead of a
     * smaller number. An honest small job appeals through commission_appeals,
     * which is a person looking rather than a rule to be gamed.
     */
    const id = await book({ band: "pipe-work", source: "customer" });
    await reseat(id);
    // pipe-work floors at 1500; inspection tops out at 600.
    await expect(correct(id, "inspection")).rejects.toThrow(
      /below what the customer said it was/i,
    );
  });

  it("allows a correction that overlaps the stated floor", async () => {
    // blockage is 1200-3000 against pipe-work's 1500-3000: the max clears the
    // stated floor, so it is a real disagreement about the product rather than
    // an attempt to move the basis.
    const id = await book({ band: "pipe-work", source: "customer" });
    await reseat(id);
    await correct(id, "blockage");
    await pg.admin.query(
      "update public.bookings set band_change_approved_at = now() where id = $1",
      [id],
    );
    const q = await quote(id);
    expect(q.min).toBe(1500);
    expect(q.max).toBe(3000);
  });

  it("holds the floor when the booking goes back to the pool", async () => {
    // A departed professional's rate is not a promise about whoever comes
    // next — but the customer's own statement still is.
    const id = await book({ band: "pipe-work", source: "customer" });
    await reseat(id);
    await pg.admin.query(
      "update public.bookings set provider_id = null where id = $1",
      [id],
    );
    expect((await quote(id)).min).toBe(1500);
  });
});

describe("a survey job has no product to correct", () => {
  it("refuses a correction on one", async () => {
    counter += 1;
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id, description,
          quote_model, scheduled_for)
       values ($1, $2, 'movers-packers', $3, 'Two rooms', 'survey', $4)
       returning id`,
      [`SK-PC${counter}`, ANITA, address, slotFor(counter)],
    );
    await expect(
      correct(rows[0].id as string, "leak"),
    ).rejects.toThrow();
  });
});
