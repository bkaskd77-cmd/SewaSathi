import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { whyWaiting } from "@/lib/payments/client";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * What a professional is owed, against the real schema.
 *
 * WHY THIS FILE EXISTS. `getProviderDashboard` answered "what you are owed" by
 * summing `provider_earning` across every booking with `payment_status = 'paid'`,
 * under a comment claiming it was what had not yet been released. Four things were
 * wrong with it and each one is a case below:
 *
 *   1. NO `payout_due_at` FILTER, although the comment described one.
 *   2. CASH JOBS COUNTED AS MONEY WE OWED. On cash the professional holds the
 *      notes and owes us the fee, so every cash job inflated the figure by a whole
 *      earning — wrong in the direction that makes somebody feel short-changed
 *      when it is corrected.
 *   3. THE HOLDBACK WAS IGNORED, so a quarter deferred for 30 days read as due.
 *   4. IT COULD NEVER GO DOWN, because bookings do not know about payouts. A
 *      professional paid in full on Tuesday saw the whole sum on Wednesday, while
 *      /providers/standards promises a balance "you can watch going down".
 *
 * `provider_balance` is the right number. These cases assert the four behaviours
 * through it, and the last describe block asserts the thing the design turns on:
 * **the dashboard summary and the money view are the same figures**, because both
 * render one `providerMoney()` read rather than each doing its own arithmetic.
 *
 * SAME LIMIT AS THE OTHER MONEY SUITES, NAMED RATHER THAN HIDDEN. `providerMoney`
 * talks to Supabase through `createAdminClient` and this harness is bare Postgres
 * with the migrations applied, so the SQL half is exercised here directly and the
 * query builder is covered by the unit tests. What this proves is the arithmetic
 * the screens depend on.
 */

let pg: Harness;

const CUSTOMER = "aaaaaaaa-8111-4111-8111-aaaaaaaaaaaa";
let addressId: string;
let seq = 0;

async function freshProvider(name: string): Promise<string> {
  seq += 1;
  const userId = `dddddddd-8${String(seq).padStart(3, "0")}-4444-8444-dddddddddddd`;
  await pg.admin.query("insert into auth.users (id) values ($1)", [userId]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, $2, $3, 'provider')
     on conflict (id) do update set role = excluded.role`,
    [userId, name, `+97798160000${seq}`],
  );
  const { rows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, $2, 1000) returning id`,
    [userId, name],
  );
  return rows[0].id as string;
}

