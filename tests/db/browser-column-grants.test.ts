import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * A browser gets the columns it writes, and not the table.
 *
 * WHY THIS IS A SECOND LAYER AND NOT A REPLACEMENT. `enforce_booking_immutability`
 * was the only thing between a signed-in customer and `final_amount`,
 * `platform_fee`, `payment_status` and `provider_id`, because Supabase's default
 * privilege handed `authenticated` UPDATE on every column of the table. The
 * trigger is a good guard and it held for months — and then it was rebuilt from
 * a stale copy and applied to the live database only, so production spent weeks
 * missing the block on `billable`, the reassignment ban and the
 * `provider_serves` coverage check, where no test here could see it.
 *
 * A grant is refused by the planner before a row is considered and there is no
 * stale copy of a column privilege. `profiles` learned this when a customer
 * could write their own `role`; four tables were left unasked.
 *
 * THE POSITIVE CASES ARE THE POINT AS MUCH AS THE NEGATIVE ONES. A grant list
 * that is too narrow does not fail safe — it breaks a feature with `42501` —
 * so every write the product actually makes through RLS is performed here as
 * the customer, with the column list taken from `lib/data/`.
 */

const ANITA = "dddddddd-7222-4222-8222-dddddddddddd";
const KRISHNA = "eeeeeeee-7333-4333-8333-eeeeeeeeeeee";

let pg: Harness;
let anita: Awaited<ReturnType<Harness["asUser"]>>;
let krishna: string;
let address: string;
let band: { low: number; high: number };
let counter = 0;

/** The exact column list `createBooking` inserts, as the customer. */
async function bookAsCustomer(
  client: { query: typeof pg.admin.query },
  extra: Record<string, unknown> = {},
): Promise<string> {
  counter += 1;
  const row: Record<string, unknown> = {
    reference: `SK-GRANT${counter}`,
    customer_id: ANITA,
    provider_id: null,
    category_slug: "plumbing",
    address_id: address,
    description: "The tap is dripping and will not stop",
    photo_url: null,
    urgency: "soon",
    scheduled_for: new Date(Date.now() + 86_400_000 + counter * 7_200_000).toISOString(),
    quoted_min: band.low,
    quoted_max: band.high,
    quote_model: "band",
    payment_method: "cash",
    first_choice_provider_id: null,
    triage_log_id: null,
    terms_version: null,
    band_slug: null,
    band_source: null,
    band_asked_at: null,
    locale: "en",
    ...extra,
  };
  const columns = Object.keys(row);
  const { rows } = await client.query(
    `insert into public.bookings (${columns.join(", ")})
     values (${columns.map((_, i) => `$${i + 1}`).join(", ")})
     returning id`,
    columns.map((c) => row[c]),
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  pg = await startPostgres();

  const { rows: cat } = await pg.admin.query(
    "select base_price_min, base_price_max from public.categories where slug = 'plumbing'",
  );
  band = {
    low: Number(cat[0].base_price_min),
    high: Number(cat[0].base_price_max),
  };

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
       (profile_id, display_name, base_rate, availability, standing, is_verified,
        service_areas)
     values ($1, 'Krishna Tamang', $2, 'now', 'established', true,
             array['lalitpur-4'])
     returning id`,
    [KRISHNA, band.low],
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

  anita = await pg.asUser(ANITA);
}, 180_000);

afterAll(async () => {
  await anita?.end();
  await pg?.stop();
});

describe("the writes the product actually makes still work", () => {
  /*
   * THE GRANT LIST IS TOO NARROW UNTIL THIS PASSES. A missing column does not
   * fail safe — it breaks booking with `42501 permission denied`, which is why
   * the real insert is performed here rather than asserted about.
   */
  it("lets a customer create a booking with createBooking's own columns", async () => {
    const id = await bookAsCustomer(anita);
    expect(id).toBeTruthy();
  });

  it("lets a customer cancel their own booking", async () => {
    const id = await bookAsCustomer(anita);
    const { rowCount } = await anita.query(
      `update public.bookings
          set status = 'cancelled',
              cancelled_by = 'customer',
              cancelled_by_role = 'customer',
              cancellation_reason = 'changed my mind'
        where id = $1`,
      [id],
    );
    expect(rowCount).toBe(1);
  });

  it("lets a professional advance and claim through RLS", async () => {
    const id = await bookAsCustomer(anita);
    await pg.admin.query(
      "update public.bookings set opened_at = now() where id = $1",
      [id],
    );

    const bikas = await pg.asUser(KRISHNA);
    try {
      const claim = await bikas.query(
        "update public.bookings set provider_id = $2, status = 'accepted' where id = $1",
        [id, krishna],
      );
      expect(claim.rowCount).toBe(1);

      const advance = await bikas.query(
        "update public.bookings set status = 'en_route' where id = $1",
        [id],
      );
      expect(advance.rowCount).toBe(1);
    } finally {
      await bikas.end();
    }
  });

  it("lets a customer add an address and choose a default", async () => {
    const { rows } = await anita.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark, directions_note)
       values ($1, 'office', 'lalitpur-4', 'Lalitpur', 4, 'Pulchowk', 'By the bank', null)
       returning id`,
      [ANITA],
    );
    const { rowCount } = await anita.query(
      "update public.addresses set is_default = true where id = $1",
      [rows[0].id],
    );
    expect(rowCount).toBe(1);
  });
});

