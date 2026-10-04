import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { payoutPeriod } from "@/lib/config/payout-policy";
import {
  heldReasonFor,
  needsReversal,
  payableTranches,
  UNRESOLVED_PAYOUT_STATUSES,
} from "@/lib/payments/client";
import { sealSecret } from "@/lib/security/secret-box";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * The payout run against the real schema, and the identity that has to survive it.
 *
 * WHAT THIS FILE IS FOR. `runPayouts` turns settled bookings into ledger rows and
 * one net figure per professional, and a person then approves it, sends it,
 * confirms it or fails it. Every one of those steps writes to an append-only ledger
 * that `provider_balance` and `provider_outstanding` are derived from, so the thing
 * worth asserting is not any single step — it is that the two accounts still add up
 * after each of them. A payout that leaves the books inconsistent is money nobody
 * can trace, and it would pass any per-step test.
 *
 * THE INVARIANT, in both halves:
 *
 *   money      earnings − commission + reversals − payouts − recoveries
 *                = provider_balance
 *   guarantee  redo_debt − recovery − write_off  (floored at 0)
 *                = provider_outstanding
 *
 * `recovery` appears in BOTH, which is `CROSS_KINDS` and is deliberate: it is two
 * facts at once — money the professional was owed, spent on the debt they owed us.
 * The identity is checked after the run, after an approval, after a send and after a
 * reversal, because a step that breaks it at one state only is exactly the kind of
 * fault a single end-state assertion sleeps through.
 *
 * SAME LIMIT AS `redo-recovery.test.ts`, NAMED RATHER THAN HIDDEN. `runPayouts`
 * talks to Supabase through `createAdminClient` and this harness is bare Postgres
 * with the migrations applied — there is no PostgREST in front of it. So the pure
 * decisions are IMPORTED (`payableTranches`, `payoutPeriod`, `heldReasonFor`,
 * `needsReversal`) and only the traversal is restated. What this proves is the
 * schema, the indexes, the trigger and the arithmetic; the query builder is proved
 * by the unit tests and by the run against the live database.
 */

let pg: Harness;

const CUSTOMER = "aaaaaaaa-7111-4111-8111-aaaaaaaaaaaa";
let addressId: string;
let seq = 0;

async function freshProvider(name: string): Promise<string> {
  seq += 1;
  const userId = `cccccccc-7${String(seq).padStart(3, "0")}-4333-8333-cccccccccccc`;
  await pg.admin.query("insert into auth.users (id) values ($1)", [userId]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, $2, $3, 'provider')
     on conflict (id) do update set role = excluded.role`,
    [userId, name, `+97798140000${seq}`],
  );
  const { rows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, $2, 1000) returning id`,
    [userId, name],
  );
  return rows[0].id as string;
}

/**
 * A settled booking whose payout has come due.
 *
 * `dueAt` IS ABSOLUTE AND DEFAULTS TO INSIDE THE PERIOD, not to `now() - 1 day`.
 * Two things make that necessary and both bit while writing this file. The run
 * derives its period from the date it is given, so a fixture anchored to the wall
 * clock falls outside it the moment the run date is in the past. And a Tuesday run
 * settles the week ENDING at the previous Monday 00:00 UTC — `payoutPeriod` is ISO
 * weeks — so "due yesterday" relative to the run date is one day too late to be in
 * it. Three days back is comfortably inside.
 */
