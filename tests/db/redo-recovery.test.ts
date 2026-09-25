import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyRedoRecovery, PAYOUT_RULES } from "@/lib/payments/payout";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * Taking a redo debt off the payouts that follow it, against the real schema.
 *
 * WHY THIS FILE EXISTS. `applyRedoRecovery` was written in Phase 6, tested,
 * documented in three places — and never called. `provider_outstanding` only
 * ever went up, so every refund agreed on /admin/guarantee-claims was money
 * gone. It was also already promised: /providers/standards has told
 * professionals since Phase 6 that the debt comes off future earnings "at most
 * a quarter of any one payout" and shows "as a balance you can watch going
 * down". The balance could not go down.
 *
 * THE PURE FUNCTION IS ALREADY TESTED IN `tests/unit/guarantee.test.ts`. What
 * is tested here is everything that only exists once a database is involved:
 * that the balance is carried across a professional's several due payouts
 * rather than read once and applied twice, that the sweep can run twice and
 * recover once, and that the ledger still refuses to be rewritten afterwards.
 *
 * NOTHING IN THIS FILE RUNS AGAINST PRODUCTION, deliberately and by the user's
 * decision. `provider_ledger` is append-only for every caller including the
 * service role, so a demonstration row written to the live database could
 * never be removed — it would sit on a real professional's record for ever.
 * The live proof waits for a genuine refund.
 */

let pg: Harness;

const ANITA = "aaaaaaaa-9111-4111-8111-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-9222-4222-8222-bbbbbbbbbbbb";
const SITA = "dddddddd-9444-4444-8444-dddddddddddd";

let krishnaProvider: string;
let sitaProvider: string;
let anitaAddress: string;

/**
 * A settled booking whose payout has come due.
 *
 * That is the unit the published 25% cap is measured against, because it is
 * the only thing this product has: there is no payout table and no payout run,
 * `payout_due_at` is stamped on the booking at settlement and that is the
 * whole mechanism.
 */
async function duePayout(
  reference: string,
  providerId: string,
  earning: number,
  dueDaysAgo = 1,
): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, 'plumbing', $4, 'Kitchen tap drips', 900, 4500)
     returning id`,
    [reference, ANITA, providerId, anitaAddress],
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
            final_amount = $2,
            provider_earning = $2,
            payout_due_at = now() - ($3 || ' days')::interval
      where id = $1`,
    [id, earning, String(dueDaysAgo)],
  );
  return id;
}

async function owe(providerId: string, rupees: number): Promise<void> {
  await pg.admin.query(
    `insert into public.provider_ledger (provider_id, kind, amount_rupees, note)
     values ($1, 'redo_debt', $2, 'Refund on a job — netted off future earnings')`,
    [providerId, rupees],
  );
}

async function outstanding(providerId: string): Promise<number> {
  const { rows } = await pg.admin.query(
    "select public.provider_outstanding($1) as owed",
    [providerId],
  );
  return Number(rows[0].owed);
}

/**
 * The sweep, in SQL, matching `sweepRedoRecovery` in lib/data/recovery.ts.
 *
 * WHY A SECOND IMPLEMENTATION RATHER THAN IMPORTING THE REAL ONE. That
 * function talks to Supabase through `createAdminClient`, and this harness is
 * a bare Postgres with the migrations applied — there is no PostgREST in front
 * of it. So the sweep's *arithmetic* is imported (`applyRedoRecovery`, which
 * is the part that decides money) and only its *traversal* is restated here.
 *
 * THAT IS A REAL LIMIT AND IT IS NAMED RATHER THAN HIDDEN: this file proves
 * the schema, the index, the balance arithmetic and the ordering, not the
 * Supabase query builder. The queries themselves are covered by the sweep
 * running against the live database when a genuine refund happens.
 */