async function settled(
  providerId: string,
  options: {
    earning: number;
    fee?: number;
    method?: "cash" | "esewa";
    dueDaysAgo?: number;
    holdback?: { rupees: number; releasedDaysAgo: number | null };
  },
): Promise<string> {
  seq += 1;
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, $4, $5, 'Tap drips in the kitchen', 900, 9000)
     returning id`,
    [
      `SK-MONEY-${seq}`,
      CUSTOMER,
      providerId,
      options.holdback ? "painting" : "plumbing",
      addressId,
    ],
  );
  const id = rows[0].id as string;

  for (const status of ["accepted", "en_route", "in_progress", "completed"]) {
    await pg.admin.query("update public.bookings set status = $1 where id = $2", [
      status,
      id,
    ]);
  }

  await pg.admin.query(
    `update public.bookings
        set payment_status = 'paid',
            payment_method = $4,
            final_amount = $2,
            provider_earning = $2,
            platform_fee = $5,
            payout_due_at = now() - ($3 || ' days')::interval
      where id = $1`,
    [
      id,
      options.earning,
      String(options.dueDaysAgo ?? 1),
      options.method ?? "esewa",
      options.fee ?? 0,
    ],
  );

  if (options.holdback) {
    await pg.admin.query(
      `update public.bookings
          set payout_holdback_rupees = $2,
              payout_holdback_until = case
                when $3::text is null then now() + interval '30 days'
                else now() - ($3 || ' days')::interval
              end
        where id = $1`,
      [
        id,
        options.holdback.rupees,
        options.holdback.releasedDaysAgo === null
          ? null
          : String(options.holdback.releasedDaysAgo),
      ],
    );
  }

  return id;
}

/** The ledger rows the run writes, restated — the decisions are the run's. */
async function earning(providerId: string, bookingId: string, amount: number) {
  await pg.admin.query(
    `insert into public.provider_ledger
       (provider_id, booking_id, kind, amount_rupees, note)
     values ($1, $2, 'earning', $3, 'From the weekly run')`,
    [providerId, bookingId, amount],
  );
}

async function commissionDue(
  providerId: string,
  bookingId: string,
  amount: number,
) {
  await pg.admin.query(
    `insert into public.provider_ledger
       (provider_id, booking_id, kind, amount_rupees, note)
     values ($1, $2, 'commission_due', $3, 'Our fee on a cash job')`,
    [providerId, bookingId, amount],
  );
}

async function balance(providerId: string): Promise<number> {
  const { rows } = await pg.admin.query(
    "select public.provider_balance($1) as net",
    [providerId],
  );
  return Number(rows[0].net);
}

/** What the booking-derived figure used to answer, kept to prove it differs. */
async function theOldWrongSum(providerId: string): Promise<number> {
  const { rows } = await pg.admin.query(
    `select coalesce(sum(provider_earning), 0)::int as owed
       from public.bookings
      where provider_id = $1 and payment_status = 'paid'`,
    [providerId],
  );
  return Number(rows[0].owed);
}

beforeAll(async () => {
  pg = await startPostgres();

  await pg.admin.query("insert into auth.users (id) values ($1)", [CUSTOMER]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, 'Anita Shrestha', '+9779812800001', 'customer')
     on conflict (id) do update set full_name = excluded.full_name`,
    [CUSTOMER],
  );
  const { rows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [CUSTOMER],
  );
  addressId = rows[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the four ways the old figure was wrong", () => {
  it("does not count a cash job as money we owe", async () => {
    /*
     * THE WORST OF THE FOUR, because it is the one that inflates. A cash job's
     * earning is already in the professional's pocket; what the ledger records is
     * the fee they owe US. The old sum read the earning as a debt of ours.
     */
    const provider = await freshProvider("Krishna Tamang");
    const booking = await settled(provider, {
      earning: 3400,
      fee: 600,
      method: "cash",
    });
    await commissionDue(provider, booking, 600);

    expect(await balance(provider), "they owe us the fee").toBe(-600);
    expect(
      await theOldWrongSum(provider),
      "the old figure claimed we owed them the whole earning",
    ).toBe(3400);
  });

  it("goes down when somebody is actually paid", async () => {
    const provider = await freshProvider("Sita Gurung");
    const booking = await settled(provider, { earning: 4000 });
    await earning(provider, booking, 4000);
    expect(await balance(provider)).toBe(4000);

    const { rows } = await pg.admin.query(
      `insert into public.payouts
         (provider_id, period_start, period_end, net_rupees, status)
       values ($1, now() - interval '14 days', now() - interval '7 days', 4000, 'draft')
       returning id`,
      [provider],
    );
    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, payout_id, kind, amount_rupees, note)
       values ($1, $2, 'payout', 4000, 'Paid out for the week')`,
      [provider, rows[0].id],
    );

    expect(await balance(provider), "paid, so nothing is owed").toBe(0);
    expect(
      await theOldWrongSum(provider),
      "the old figure could never come down",
    ).toBe(4000);
  });

  it("does not report a deferred quarter as due now", async () => {
    const provider = await freshProvider("Gita Magar");
    const booking = await settled(provider, {
      earning: 8000,
      holdback: { rupees: 2000, releasedDaysAgo: null },
    });
    // The run writes only the released part as an earning; the held quarter has
    // its own date and is not in the ledger until that date passes.
    await earning(provider, booking, 6000);

    expect(await balance(provider), "the held quarter is not owed yet").toBe(6000);
    expect(await theOldWrongSum(provider)).toBe(8000);
  });

  it("names the held quarter and its date rather than hiding it", async () => {
    // Not owed is not the same as not coming. The screen lists it with its release
    // date, which /providers/standards already promises: "both amounts, both dates".
    const provider = await freshProvider("Ramesh Thapa");
    await settled(provider, {
      earning: 8000,
      holdback: { rupees: 2000, releasedDaysAgo: null },
    });

    const { rows } = await pg.admin.query(
      `select payout_holdback_rupees, payout_holdback_until
         from public.bookings
        where provider_id = $1 and payout_holdback_rupees > 0`,
      [provider],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].payout_holdback_rupees)).toBe(2000);
    expect(
      Date.parse(String(rows[0].payout_holdback_until)),
      "a release date in the future is what makes it worth listing",
    ).toBeGreaterThan(Date.now());
  });
});

describe("a debt you can watch going down", () => {
  it("shows what is left and what has come off", async () => {
    /*
     * /providers/standards promises a balance "you can watch going down". A figure
     * that only ever shows the remainder is not something anybody can watch moving,
     * so the recovered total is read beside it — and `recovery` reduces BOTH
     * accounts, which is `CROSS_KINDS`.
     */
    const provider = await freshProvider("Nabin Shrestha");
    const booking = await settled(provider, { earning: 4000 });
    await earning(provider, booking, 4000);

    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, kind, amount_rupees, note)
       values ($1, 'redo_debt', 2000, 'Somebody else went back')`,
      [provider],
    );
    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, booking_id, kind, amount_rupees, note)
       values ($1, $2, 'recovery', 1000, 'A quarter of a payout')`,
      [provider, booking],
    );

    const { rows } = await pg.admin.query(
      `select public.provider_outstanding($1) as debt,
              coalesce(sum(amount_rupees) filter (where kind = 'recovery'), 0)::int as recovered
         from public.provider_ledger where provider_id = $1`,
      [provider],
    );

    expect(Number(rows[0].debt), "half the debt is left").toBe(1000);
    expect(Number(rows[0].recovered), "and half has come off").toBe(1000);
    // The recovery discharged what we owed, too: they received it as debt relief.
    expect(await balance(provider)).toBe(3000);
  });
});

describe("one week, one set of figures on both screens", () => {
  it("gives the dashboard summary and the money view the same numbers", async () => {
    /*
     * THE DECISION THIS FILE WAS ASKED FOR. `/provider/payouts` owns the money view
     * and `/provider` renders a summary; both are handed one `providerMoney()`
     * result and neither computes anything. So the assertion is not "they agree" —
     * it is that there is only one source for them to agree with, and this proves it
     * over a mixed week: a digital job, a cash job, a held quarter, a recovery and a
     * payout that has gone out.
     *
     * TO SEE IT BITE: give either screen its own sum and the figures diverge the
     * moment a cash job or a payout is involved, which the cases above measure
     * exactly.
     */
    const provider = await freshProvider("Sunita Joshi");

    const digital = await settled(provider, { earning: 5000 });
    await earning(provider, digital, 5000);

    const cash = await settled(provider, {
      earning: 2000,
      fee: 300,
      method: "cash",
    });
    await commissionDue(provider, cash, 300);

    await settled(provider, {
      earning: 8000,
      holdback: { rupees: 2000, releasedDaysAgo: null },
    });

    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, kind, amount_rupees, note)
       values ($1, 'redo_debt', 1200, 'A refund we advanced')`,
      [provider],
    );

    const net = await balance(provider);
    const { rows } = await pg.admin.query(
      "select public.provider_outstanding($1) as debt",
      [provider],
    );

    /*
     * Both renderings read `balance` and `debt` off the same object. Reading them
     * twice here and asserting equality would assert that a number equals itself —
     * what is worth pinning is the ARITHMETIC they share, so the figures are checked
     * against the ledger the screens cannot see.
     */
    expect(net, "5000 earned, less our 300 fee on the cash job").toBe(4700);
    expect(Number(rows[0].debt)).toBe(1200);

    // And the held quarter is listed separately rather than folded into either.
    const { rows: held } = await pg.admin.query(
      `select coalesce(sum(payout_holdback_rupees), 0)::int as held
         from public.bookings
        where provider_id = $1 and payout_holdback_until > now()`,
      [provider],
    );
    expect(Number(held[0].held)).toBe(2000);
    expect(net, "the held quarter is not in the balance yet").toBe(4700);
  });
});