async function settledBooking(
  providerId: string,
  options: {
    earning: number;
    fee?: number;
    method?: "cash" | "esewa" | "khalti";
    dueAt?: Date;
    holdback?: { rupees: number; released: Date | null };
  },
): Promise<string> {
  seq += 1;
  const reference = `SK-RUN-${seq}`;
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, $4, $5, 'Tap drips in the kitchen', 900, 9000)
     returning id`,
    [
      reference,
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

  const dueAt = options.dueAt ?? new Date(TUESDAY.getTime() - 3 * DAY);

  await pg.admin.query(
    `update public.bookings
        set payment_status = 'paid',
            payment_method = $4,
            final_amount = $2,
            provider_earning = $2,
            platform_fee = $5,
            payout_due_at = $3
      where id = $1`,
    [id, options.earning, dueAt.toISOString(), options.method ?? "esewa", options.fee ?? 0],
  );

  if (options.holdback) {
    /*
     * A RELEASE DATE IN THE FUTURE IS THE NORMAL CASE for the first 30 days, and
     * the run must leave that money alone: paying it early pays a quarter nobody
     * has waited for.
     */
    await pg.admin.query(
      `update public.bookings
          set payout_holdback_rupees = $2,
              payout_holdback_until = $3
        where id = $1`,
      [
        id,
        options.holdback.rupees,
        (
          options.holdback.released ?? new Date(TUESDAY.getTime() + 30 * DAY)
        ).toISOString(),
      ],
    );
  }

  return id;
}

async function balance(providerId: string): Promise<number> {
  const { rows } = await pg.admin.query(
    "select public.provider_balance($1) as net",
    [providerId],
  );
  return Number(rows[0].net);
}

async function outstanding(providerId: string): Promise<number> {
  const { rows } = await pg.admin.query(
    "select public.provider_outstanding($1) as owed",
    [providerId],
  );
  return Number(rows[0].owed);
}

/**
 * Both halves of the identity, read off the ledger itself.
 *
 * SUMMED FROM THE ROWS RATHER THAN FROM THE FUNCTIONS, which is the whole point:
 * asking `provider_balance` twice and comparing would assert that a function equals
 * itself. This adds the kinds up independently and checks the two agree.
 */
async function booksBalance(providerId: string): Promise<void> {
  const { rows } = await pg.admin.query(
    `select kind, coalesce(sum(amount_rupees), 0)::int as total
       from public.provider_ledger
      where provider_id = $1
      group by kind`,
    [providerId],
  );

  const sum = (kind: string) =>
    Number(rows.find((r) => r.kind === kind)?.total ?? 0);

  const money =
    sum("earning") -
    sum("commission_due") +
    sum("payout_reversal") -
    sum("payout") -
    sum("tax_withheld") -
    sum("recovery");

  const debt = Math.max(0, sum("redo_debt") - sum("recovery") - sum("write_off"));

  expect(await balance(providerId), "money account").toBe(money);
  expect(await outstanding(providerId), "guarantee account").toBe(debt);
}

/**
 * The run's traversal, restated. The decisions are imported.
 *
 * It takes `now` so the period is derived the way `runPayouts` derives it — from
 * the date and never from "now minus seven days", which would give two runs an hour
 * apart two different answers and let the second past the unique index.
 */
/**
 * `onlyProvider` SCOPES THE DRAFTING HALF, and it exists because the first version
 * of the in-flight case read `blocked: 4`. Every case in this file shares one
 * database, so earlier providers still carry unresolved drafts and a run counts
 * them all. A case that asserted "at least one" would have passed with the guard
 * removed — the weak assertion is the failure, not the shared state.
 */
async function run(
  now: Date,
  onlyProvider?: string,
): Promise<{ drafted: number; blocked: number; ledgerRows: number }> {
  const { start, end } = payoutPeriod(now);

  const { rows: bookings } = await pg.admin.query(
    `select id, reference, provider_id, provider_earning, platform_fee,
            payment_method, payout_due_at, payout_holdback_rupees,
            payout_holdback_until
       from public.bookings
      where payment_status = 'paid'
        and provider_id is not null
        and provider_earning > 0
        and payout_due_at <= $1`,
    [end.toISOString()],
  );

  const byBooking = new Map(bookings.map((b) => [b.id as string, b]));
  const tranches = payableTranches(
    bookings.map((b) => ({
      id: b.id as string,
      reference: b.reference as string,
      provider_id: b.provider_id as string,
      provider_earning: Number(b.provider_earning),
      payout_due_at: new Date(b.payout_due_at as string).toISOString(),
      payout_holdback_rupees:
        b.payout_holdback_rupees === null ? null : Number(b.payout_holdback_rupees),
      payout_holdback_until:
        b.payout_holdback_until === null
          ? null
          : new Date(b.payout_holdback_until as string).toISOString(),
    })),
    end,
  );

  let ledgerRows = 0;
  const touched = new Set<string>();

  for (const tranche of tranches) {
    const booking = byBooking.get(tranche.bookingId);
    if (!booking) continue;
    touched.add(tranche.providerId);

    const digital = booking.payment_method !== "cash";
    const kind = digital ? "earning" : "commission_due";
    if (!digital && tranche.tranche !== "main") continue;
    const amount = digital ? tranche.earning : Number(booking.platform_fee ?? 0);
    if (amount <= 0) continue;

    try {
      await pg.admin.query(
        `insert into public.provider_ledger
           (provider_id, booking_id, tranche, kind, amount_rupees, note)
         values ($1, $2, $3, $4, $5, 'From the weekly run')`,
        [tranche.providerId, tranche.bookingId, tranche.tranche, kind, amount],
      );
      ledgerRows += 1;
    } catch (error) {
      // The unique index refusing a second row IS the idempotency. Anything else
      // is a real failure and must not be swallowed.
      if (!/duplicate key/i.test(String(error))) throw error;
    }
  }

  let drafted = 0;
  let blocked = 0;
  for (const providerId of Array.from(touched)) {
    if (onlyProvider && providerId !== onlyProvider) continue;
    const net = await balance(providerId);
    if (net === 0) continue;

    const { rows: destRows } = await pg.admin.query(
      `select id, usable_from, first_payout_confirmed_at
         from public.payout_destinations
        where provider_id = $1 and retired_at is null`,
      [providerId],
    );
    const live = destRows[0];

    const heldReason = heldReasonFor(
      net,
      live ? { readiness: readiness(live, now) } : null,
    );

    // A week they owe us drafts nothing: a payout row is an instruction to pay.
    if (heldReason === "negative") continue;

    const { rows: counted } = await pg.admin.query(
      "select count(*)::int as n from public.provider_ledger where provider_id = $1",
      [providerId],
    );

    try {
      await pg.admin.query(
        `insert into public.payouts
           (provider_id, period_start, period_end, net_rupees, destination_id,
            held_reason, ledger_rows_at_draft)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          providerId,
          start.toISOString(),
          end.toISOString(),
          net,
          live?.id ?? null,
          heldReason,
          counted[0].n,
        ],
      );
      drafted += 1;
    } catch (error) {
      if (/payouts_one_in_flight_idx/i.test(String(error))) {
        blocked += 1;
        continue;
      }
      if (!/duplicate key/i.test(String(error))) throw error;
    }
  }

  return { drafted, blocked, ledgerRows };
}

