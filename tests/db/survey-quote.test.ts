import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * A booking whose price does not exist yet.
 *
 * GUARD ONE OF TWO. `tests/unit/survey-quote.test.ts` proves that every money
 * function refuses a bandless booking on its own; this proves the database
 * refuses to let one get that far. Neither is allowed to be the only guard —
 * a rule the application owns alone is one the application can forget, and a
 * rule only the database owns produces an exception where a sentence was
 * needed.
 *
 * The constraint matters as much as the trigger. A nullable money column is
 * exactly the thing that leaks into another code path three phases from now, so
 * "null only on a survey booking" is checked by Postgres rather than reviewed
 * by a person.
 */

const ANITA = "aaaaaaaa-7888-4888-8888-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-7999-4999-8999-bbbbbbbbbbbb";

let pg: Harness;
let krishna: string;
let address: string;
let counter = 0;

/** A day of its own per booking, so slot capacity never interferes. */
function slotFor(n: number): string {
  return new Date(Date.UTC(2026, 11, 1 + n, 8, 15)).toISOString();
}

async function book(input: {
  survey: boolean;
  provider?: string | null;
  min?: number | null;
  max?: number | null;
}): Promise<string> {
  counter += 1;
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max, quote_model, scheduled_for)
     values ($1, $2, $3, $4, $5, 'Two rooms and a fridge', $6, $7, $8, $9)
     returning id`,
    [
      `SK-SV${counter}`,
      ANITA,
      input.provider ?? null,
      input.survey ? "movers-packers" : "plumbing",
      address,
      input.min ?? null,
      input.max ?? null,
      input.survey ? "survey" : "band",
      slotFor(counter),
    ],
  );
  return rows[0].id as string;
}

/** Walk a booking to the point where work would begin. */
async function advanceTo(id: string, status: string): Promise<void> {
  const path = ["accepted", "en_route", "in_progress", "completed"];
  for (const step of path) {
    await pg.admin.query(
      "update public.bookings set status = $1 where id = $2",
      [step, id],
    );
    if (step === status) return;
  }
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
      [id, name, `+9779816${id.slice(0, 6)}`, role],
    );
  }

  const { rows: provider } = await pg.admin.query(
    `insert into public.providers
       (profile_id, display_name, base_rate, availability, standing,
        is_verified, service_areas)
     values ($1, 'Krishna Tamang', 4000, 'now', 'established', true,
             array['lalitpur-4'])
     returning id`,
    [KRISHNA],
  );
  krishna = provider[0].id as string;
  for (const slug of ["movers-packers", "plumbing"]) {
    await pg.admin.query(
      "insert into public.provider_categories (provider_id, category_slug) values ($1, $2)",
      [krishna, slug],
    );
  }

  const { rows: addr } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  address = addr[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("a null band is impossible outside a survey", () => {
  it("lets a survey booking exist with no price at all", async () => {
    await expect(book({ survey: true })).resolves.toBeTruthy();
  });

  it("refuses a banded booking with no price", async () => {
    // The constraint, not the trigger. Movers is the one trade that publishes
    // nothing; every other one has had its band since before the booking.
    await expect(
      book({ survey: false, min: null, max: null }),
    ).rejects.toThrow(/bookings_band_only_null_for_survey/);
  });

  it("refuses half a band, on either kind", async () => {
    // One column set and the other null passes every other rule here and
    // breaks the first thing that reads a range.
    await expect(
      book({ survey: true, min: 12000, max: null }),
    ).rejects.toThrow(/bookings_band_is_a_pair/);
    await expect(
      book({ survey: false, min: null, max: 4500 }),
    ).rejects.toThrow(/bookings_band_is_a_pair/);
  });

  it("refuses survey stamps on a banded booking", async () => {
    // Which would mean some other code path had started treating an ordinary
    // job as a surveyed one.
    const id = await book({ survey: false, min: 900, max: 4500 });
    await expect(
      pg.admin.query(
        "update public.bookings set quote_approved_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/no survey to record/);
  });
});

describe("work cannot start on a price nobody agreed to", () => {
  it("refuses in_progress with no band at all", async () => {
    const id = await book({ survey: true, provider: krishna });
    await expect(advanceTo(id, "in_progress")).rejects.toThrow(
      /Nobody has surveyed this job yet/,
    );
  });

  it("refuses it when the band exists but nobody approved it", async () => {
    const id = await book({ survey: true, provider: krishna });
    await pg.admin.query(
      `update public.bookings
          set quoted_min = 12000, quoted_max = 20000,
              surveyed_at = now(), quote_expires_at = now() + interval '48 hours'
        where id = $1`,
      [id],
    );
    await expect(advanceTo(id, "in_progress")).rejects.toThrow(
      /has not agreed to this price/,
    );
  });

  it("refuses it UNDER THE SERVICE ROLE, which is the half that matters", async () => {
    /*
     * Every write above is already the service role — RLS is not in play at
     * all. That is the point: the paths that record a final amount and settle a
     * payment run under the key that bypasses every policy, so a rule that
     * lived in one would never fire on them.
     */
    const id = await book({ survey: true, provider: krishna });
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'accepted' where id = $1",
        [id],
      ),
    ).resolves.toBeTruthy();
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'en_route' where id = $1",
        [id],
      ),
    ).resolves.toBeTruthy();
    await expect(
      pg.admin.query(
        "update public.bookings set status = 'in_progress' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/Nobody has surveyed this job yet/);
  });

  it("allows it once the customer has approved", async () => {
    const id = await book({ survey: true, provider: krishna });
    await pg.admin.query(
      `update public.bookings
          set quoted_min = 12000, quoted_max = 20000,
              surveyed_at = now(), quote_expires_at = now() + interval '48 hours'
        where id = $1`,
      [id],
    );
    await pg.admin.query(
      "update public.bookings set quote_approved_at = now() where id = $1",
      [id],
    );
    await expect(advanceTo(id, "in_progress")).resolves.toBeUndefined();
  });

  it("never applies to a banded booking", async () => {
    const id = await book({ survey: false, min: 900, max: 4500, provider: krishna });
    await expect(advanceTo(id, "in_progress")).resolves.toBeUndefined();
  });
});

describe("an approved price is frozen", () => {
  it("cannot be rewritten afterwards", async () => {
    /*
     * The 2x ceiling is measured off `quoted_max`. Rewriting it after the
     * customer agreed would move the ceiling out from under an approval that
     * was given for something else — which is the whole reason the approval
     * exists.
     */
    const id = await book({ survey: true, provider: krishna });
    await pg.admin.query(
      `update public.bookings
          set quoted_min = 12000, quoted_max = 20000,
              surveyed_at = now(), quote_expires_at = now() + interval '48 hours',
              quote_approved_at = now()
        where id = $1`,
      [id],
    );
    await expect(
      pg.admin.query(
        "update public.bookings set quoted_max = 60000 where id = $1",
        [id],
      ),
    ).rejects.toThrow(/approved price cannot be rewritten/);
  });

  it("refuses an approval with nothing to approve", async () => {
    const id = await book({ survey: true, provider: krishna });
    await expect(
      pg.admin.query(
        "update public.bookings set quote_approved_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/no price to approve yet/);
  });

  it("refuses a booking changing how it is priced", async () => {
    const id = await book({ survey: true });
    await expect(
      pg.admin.query(
        "update public.bookings set quote_model = 'band', quoted_min = 900, quoted_max = 4500 where id = $1",
        [id],
      ),
    ).rejects.toThrow(/cannot change how it is priced/);
  });
});

describe("the stamps are not the browser's to write", () => {
  it("refuses a customer approving their own price from their own session", async () => {
    /*
     * RLS is row-level: the cancel policy makes the row updatable and every
     * column on it with it. Without the trigger a customer stamps an approval
     * on a price nobody surveyed — and the 2x ceiling then hangs off a number
     * they wrote themselves.
     */
    const id = await book({ survey: true });
    const anita = await pg.asUser(ANITA);
    await expect(
      anita.query(
        "update public.bookings set quote_approved_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/recorded by the server, not a browser/);
    await anita.end();
  });

  it("still refuses the settlement columns it refused before", async () => {
    // This function has been rebuilt three times now, and once it was rebuilt
    // from an older copy and silently lost every check added after it.
    const id = await book({ survey: false, min: 900, max: 4500 });
    const anita = await pg.asUser(ANITA);
    await expect(
      anita.query(
        "update public.bookings set commission_basis = 1 where id = $1",
        [id],
      ),
    ).rejects.toThrow(/not editable from a browser/);
    await anita.end();
  });
});

describe("our own floor is the surveyed one", () => {
  it("is not invented from the category row at booking time", async () => {
    /*
     * `band_min` is what `category_pricing_signals` reads to ask whether a
     * whole trade is mispriced. Movers still carries leftover numbers from
     * before the research found that nobody quotes one — freezing those here
     * would put the invented figure straight into the evidence.
     */
    const id = await book({ survey: true });
    const { rows } = await pg.admin.query(
      "select band_min from public.bookings where id = $1",
      [id],
    );
    expect(rows[0].band_min).toBeNull();
  });

  it("is stamped when the survey lands", async () => {
    const id = await book({ survey: true, provider: krishna });
    await pg.admin.query(
      `update public.bookings
          set quoted_min = 12000, quoted_max = 20000, surveyed_at = now()
        where id = $1`,
      [id],
    );
    const { rows } = await pg.admin.query(
      "select band_min from public.bookings where id = $1",
      [id],
    );
    expect(Number(rows[0].band_min)).toBe(12000);
  });

  it("does not get a floor from the professional's dashboard rate", async () => {
    /*
     * `sync_booking_quote_floor` rewrites `quoted_min` from the assigned
     * professional's own starting price. On a survey job that would be a floor
     * set before anybody saw how much furniture there is.
     */
    const id = await book({ survey: true });
    await pg.admin.query(
      "update public.bookings set provider_id = $1 where id = $2",
      [krishna, id],
    );
    const { rows } = await pg.admin.query(
      "select quoted_min from public.bookings where id = $1",
      [id],
    );
    expect(rows[0].quoted_min).toBeNull();
  });
});