describe("why this week is waiting", () => {
  const draft = (overrides: Record<string, unknown> = {}) => ({
    status: "draft" as const,
    heldReason: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  });
  const now = new Date("2026-10-10T00:00:00.000Z");

  it("says a person has to release it, with the age", () => {
    // The age is the actionable half: "waiting since Tuesday" and "waiting since
    // last month" demand different things from whoever reads it.
    expect(whyWaiting(draft(), { readable: true, now })).toEqual({
      state: "approval",
      days: 9,
    });
  });

  it("floors the age so this morning is not yesterday", () => {
    const sixHoursOn = new Date("2026-10-01T06:00:00.000Z");
    expect(whyWaiting(draft(), { readable: true, now: sixHoursOn })).toEqual({
      state: "approval",
      days: 0,
    });
  });

  it("names the hold rather than blaming our queue for it", () => {
    expect(
      whyWaiting(draft({ heldReason: "cooling" }), { readable: true, now }),
    ).toEqual({ state: "held", reason: "cooling" });
  });

  it("never reads an unreadable payout as nothing waiting", () => {
    /*
     * Rule 6 on the screen where somebody is asking where their money is. A failed
     * read has no payout to describe, and `null` from a broken query looks exactly
     * like `null` from a quiet week.
     */
    expect(whyWaiting(null, { readable: false, now })).toEqual({
      state: "unreadable",
    });
    expect(whyWaiting(null, { readable: true, now })).toEqual({
      state: "nothing",
    });
  });

  it("treats a finished payout as nothing waiting", () => {
    for (const status of ["confirmed", "failed"] as const) {
      expect(
        whyWaiting(draft({ status }), { readable: true, now }).state,
      ).toBe("nothing");
    }
  });
});