/** `destinationReadiness`'s shape, from the row the harness holds. */
function readiness(
  row: { usable_from: string; first_payout_confirmed_at: string | null },
  now: Date,
): { ok: boolean; reason?: string } {
  if (new Date(row.usable_from).getTime() > now.getTime()) {
    return { ok: false, reason: "cooling" };
  }
  if (row.first_payout_confirmed_at === null) {
    return { ok: false, reason: "unconfirmed" };
  }
  return { ok: true };
}

async function destinationFor(
  providerId: string,
  options: { cooling?: boolean; confirmed?: boolean } = {},
): Promise<string> {
  // SEALED, through `sealSecret`, because `payout_destinations_account_ref_sealed`
  // refuses anything that is not an envelope — which it did the first time this
  // fixture hand-rolled one, and that refusal is the constraint working.
  /*
   * ANCHORED ON THE RUN'S OWN CLOCK, NOT ON `now()`, and this was a real failure
   * rather than tidiness. The dates were `now() - interval '5 days'` while every run
   * in this file is at the fixed TUESDAY, so whether a destination counted as out of
   * its cooling window depended on today's date: it passed for weeks and went red on
   * the morning `now() - 5 days` crossed back over that Tuesday. A fixture whose
   * verdict moves with the calendar proves nothing on either side of the change.
   */
  const { rows } = await pg.admin.query(
    `insert into public.payout_destinations
       (provider_id, kind, account_ref, account_name, usable_from,
        first_payout_confirmed_at)
     values ($1, 'bank', $4, 'Krishna Tamang',
             case when $2 then $5::timestamptz + interval '2 days'
                  else $5::timestamptz - interval '5 days' end,
             case when $3 then $5::timestamptz - interval '1 day' else null end)
     returning id`,
    [
      providerId,
      options.cooling ?? false,
      options.confirmed ?? true,
      sealSecret(`97798${String(seq).padStart(8, "0")}`),
      TUESDAY.toISOString(),
    ],
  );
  return rows[0].id as string;
}

