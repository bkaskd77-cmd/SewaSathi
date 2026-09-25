import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PAYOUT_RULES } from "@/lib/payments/payout";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * The end of a balance nobody can collect, against the real schema.
 *
 * WHY A DEBT NEEDS AN END. `provider_outstanding` sums a ledger that only
 * grows, so without a write-off a professional who left two years ago still
 * owes us on a screen nobody will ever act on. There is no card on file, no
 * direct debit and no way to collect a rupee of it — `lib/payments/payout.ts`
 * refuses backward recovery for exactly that reason — so an open balance
 * against somebody who has gone is a number pretending to be an asset.
 *
 * WHAT THIS FILE IS REALLY GUARDING. The dangerous mistake here is not the
 * arithmetic, it is the state: closing a dormant listing must never be
 * recorded the way a listing removed for cause is. `removed_at` is step 5 of
 * the enforcement ladder, and writing it for somebody who simply stopped
 * taking work would put a false finding into every future report. Every case
 * below asserts `removed_at` is still null.
 *
 * Same decision as `redo-recovery.test.ts`: nothing runs against production,
 * because `provider_ledger` is append-only for every caller including the
 * service role and a demonstration row could never be removed.
 */

let pg: Harness;

const ANITA = "aaaaaaaa-9111-4111-8111-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-9222-4222-8222-bbbbbbbbbbbb";
const SITA = "dddddddd-9444-4444-8444-dddddddddddd";

let krishnaProvider: string;
let sitaProvider: string;
let anitaAddress: string;