async function sweep(): Promise<{ recovered: number; rupees: number }> {
  const { rows: due } = await pg.admin.query(
    `select b.id, b.reference, b.provider_id, b.provider_earning
       from public.bookings b
      where b.payment_status = 'paid'
        and b.provider_id is not null
        and b.provider_earning > 0
        and b.payout_due_at <= now()
        and not exists (
          select 1 from public.provider_ledger l
           where l.booking_id = b.id and l.kind = 'recovery'
        )
      order by b.payout_due_at asc`,
  );

  const byProvider = new Map<string, typeof due>();
  for (const row of due) {
    const list = byProvider.get(row.provider_id);
    if (list) list.push(row);
    else byProvider.set(row.provider_id, [row]);
  }

  let recovered = 0;
  let rupees = 0;

  for (const [providerId, bookings] of Array.from(byProvider)) {
    let balance = await outstanding(providerId);
    if (balance <= 0) continue;

    for (const booking of bookings) {
      if (balance <= 0) break;
      const step = applyRedoRecovery({
        earning: Number(booking.provider_earning),
        outstanding: balance,
      });
      if (step.recovered <= 0) continue;

      await pg.admin.query(
        `insert into public.provider_ledger
           (provider_id, booking_id, kind, amount_rupees, note)
         values ($1, $2, 'recovery', $3, $4)`,
        [
          providerId,
          booking.id,
          step.recovered,
          `Recovered from the payout on ${booking.reference} — a quarter of it, against what is owed`,
        ],
      );

      balance = step.remaining;
      recovered += 1;
      rupees += step.recovered;
    }
  }

  return { recovered, rupees };
}

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
    [SITA, "Sita Gurung", "provider"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      // `handle_new_user` has already created the row from the auth insert
      // above, so this sets the role rather than creating anything.
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779812${id.slice(0, 6)}`, role],
    );
  }

  const { rows: k } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, 'Krishna Tamang', 900) returning id`,
    [KRISHNA],
  );
  krishnaProvider = k[0].id as string;

  const { rows: s } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, 'Sita Gurung', 1100) returning id`,
    [SITA],
  );
  sitaProvider = s[0].id as string;

  const { rows: a } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  anitaAddress = a[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("a quarter of one payout, and no more", () => {
  it("takes 25% of the payout off the balance", async () => {
    // The worst case from the exposure report: a painting-sized job refunded
    // in full leaves the professional's whole share as debt.
    await owe(krishnaProvider, 34_000);
    expect(await outstanding(krishnaProvider)).toBe(34_000);

    await duePayout("SK-REC01", krishnaProvider, 34_000);
    const result = await sweep();

    expect(result).toEqual({ recovered: 1, rupees: 8_500 });
    expect(await outstanding(krishnaProvider)).toBe(25_500);
  });

  /**
   * IDEMPOTENT TWICE OVER, AND THE TWO HALVES CATCH DIFFERENT THINGS —
   * established by removing each and seeing which case went red.
   *
   * This test passes on the `not exists` filter alone: a sweep that runs
   * AFTER another has finished sees the recovery row and skips the booking.
   * Dropping the unique index leaves it green, so it is not what this case
   * proves.
   *
   * What the index catches is the sweep that runs BESIDE another rather than
   * after it — two crons overlapping, or a retry on a slow run — where both
   * read the filter before either writes. That case cannot be staged in a
   * single-threaded test, so it is pinned directly by the next one instead.
   */
  it("recovers once however many times it runs", async () => {
    const before = await outstanding(krishnaProvider);
    const again = await sweep();

    expect(again).toEqual({ recovered: 0, rupees: 0 });
    expect(await outstanding(krishnaProvider)).toBe(before);
  });

  it("refuses a second recovery row on the same booking outright", async () => {
    // The filter above skips it; this is the rule underneath, proven directly.
    const { rows } = await pg.admin.query(
      "select id from public.bookings where reference = 'SK-REC01'",
    );
    await expect(
      pg.admin.query(
        `insert into public.provider_ledger
           (provider_id, booking_id, kind, amount_rupees)
         values ($1, $2, 'recovery', 1)`,
        [krishnaProvider, rows[0].id],
      ),
    ).rejects.toThrow(/provider_ledger_recovery_once_idx|duplicate key/i);
  });

  /**
   * A RECOVERY IS AS UNEDITABLE AS THE DEBT IT PAYS. A ledger whose rows can
   * be adjusted afterwards proves nothing, and this one decides how much of
   * somebody's next payout they actually receive.
   */
  it("cannot be edited or deleted afterwards, service role included", async () => {
    await expect(
      pg.admin.query(
        "update public.provider_ledger set amount_rupees = 1 where kind = 'recovery'",
      ),
    ).rejects.toThrow();
    await expect(
      pg.admin.query("delete from public.provider_ledger where kind = 'recovery'"),
    ).rejects.toThrow();
  });
});

describe("when the payout is smaller than the debt", () => {
  /**
   * The ordinary case for anybody whose trade is not painting. A plumbing job
   * at the band midpoint earns Rs 2,699 after commission, so a quarter is
   * Rs 674 against a debt of Rs 34,000 — 51 payouts to clear it. Nothing
   * overshoots and nothing is chased.
   */
  it("takes its quarter and leaves the rest owed", async () => {
    await duePayout("SK-REC02", krishnaProvider, 2_699);
    const before = await outstanding(krishnaProvider);

    const result = await sweep();

    expect(result).toEqual({ recovered: 1, rupees: 674 });
    expect(await outstanding(krishnaProvider)).toBe(before - 674);
  });
});

describe("when the debt clears mid-sweep", () => {
  /**
   * TWO DUE PAYOUTS FOR ONE PROFESSIONAL, AND THE BALANCE IS CARRIED BETWEEN
   * THEM. This is the case that is easy to get wrong and silent when it is:
   * reading `provider_outstanding` once and applying a quarter to each booking
   * takes half a debt that may only have had a quarter left in it, and the
   * ledger still balances afterwards.
   *
   * Sita owes 500. Her first due payout is 4,000, a quarter of which is 1,000
   * — more than she owes — so the recovery is capped at the 500 outstanding
   * and the second payout is untouched.
   */
  it("stops at zero and leaves the next payout whole", async () => {
    await owe(sitaProvider, 500);
    await duePayout("SK-REC03", sitaProvider, 4_000, 3);
    await duePayout("SK-REC04", sitaProvider, 4_000, 2);

    const result = await sweep();

    expect(result).toEqual({ recovered: 1, rupees: 500 });
    expect(await outstanding(sitaProvider)).toBe(0);

    // The second booking wrote no row at all — not a zero-rupee one, which
    // `amount_rupees > 0` would have refused anyway.
    const { rows } = await pg.admin.query(
      `select count(*)::int as n
         from public.provider_ledger l
         join public.bookings b on b.id = l.booking_id
        where l.kind = 'recovery' and b.reference = 'SK-REC04'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("leaves a professional who owes nothing entirely alone", async () => {
    const result = await sweep();
    expect(result.rupees).toBe(0);
    expect(await outstanding(sitaProvider)).toBe(0);
  });
});

describe("the cap is the published one", () => {
  it("is a quarter, because that is what the professional was promised", async () => {
    // /providers/standards says "at most a quarter of any one payout". Half
    // was considered and refused: no week should go to zero.
    expect(PAYOUT_RULES.redoRecoveryCapBps).toBe(2500);
  });
});