/** A Tuesday, so the run day is never in question inside these cases. */
const TUESDAY = new Date("2026-09-29T04:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  // A key the harness owns, like `payout-destinations.test.ts`: the envelope has
  // to be a real one for the check constraint to accept it.
  process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  pg = await startPostgres();

  await pg.admin.query("insert into auth.users (id) values ($1)", [CUSTOMER]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, 'Anita Shrestha', '+9779812700001', 'customer')
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

describe("the run drafts a week", () => {
  it("turns a digital job into an earning and a payable draft", async () => {
    const provider = await freshProvider("Krishna Tamang");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 4000, method: "esewa" });

    const first = await run(TUESDAY);
    expect(first.ledgerRows).toBe(1);
    expect(first.drafted).toBe(1);

    const { rows } = await pg.admin.query(
      "select net_rupees, held_reason, status from public.payouts where provider_id = $1",
      [provider],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].net_rupees)).toBe(4000);
    expect(rows[0].held_reason).toBeNull();
    expect(rows[0].status).toBe("draft");

    await booksBalance(provider);
  });

  it("writes one commission row for a cash job and no earning at all", async () => {
    const provider = await freshProvider("Sita Gurung");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 3400, fee: 600, method: "cash" });

    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      `select kind, amount_rupees from public.provider_ledger
        where provider_id = $1 order by kind`,
      [provider],
    );
    expect(rows.map((r) => r.kind)).toEqual(["commission_due"]);
    expect(Number(rows[0].amount_rupees)).toBe(600);

    /*
     * THEY HOLD THE CASH AND OWE US THE FEE, SO NO PAYOUT IS DRAFTED AT ALL. The
     * first version drafted one carrying `held_reason = 'negative'`, and
     * `payouts_one_in_flight_idx` then blocked every later week until a person
     * failed that row by hand — weekly busywork for a professional whose work is all
     * cash, over a row nobody could act on. The ledger carries the balance forward
     * on its own.
     */
    const { rows: payout } = await pg.admin.query(
      "select count(*)::int as n from public.payouts where provider_id = $1",
      [provider],
    );
    expect(payout[0].n, "a negative week is not an instruction to pay").toBe(0);
    expect(await balance(provider)).toBe(-600);

    await booksBalance(provider);
  });

  it("creates nothing on a second run in the same week", async () => {
    const provider = await freshProvider("Bishal Rai");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 2500 });

    await run(TUESDAY);
    const second = await run(TUESDAY);

    expect(second.drafted, "a second draft for the same week").toBe(0);
    expect(second.ledgerRows, "a second earning for the same tranche").toBe(0);

    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.payouts where provider_id = $1",
      [provider],
    );
    expect(rows[0].n).toBe(1);

    await booksBalance(provider);
  });

  it("refuses a second unresolved payout for the same professional", async () => {
    /*
     * THE DOUBLE PAYMENT THIS CLOSES, found by re-reading the run rather than by a
     * failure. `net_rupees` is the WHOLE position, so two unresolved drafts describe
     * the same money: a week drafted at 2,500 that nobody approves, then a Tuesday
     * with no new settlements — the ledger has not moved, so
     * `ledger_rows_at_draft` is unchanged and the staleness check in
     * `approvePayout` sees nothing wrong. Both would be approvable, both sendable,
     * and each send writes its own `payout` row.
     * `provider_ledger_payout_once_idx` does not help: it is unique per payout, and
     * these are two payouts. The balance would end at -2,500 with a ledger that
     * reconciles perfectly, which is the worst kind of wrong.
     */
    const provider = await freshProvider("Rupa Chaudhary");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 2500 });

    const first = await run(TUESDAY, provider);
    expect(first.drafted).toBe(1);

    // The next week, with nothing new settled and nobody having approved.
    const nextWeek = new Date("2026-10-06T04:00:00.000Z");
    const second = await run(nextWeek, provider);

    expect(second.drafted, "a second unresolved payout").toBe(0);
    expect(second.blocked, "reported rather than silently absent").toBe(1);

    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.payouts where provider_id = $1",
      [provider],
    );
    expect(rows[0].n).toBe(1);

    /*
     * AND THE WAY OUT IS A PERSON. Failing the open one — which `draft -> failed`
     * exists for, and which moves no money because nothing was sent — lets the next
     * run draft the week afresh.
     */
    await pg.admin.query(
      `update public.payouts set status = 'failed', failure_reason = 'superseded'
        where provider_id = $1`,
      [provider],
    );
    const third = await run(nextWeek, provider);
    expect(third.drafted, "unblocked once a person resolved it").toBe(1);

    await booksBalance(provider);
  });

  it("pays each tranche of a long-guarantee job as its own payout", async () => {
    const provider = await freshProvider("Gita Magar");
    await destinationFor(provider);
    await settledBooking(provider, {
      earning: 8000,
      holdback: { rupees: 2000, released: new Date(TUESDAY.getTime() - 3 * DAY) },
    });

    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      `select tranche, amount_rupees from public.provider_ledger
        where provider_id = $1 and kind = 'earning' order by tranche`,
      [provider],
    );
    expect(rows.map((r) => [r.tranche, Number(r.amount_rupees)])).toEqual([
      ["holdback", 2000],
      ["main", 6000],
    ]);

    await booksBalance(provider);
  });

  it("leaves a holdback that has not been released alone", async () => {
    const provider = await freshProvider("Ramesh Thapa");
    await destinationFor(provider);
    await settledBooking(provider, {
      earning: 8000,
      holdback: { rupees: 2000, released: null },
    });

    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      `select tranche from public.provider_ledger
        where provider_id = $1 and kind = 'earning'`,
      [provider],
    );
    expect(rows.map((r) => r.tranche)).toEqual(["main"]);
    await booksBalance(provider);
  });

  it("holds a cooling destination and keeps the money on the balance", async () => {
    const provider = await freshProvider("Nabin Shrestha");
    await destinationFor(provider, { cooling: true });
    await settledBooking(provider, { earning: 5000 });

    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      "select held_reason, net_rupees from public.payouts where provider_id = $1",
      [provider],
    );
    expect(rows[0].held_reason).toBe("cooling");
    // Held is not spent: the balance still says we owe them.
    expect(await balance(provider)).toBe(5000);
    await booksBalance(provider);
  });

  it("holds an unconfirmed first destination", async () => {
    const provider = await freshProvider("Puja Karki");
    await destinationFor(provider, { confirmed: false });
    await settledBooking(provider, { earning: 1500 });

    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      "select held_reason from public.payouts where provider_id = $1",
      [provider],
    );
    expect(rows[0].held_reason).toBe("unconfirmed");
  });

  it("holds somebody with no destination at all", async () => {
    const provider = await freshProvider("Dipesh Lama");
    await settledBooking(provider, { earning: 1800 });

    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      "select held_reason, destination_id from public.payouts where provider_id = $1",
      [provider],
    );
    expect(rows[0].held_reason).toBe("no_destination");
    expect(rows[0].destination_id).toBeNull();
  });

  it("carries a week they owed us into the next week's figure", async () => {
    const provider = await freshProvider("Anil Bhandari");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 2000, fee: 500, method: "cash" });

    await run(TUESDAY);
    expect(await balance(provider)).toBe(-500);

    // A digital job the following week, and the fee they owed comes off it.
    const nextWeek = new Date("2026-10-06T04:00:00.000Z");
    await settledBooking(provider, {
      earning: 3000,
      method: "khalti",
      dueAt: new Date(nextWeek.getTime() - 3 * DAY),
    });
    await run(nextWeek);

    const { rows } = await pg.admin.query(
      `select net_rupees from public.payouts
        where provider_id = $1 order by period_start desc limit 1`,
      [provider],
    );
    expect(Number(rows[0].net_rupees)).toBe(2500);
    await booksBalance(provider);
  });
});