describe("the columns a browser may not reach", () => {
  /*
   * REFUSED BY THE PLANNER, which is the property a grant has and a trigger
   * does not: `42501` arrives before any row is considered, so it does not
   * depend on a function definition being the one the tree shipped.
   */
  const refusedOnUpdate = [
    ["final_amount", "4000"],
    ["platform_fee", "600"],
    ["provider_earning", "3400"],
    ["payment_status", "'paid'"],
    ["payout_due_at", "now()"],
    ["band_min", "100"],
    ["band_slug", "'leak'"],
    ["billable", "false"],
    ["cancellation_fee", "999"],
    ["quoted_max", "99999"],
    ["customer_id", "'00000000-0000-0000-0000-000000000000'"],
  ] as const;

  it.each(refusedOnUpdate)(
    "refuses a customer writing bookings.%s",
    async (column, value) => {
      const id = await bookAsCustomer(anita);
      await expect(
        anita.query(
          `update public.bookings set ${column} = ${value} where id = $1`,
          [id],
        ),
      ).rejects.toThrow(/permission denied/i);
    },
  );

  /*
   * THE INSERT SIDE, which the trigger never covered at all:
   * `enforce_booking_immutability` is BEFORE UPDATE, so before this a
   * hand-crafted POST could create its own booking already marked `paid` with a
   * `platform_fee` on it — and `/admin/revenue` sums exactly that column for
   * settled payments.
   */
  it("refuses a booking inserted already paid", async () => {
    await expect(
      bookAsCustomer(anita, { payment_status: "paid", platform_fee: 600 }),
    ).rejects.toThrow(/permission denied/i);
  });

  const refusedAddressColumns = [
    ["lat", "27.6"],
    ["lng", "85.3"],
    ["upheld_no_shows", "0"],
    ["first_confirmed_at", "now()"],
  ] as const;

  /*
   * The allow-list said "no column here confers anything" and four columns
   * added since made that false: `lat`/`lng` are a distance-ranking input, and
   * the other two are this customer's own risk history — writable means
   * erasable.
   */
  it.each(refusedAddressColumns)(
    "refuses a customer writing addresses.%s",
    async (column, value) => {
      await expect(
        anita.query(
          `update public.addresses set ${column} = ${value} where id = $1`,
          [address],
        ),
      ).rejects.toThrow(/permission denied/i);
    },
  );

  /*
   * NOTHING AT ALL ON provider_applications, because nothing writes it from a
   * browser: every path goes through the service role. Its write policies were
   * a door nobody used — the `notifications` finding — and without a privilege
   * they are inert.
   */
  it("refuses a browser writing provider_applications at all", async () => {
    await expect(
      anita.query(
        `insert into public.provider_applications (profile_id, step)
         values ($1, 1)`,
        [ANITA],
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

/*
 * THE HARNESS PRIMITIVE THE REST OF THE SUITE NOW LEANS ON, PINNED HERE.
 *
 * Narrowing the grant made every trigger-sentence assertion in the db suite
 * pass for the wrong reason — `permission denied` arrives before
 * `enforce_booking_immutability` says anything — so twenty-odd of them were
 * rewritten to ask the trigger past the grant, with `pg.pastTheGrant`. That is
 * the owner role carrying an `auth.uid()`, and it has exactly one job: reach a
 * trigger that keys on `auth.uid()` being non-null.
 *
 * If it ever stopped carrying the claim, every one of those cases would still
 * be red and would look like a broken guard. If it stopped reaching the table
 * at all, they would be red for a third unrelated reason. Neither is a thing to
 * discover while debugging a guard, so both properties are asserted directly —
 * the same rule as a scanner that self-tests rather than printing a tick.
 */
describe("past the grant is still somebody, not the server", () => {
  it("carries an auth.uid() the triggers can see", async () => {
    const client = await pg.pastTheGrant(ANITA);
    const { rows } = await client.query("select auth.uid() as uid");
    expect(rows[0].uid).toBe(ANITA);
    await client.end();
  });

  it("is past the column grant, so an unguarded write lands", async () => {
    // `description` is guarded by nothing — it is the customer's own words —
    // and `authenticated` holds no UPDATE on it either. So this write proves
    // the connection reaches the table with the privilege, and that a refusal
    // from it is the trigger's and not the planner's.
    const id = await bookAsCustomer(pg.admin);
    const client = await pg.pastTheGrant(ANITA);
    const { rowCount } = await client.query(
      "update public.bookings set description = 'Still dripping' where id = $1",
      [id],
    );
    expect(rowCount).toBe(1);
    await client.end();
  });

  it("is refused that same write as an ordinary browser", async () => {
    // The pair is what makes the one above mean something: the difference
    // between the two connections is the grant and nothing else.
    const id = await bookAsCustomer(pg.admin);
    await expect(
      anita.query(
        "update public.bookings set description = 'Still dripping' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