async function owe(providerId: string, rupees: number): Promise<void> {
  await pg.admin.query(
    `insert into public.provider_ledger (provider_id, kind, amount_rupees, note)
     values ($1, 'redo_debt', $2, 'Refund on a job')`,
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

/** A finished job, completed however long ago. The clock reads this. */
async function completedJob(
  reference: string,
  providerId: string,
  monthsAgo: number,
): Promise<void> {
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
        set completed_at = now() - ($2 || ' months')::interval
      where id = $1`,
    [id, String(monthsAgo)],
  );
}

async function listing(providerId: string): Promise<{
  is_active: boolean;
  closed_at: string | null;
  closed_reason: string | null;
  removed_at: string | null;
}> {
  const { rows } = await pg.admin.query(
    "select is_active, closed_at, closed_reason, removed_at from public.providers where id = $1",
    [providerId],
  );
  return rows[0];
}

/**
 * The write-off sweep, in SQL, matching `sweepWriteOffs` in
 * lib/data/recovery.ts.
 *
 * The same limit as the recovery suite and named for the same reason: this
 * harness is a bare Postgres with the migrations applied and no PostgREST in
 * front of it, so the *rule* is proven here and the Supabase query builder is
 * not. The horizon is imported rather than restated, because that is the
 * number that decides whether somebody's listing closes.
 */
async function sweep(): Promise<{ closed: number; rupees: number }> {
  const { rows: open } = await pg.admin.query(
    `select id from public.providers
      where closed_at is null and removed_at is null`,
  );

  let closed = 0;
  let rupees = 0;

  for (const provider of open) {
    const owed = await outstanding(provider.id);
    if (owed <= 0) continue;

    const { rows: last } = await pg.admin.query(
      `select completed_at from public.bookings
        where provider_id = $1 and status = 'completed'
          and completed_at is not null
        order by completed_at desc limit 1`,
      [provider.id],
    );
    if (last.length === 0) continue;

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - PAYOUT_RULES.writeOffAfterMonths);
    if (new Date(last[0].completed_at).getTime() > cutoff.getTime()) continue;

    await pg.admin.query(
      `insert into public.provider_ledger
         (provider_id, kind, amount_rupees, note)
       values ($1, 'write_off', $2, $3)`,
      [
        provider.id,
        owed,
        `Written off after ${PAYOUT_RULES.writeOffAfterMonths} months with no completed job`,
      ],
    );

    await pg.admin.query(
      `update public.providers
          set is_active = false, closed_at = now(), closed_reason = 'dormant'
        where id = $1 and closed_at is null`,
      [provider.id],
    );

    closed += 1;
    rupees += owed;
  }

  return { closed, rupees };
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

describe("a balance that is still somebody's to pay", () => {
  it("leaves a professional who worked last month entirely alone", async () => {
    await owe(krishnaProvider, 34_000);
    await completedJob("SK-WO01", krishnaProvider, 1);

    const result = await sweep();

    expect(result).toEqual({ closed: 0, rupees: 0 });
    expect(await outstanding(krishnaProvider)).toBe(34_000);
    expect((await listing(krishnaProvider)).is_active).toBe(true);
  });

  /**
   * ELEVEN MONTHS IS NOT TWELVE. The horizon has to be long enough that an
   * ordinary gap — a season away, an illness, a year on a building site — does
   * not end somebody's listing, so the boundary is worth pinning on the side
   * that protects them.
   */
  it("leaves one who worked eleven months ago alone", async () => {
    await owe(sitaProvider, 5_000);
    await completedJob("SK-WO02", sitaProvider, 11);

    const result = await sweep();

    expect(result).toEqual({ closed: 0, rupees: 0 });
    expect(await outstanding(sitaProvider)).toBe(5_000);
    expect((await listing(sitaProvider)).is_active).toBe(true);
  });
});

describe("a balance nobody is going to pay", () => {
  it("writes off the whole balance and closes the listing", async () => {
    // Sita's last job moves to thirteen months ago: she has gone.
    await pg.admin.query(
      `update public.bookings
          set completed_at = now() - interval '13 months'
        where reference = 'SK-WO02'`,
    );

    const result = await sweep();

    expect(result).toEqual({ closed: 1, rupees: 5_000 });
    expect(await outstanding(sitaProvider)).toBe(0);

    const row = await listing(sitaProvider);
    expect(row.is_active).toBe(false);
    expect(row.closed_reason).toBe("dormant");
    expect(row.closed_at).not.toBeNull();
  });

  /**
   * THE ONE THAT MATTERS MOST. A dormant close is not a removal. `removed_at`
   * is step 5 of the enforcement ladder — confirmed, deliberate
   * under-reporting — and setting it for somebody who simply stopped taking
   * work writes a false finding into every screen and report that reads it.
   */
  it("does not mark them as removed for cause", async () => {
    expect((await listing(sitaProvider)).removed_at).toBeNull();
  });

  it("leaves the professional who is still working untouched", async () => {
    // Krishna owes far more and is not closed, because he is still here.
    expect(await outstanding(krishnaProvider)).toBe(34_000);
    expect((await listing(krishnaProvider)).is_active).toBe(true);
  });

  it("does nothing on a second run", async () => {
    const again = await sweep();
    expect(again).toEqual({ closed: 0, rupees: 0 });
    expect(await outstanding(sitaProvider)).toBe(0);
  });

  /**
   * THE CASE THE `closed_at is null` PREDICATE ACTUALLY GUARDS, and it is not
   * the one that was assumed.
   *
   * Removing the predicate does NOT make a second sweep re-close anybody: the
   * balance is zero after a write-off, so they are skipped anyway — proven by
   * removing it and watching every other case stay green. Idempotency comes
   * from the zero balance, not from the predicate, and the comment in
   * `lib/data/recovery.ts` says so rather than claiming otherwise.
   *
   * What the predicate guards is a listing that is STILL CLOSED and acquires a
   * new balance — a claim adjudicated on an old job weeks after the listing
   * shut. Without it the sweep would write that off and stamp `closed_at`
   * again, moving the recorded date of a closure that happened months earlier.
   * The row would then say the listing closed on a day it did not.
   */
  it("never looks at a listing that is still closed", async () => {
    const before = await listing(sitaProvider);
    expect(before.closed_at).not.toBeNull();

    // A claim on one of her old jobs is adjudicated after she has gone.
    await owe(sitaProvider, 900);

    const result = await sweep();

    // Untouched: not written off, and — the point — `closed_at` is still the
    // day she actually closed.
    expect(result).toEqual({ closed: 0, rupees: 0 });
    expect(await outstanding(sitaProvider)).toBe(900);
    expect((await listing(sitaProvider)).closed_at).toEqual(before.closed_at);
  });

  it("cannot be edited or deleted afterwards, service role included", async () => {
    await expect(
      pg.admin.query(
        "update public.provider_ledger set amount_rupees = 1 where kind = 'write_off'",
      ),
    ).rejects.toThrow();
    await expect(
      pg.admin.query("delete from public.provider_ledger where kind = 'write_off'"),
    ).rejects.toThrow();
  });
});

describe("the shape of a closed listing", () => {
  it("refuses a date with no reason, or a reason with no date", async () => {
    // A `closed_at` nobody can account for, or a claim with no event behind
    // it. Either alone is a row a person cannot read a year later.
    await expect(
      pg.admin.query(
        "update public.providers set closed_at = now() where id = $1",
        [krishnaProvider],
      ),
    ).rejects.toThrow(/providers_closed_shape/i);

    await expect(
      pg.admin.query(
        "update public.providers set closed_reason = 'dormant' where id = $1",
        [krishnaProvider],
      ),
    ).rejects.toThrow(/providers_closed_shape/i);
  });

  it("refuses a reason nobody has published", async () => {
    await expect(
      pg.admin.query(
        `update public.providers
            set closed_at = now(), closed_reason = 'because we felt like it'
          where id = $1`,
        [krishnaProvider],
      ),
    ).rejects.toThrow(/providers_closed_reason_known/i);
  });
});

describe("the horizon is the published one", () => {
  it("is twelve months, which is what /providers/standards says", async () => {
    expect(PAYOUT_RULES.writeOffAfterMonths).toBe(12);
  });
});