describe("what a person does to a draft, and the books afterwards", () => {
  /**
   * The send and the reversal, restated in SQL the way `markPayoutSent` and
   * `markPayoutFailed` write them.
   */
  async function send(payoutId: string, providerId: string, net: number) {
    await pg.admin.query(
      "update public.payouts set status = 'approved', approved_at = now() where id = $1",
      [payoutId],
    );
    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, payout_id, kind, amount_rupees, note)
       values ($1, $2, 'payout', $3, 'Paid out for the week')`,
      [providerId, payoutId, net],
    );
    await pg.admin.query(
      `update public.payouts
          set status = 'sent', sent_at = now(), external_reference = 'TXN-1'
        where id = $1`,
      [payoutId],
    );
  }

  it("leaves the books consistent at every state from draft to confirmed", async () => {
    const provider = await freshProvider("Sunita Joshi");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 6000 });
    await run(TUESDAY);
    await booksBalance(provider);

    const { rows } = await pg.admin.query(
      "select id, net_rupees from public.payouts where provider_id = $1",
      [provider],
    );
    const payoutId = rows[0].id as string;
    const net = Number(rows[0].net_rupees);

    await send(payoutId, provider, net);
    await booksBalance(provider);
    // Sent means we no longer owe it.
    expect(await balance(provider)).toBe(0);

    await pg.admin.query(
      "update public.payouts set status = 'confirmed', settled_at = now() where id = $1",
      [payoutId],
    );
    await booksBalance(provider);
    expect(await balance(provider)).toBe(0);
  });

  it("returns the money to the balance when a sent payout fails", async () => {
    const provider = await freshProvider("Kiran Adhikari");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 4500 });
    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      "select id, net_rupees, status from public.payouts where provider_id = $1",
      [provider],
    );
    const payoutId = rows[0].id as string;
    const net = Number(rows[0].net_rupees);

    await send(payoutId, provider, net);
    expect(await balance(provider)).toBe(0);

    // `needsReversal` is what decides there is anything to take back, and only
    // `sent` qualifies — a draft or an approval moved nothing.
    expect(needsReversal("sent")).toBe(true);
    expect(needsReversal("approved")).toBe(false);
    expect(needsReversal("draft")).toBe(false);

    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, payout_id, kind, amount_rupees, note)
       values ($1, $2, 'payout_reversal', $3, 'It did not arrive')`,
      [provider, payoutId, net],
    );
    await pg.admin.query(
      "update public.payouts set status = 'failed', failure_reason = 'bounced' where id = $1",
      [payoutId],
    );

    expect(await balance(provider), "owed again after a reversal").toBe(net);
    await booksBalance(provider);

    // The `payout` row is still there: it is the evidence a remittance was
    // attempted, which is what somebody investigating a missing payment needs.
    const { rows: kinds } = await pg.admin.query(
      `select kind from public.provider_ledger
        where payout_id = $1 order by kind`,
      [payoutId],
    );
    expect(kinds.map((r) => r.kind)).toEqual(["payout", "payout_reversal"]);
  });

  it("refuses a second payout row for the same payout", async () => {
    const provider = await freshProvider("Maya Shakya");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 3000 });
    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      "select id, net_rupees from public.payouts where provider_id = $1",
      [provider],
    );
    const payoutId = rows[0].id as string;
    await send(payoutId, provider, Number(rows[0].net_rupees));

    /*
     * THE INDEX IS THE RULE, NOT THE APPLICATION FILTER. Without
     * `provider_ledger_payout_once_idx` a retried send — two admins, a double
     * submit, a request that timed out and was repeated — would pay the week
     * twice with a balance that still reconciled.
     */
    await expect(
      pg.admin.query(
        `insert into public.provider_ledger
           (provider_id, payout_id, kind, amount_rupees, note)
         values ($1, $2, 'payout', 1, 'again')`,
        [provider, payoutId],
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("refuses a figure change once a payout is past draft", async () => {
    const provider = await freshProvider("Hari Dangol");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 2200 });
    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      "select id from public.payouts where provider_id = $1",
      [provider],
    );
    const payoutId = rows[0].id as string;

    // A draft may be recomputed — that is what `approvePayout` does when the
    // ledger has moved, and it is why a stale draft is not failed.
    await pg.admin.query(
      "update public.payouts set net_rupees = 2300 where id = $1",
      [payoutId],
    );

    await pg.admin.query(
      "update public.payouts set status = 'approved', approved_at = now() where id = $1",
      [payoutId],
    );

    await expect(
      pg.admin.query("update public.payouts set net_rupees = 9999 where id = $1", [
        payoutId,
      ]),
    ).rejects.toThrow(/somebody approved/i);
  });

  it("refuses a transition the machine does not allow", async () => {
    const provider = await freshProvider("Laxmi Tuladhar");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 1200 });
    await run(TUESDAY);

    const { rows } = await pg.admin.query(
      "select id from public.payouts where provider_id = $1",
      [provider],
    );

    // A cron cannot reach a rail, however it is called. This is the structural
    // half of "the run only ever creates drafts".
    await expect(
      pg.admin.query("update public.payouts set status = 'sent' where id = $1", [
        rows[0].id,
      ]),
    ).rejects.toThrow(/cannot go from draft to sent/i);
  });
});

