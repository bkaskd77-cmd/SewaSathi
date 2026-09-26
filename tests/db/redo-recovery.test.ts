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
  /**
   * A held-back quarter and how long ago it was released, for the trades whose
   * guarantee outlives the payout. `null` is the ordinary case — no hold here,
   * which is not the same fact as a hold of zero.
   */
  holdback: { rupees: number; releasedDaysAgo: number | null } | null = null,
): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, $5, $4, 'Kitchen tap drips', 900, 4500)
     returning id`,
    [reference, ANITA, providerId, anitaAddress, holdback ? "painting" : "plumbing"],
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

  if (holdback) {
    /*
     * A RELEASE DATE IN THE FUTURE IS THE NORMAL CASE for the first 30 days,
     * and the sweep must leave that money alone: recovering against it early
     * takes a quarter of something nobody has been paid.
     */
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
        holdback.rupees,
        holdback.releasedDaysAgo === null ? null : String(holdback.releasedDaysAgo),
      ],
    );
  }
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
  /*
   * ONE ROW PER PAYABLE TRANCHE, not per booking. A booking pays once unless
   * its guarantee window runs long, in which case a quarter waits 30 days and
   * it pays twice — and each of those is a payout the published quarter is
   * measured against.
   *
   * `earning` is the money actually arriving on that date. The main tranche is
   * the settlement LESS whatever is held; the holdback tranche is that held
   * amount, and only once its own date has passed.
   */
  const { rows: due } = await pg.admin.query(
    `select b.id, b.reference, b.provider_id, 'main' as tranche,
            b.provider_earning - coalesce(b.payout_holdback_rupees, 0) as earning,
            b.payout_due_at as payable_at
       from public.bookings b
      where b.payment_status = 'paid'
        and b.provider_id is not null
        and b.provider_earning > 0
        and b.payout_due_at <= now()
        and b.provider_earning - coalesce(b.payout_holdback_rupees, 0) > 0
     union all
     select b.id, b.reference, b.provider_id, 'holdback' as tranche,
            b.payout_holdback_rupees as earning,
            b.payout_holdback_until as payable_at
       from public.bookings b
      where b.payment_status = 'paid'
        and b.provider_id is not null
        and coalesce(b.payout_holdback_rupees, 0) > 0
        and b.payout_holdback_until <= now()
      order by payable_at asc`,
  );

  /*
   * KEYED ON BOOKING **AND** TRANCHE, and this is the whole reason the index
   * had to change. Keying on the booking alone would drop a released holdback
   * whose first tranche had already been recovered — paid in full, no row
   * written, no unique violation raised and nothing logged.
   */
  const { rows: doneRows } = await pg.admin.query(
    `select booking_id, tranche from public.provider_ledger where kind = 'recovery'`,
  );
  const alreadyDone = new Set(
    doneRows.map((r) => `${r.booking_id}:${r.tranche}`),
  );
  const pending = due.filter(
    (r) => !alreadyDone.has(`${r.id}:${r.tranche}`),
  );

  const byProvider = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byProvider.get(row.provider_id);
    if (list) list.push(row);
    else byProvider.set(row.provider_id, [row]);
  }

  let recovered = 0;
  let rupees = 0;

  for (const [providerId, tranches] of Array.from(byProvider)) {
    let balance = await outstanding(providerId);
    if (balance <= 0) continue;

    for (const item of tranches) {
      if (balance <= 0) break;
      // The same `applyRedoRecovery` for both tranches: "a quarter" is
      // published, and two implementations of it would differ by date.
      const step = applyRedoRecovery({
        earning: Number(item.earning),
        outstanding: balance,
      });
      if (step.recovered <= 0) continue;

      await pg.admin.query(
        `insert into public.provider_ledger
           (provider_id, booking_id, tranche, kind, amount_rupees, note)
         values ($1, $2, $3, 'recovery', $4, $5)`,
        [
          providerId,
          item.id,
          item.tranche,
          step.recovered,
          `Recovered from ${item.tranche === "holdback" ? "the held part of" : "the payout on"} ${item.reference} — a quarter of it, against what is owed`,
        ],
      );

      balance = step.remaining;
      recovered += 1;
      rupees += step.recovered;
    }
  }

  return { recovered, rupees };
}

/**
 * A professional nobody else's test has touched.
 *
 * The two fixture providers carry balances from the cases above, and a tranche
 * test that inherited one would measure a quarter of the wrong debt. Cheaper to
 * make a new one than to reason about the order tests run in.
 */
let freshCount = 0;
async function freshProvider(name: string): Promise<string> {
  freshCount += 1;
  const userId = `eeeeeeee-9${String(freshCount).padStart(3, "0")}-4555-8555-eeeeeeeeeeee`;
  await pg.admin.query("insert into auth.users (id) values ($1)", [userId]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, $2, $3, 'provider')
     on conflict (id) do update set role = excluded.role`,
    [userId, name, `+97798130000${freshCount}`],
  );
  const { rows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, $2, 1000) returning id`,
    [userId, name],
  );
  return rows[0].id as string;
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
    ).rejects.toThrow(/provider_ledger_recovery_tranche_idx|duplicate key/i);
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

/**
 * A booking that pays twice, because its guarantee outlives its payout.
 *
 * THE UNIT CHANGED AND THE INDEX HAD TO CHANGE WITH IT.
 * `provider_ledger_recovery_once_idx` was unique on `booking_id` alone, and its
 * own comment said a booking IS what a payout is here. With a quarter held back
 * for 30 days that is false: one booking, two payable dates, two payouts.
 *
 * AND IT WOULD HAVE FAILED SILENTLY. The sweep reads existing recovery rows
 * into a filter and drops matching bookings BEFORE attempting any insert — so
 * under the old index the released holdback would have been paid whole, with no
 * row written, no unique violation raised and nothing logged at all.
 */
let trancheProvider: string;

describe("a payout is a tranche, not a booking", () => {
  it("recovers a quarter of what lands now, leaving the held part alone", async () => {
    const provider = await freshProvider('Tranche One');
    trancheProvider = provider;
    await owe(provider, 50_000);

    // Rs 40,000 earned on a painting job: 30,000 now, 10,000 in 30 days.
    await duePayout("SK-TR01", provider, 40_000, 1, {
      rupees: 10_000,
      releasedDaysAgo: null, // still held
    });

    const result = await sweep();
    expect(result.recovered).toBe(1);
    // A quarter of the 30,000 arriving, NOT of the 40,000 settled. The
    // published sentence is about what lands in their account.
    expect(result.rupees).toBe(7_500);

    const { rows } = await pg.admin.query(
      `select l.tranche from public.provider_ledger l
         join public.bookings b on b.id = l.booking_id
        where l.kind = 'recovery' and b.reference = 'SK-TR01'`,
    );
    expect(rows.map((r) => r.tranche)).toEqual(["main"]);
  });

  it("recovers again when the held part is released, which the old index forbade", async () => {
    // 30 days on. The same booking, its second payout now payable.
    await pg.admin.query(
      `update public.bookings
          set payout_holdback_until = now() - interval '1 day'
        where reference = 'SK-TR01'`,
    );

    const result = await sweep();
    expect(result.recovered).toBe(1);
    // A quarter of the 10,000 released.
    expect(result.rupees).toBe(2_500);

    const { rows } = await pg.admin.query(
      `select l.tranche, l.amount_rupees from public.provider_ledger l
         join public.bookings b on b.id = l.booking_id
        where l.kind = 'recovery' and b.reference = 'SK-TR01'
        order by l.tranche`,
    );
    expect(rows.map((r) => r.tranche)).toEqual(["holdback", "main"]);
    // 7,500 + 2,500 = a quarter of the whole 40,000 job, taken across two
    // payouts rather than a third of one of them.
    expect(rows.reduce((sum, r) => sum + Number(r.amount_rupees), 0)).toBe(10_000);
  });

  it("is idempotent across both tranches", async () => {
    const before = await outstanding(trancheProvider);
    const again = await sweep();
    expect(again.recovered).toBe(0);
    expect(await outstanding(trancheProvider)).toBe(before);
  });

  /*
   * THE INDEX IS THE RULE, THE FILTER IS AN OPTIMISATION. Proven by going
   * around the filter entirely and inserting straight into the ledger.
   */
  it("refuses a second recovery on the same tranche at the database", async () => {
    const { rows } = await pg.admin.query(
      "select id, provider_id from public.bookings where reference = 'SK-TR01'",
    );
    await expect(
      pg.admin.query(
        `insert into public.provider_ledger
           (provider_id, booking_id, tranche, kind, amount_rupees, note)
         values ($1, $2, 'holdback', 'recovery', 1, 'a second bite')`,
        [rows[0].provider_id, rows[0].id],
      ),
    ).rejects.toThrow(/provider_ledger_recovery_tranche_idx|duplicate key/i);
  });

  it("allows the two tranches of one booking to differ, which is the point", async () => {
    // Same booking id, both tranches present, and the index permits exactly
    // that — it is unique on the pair, not on the booking.
    const { rows } = await pg.admin.query(
      `select count(distinct tranche) as kinds, count(*) as total
         from public.provider_ledger l
         join public.bookings b on b.id = l.booking_id
        where l.kind = 'recovery' and b.reference = 'SK-TR01'`,
    );
    expect(Number(rows[0].kinds)).toBe(2);
    expect(Number(rows[0].total)).toBe(2);
  });
});

describe("held money is not payable until its date", () => {
  it("leaves a holdback alone while it is still held", async () => {
    const provider = await freshProvider('Tranche Two');
    await owe(provider, 50_000);

    // 20,000 earned, 5,000 held and not yet released.
    await duePayout("SK-TR02", provider, 20_000, 1, {
      rupees: 5_000,
      releasedDaysAgo: null,
    });

    const result = await sweep();
    // Only the main tranche: a quarter of the 15,000 arriving.
    expect(result.recovered).toBe(1);
    expect(result.rupees).toBe(3_750);

    const { rows } = await pg.admin.query(
      `select l.tranche from public.provider_ledger l
         join public.bookings b on b.id = l.booking_id
        where l.kind = 'recovery' and b.reference = 'SK-TR02'`,
    );
    expect(rows.map((r) => r.tranche)).toEqual(["main"]);
  });

  /*
   * THE BALANCE READ ONCE AND CARRIED, with a new way for the old bug to come
   * back: two tranches of the SAME booking can now be payable in one sweep, so
   * a balance read per tranche would take two quarters out of a debt that had
   * one quarter left in it.
   */
  it("carries one balance across both tranches of one booking", async () => {
    const provider = await freshProvider('Tranche Three');
    // Exactly enough for one quarter of the first tranche and no more.
    await owe(provider, 3_000);

    // Both dates already past: the whole job is payable in this one sweep.
    await duePayout("SK-TR03", provider, 40_000, 2, {
      rupees: 10_000,
      releasedDaysAgo: 1,
    });

    const result = await sweep();
    // 3,000 is less than a quarter of the 30,000 main tranche, so the debt
    // clears there and the holdback tranche takes nothing.
    expect(result.rupees).toBe(3_000);
    expect(await outstanding(provider)).toBe(0);

    const { rows } = await pg.admin.query(
      `select l.tranche from public.provider_ledger l
         join public.bookings b on b.id = l.booking_id
        where l.kind = 'recovery' and b.reference = 'SK-TR03'`,
    );
    expect(rows.map((r) => r.tranche)).toEqual(["main"]);
  });
});

describe("the columns are shaped together", () => {
  it("refuses a held amount with no release date", async () => {
    const { rows } = await pg.admin.query(
      "select id from public.bookings where reference = 'SK-TR02'",
    );
    await expect(
      pg.admin.query(
        `update public.bookings
            set payout_holdback_rupees = 500, payout_holdback_until = null
          where id = $1`,
        [rows[0].id],
      ),
    ).rejects.toThrow(/bookings_holdback_shape/i);
  });

  it("refuses a release date with nothing held", async () => {
    const { rows } = await pg.admin.query(
      "select id from public.bookings where reference = 'SK-TR02'",
    );
    await expect(
      pg.admin.query(
        `update public.bookings
            set payout_holdback_rupees = null, payout_holdback_until = now()
          where id = $1`,
        [rows[0].id],
      ),
    ).rejects.toThrow(/bookings_holdback_shape/i);
  });
});