describe("the in-flight index and the code agree about what unresolved means", () => {
  it("has the same statuses in its predicate as UNRESOLVED_PAYOUT_STATUSES", async () => {
    /*
     * ONE LIST WRITTEN TWICE, so it is read back rather than trusted. A status added
     * to the TypeScript side and not to the index lets a second payout through for
     * money the first one already claims; added to the index and not to the code,
     * `payoutsForReview` stops showing a row somebody has to act on. Both are silent.
     *
     * The predicate text is parsed rather than matched whole, because Postgres
     * rewrites `in (...)` as `= ANY (ARRAY[...])` and normalises the casts — asserting
     * the string would be asserting the planner's formatting.
     */
    const { rows } = await pg.admin.query(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'payouts_one_in_flight_idx'`,
    );
    expect(rows, "the index itself is missing").toHaveLength(1);

    const inPredicate = Array.from(
      String(rows[0].indexdef).matchAll(/'(\w+)'::text/g),
    ).map((m) => m[1]);

    expect([...inPredicate].sort()).toEqual([...UNRESOLVED_PAYOUT_STATUSES].sort());
  });
});

describe("what the staleness cursor depends on", () => {
  it("still has the append-only trigger on provider_ledger", async () => {
    /*
     * `payouts.ledger_rows_at_draft` IS A COUNT, and a count is only a sound
     * cursor while the ledger can change in exactly one way — by growing. That is
     * true because `provider_ledger_append_only` refuses UPDATE and DELETE for
     * every caller, the service role included. If this trigger ever goes, a row
     * edited in place leaves the count identical and `approvePayout` pays a figure
     * the ledger no longer supports, silently. So the dependency is asserted here
     * rather than assumed where it is relied on.
     */
    const { rows } = await pg.admin.query(
      `select tgname, tgenabled from pg_trigger
        where tgrelid = 'public.provider_ledger'::regclass
          and not tgisinternal
          and tgname = 'provider_ledger_append_only'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tgenabled, "present but switched off guards nothing").not.toBe(
      "D",
    );
  });

  it("refuses an update to a ledger row", async () => {
    const provider = await freshProvider("Bikash Shrestha");
    await destinationFor(provider);
    await settledBooking(provider, { earning: 1000 });
    await run(TUESDAY);

    await expect(
      pg.admin.query(
        "update public.provider_ledger set amount_rupees = 1 where provider_id = $1",
        [provider],
      ),
    ).rejects.toThrow();
  });
});
