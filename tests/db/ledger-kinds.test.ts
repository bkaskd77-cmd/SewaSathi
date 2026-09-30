import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GUARANTEE_KINDS, LEDGER_KINDS, MONEY_KINDS } from "@/lib/config/ledger";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * Two accounts on one ledger, against the real schema.
 *
 * WHAT THIS IS GUARDING, and it is not arithmetic. `provider_outstanding` used
 * to sum `redo_debt` positive and — through a catch-all `else` — every other
 * kind NEGATIVE. That was known and written down twice, in
 * `lib/payments/refund.ts` and `lib/data/claims.ts`, in both cases as the reason
 * a feature did not add a ledger kind: a new one "would have quietly reduced
 * what somebody owed". Payouts need kinds, so the `else` is gone and those two
 * comments are rewritten in the same commit.
 *
 * THE DANGER THE REWRITE INTRODUCES IS SILENCE. A kind filed under neither
 * function inserts cleanly, passes the constraint, and is counted by nothing —
 * money that exists on the ledger and appears in no balance. Nothing throws and
 * no screen looks wrong. So the partition is asserted from `LEDGER_KINDS`
 * itself rather than case by case, and the explicit rewrite is proven by
 * restoring the old body and watching a case go red: an explicit `case` nothing
 * can tell apart from the catch-all it replaced would be worth nothing.
 *
 * Same decision as `write-off.test.ts` and `redo-recovery.test.ts`: nothing
 * runs against production, because `provider_ledger` is append-only for every
 * caller including the service role and a demonstration row could never be
 * removed.
 */

let pg: Harness;

const ANITA = "aaaaaaaa-9311-4311-8311-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-9322-4322-8322-bbbbbbbbbbbb";

let krishna: string;

/** The current definition, so a break can be undone exactly. */
const EXPLICIT_OUTSTANDING = `
create or replace function public.provider_outstanding(target uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(0, coalesce(sum(
    case kind
      when 'redo_debt' then amount_rupees
      when 'recovery'  then -amount_rupees
      when 'write_off' then -amount_rupees
      else 0
    end), 0))::integer
  from public.provider_ledger where provider_id = target;
$$;`;

/** What it was before this migration: the catch-all. */
const CATCH_ALL_OUTSTANDING = `
create or replace function public.provider_outstanding(target uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(0, coalesce(sum(
    case when kind = 'redo_debt' then amount_rupees else -amount_rupees end
  ), 0))::integer
  from public.provider_ledger where provider_id = target;
$$;`;

async function entry(kind: string, rupees: number): Promise<void> {
  await pg.admin.query(
    `insert into public.provider_ledger (provider_id, kind, amount_rupees, note)
     values ($1, $2, $3, 'fixture')`,
    [krishna, kind, rupees],
  );
}

async function outstanding(): Promise<number> {
  const { rows } = await pg.admin.query(
    "select public.provider_outstanding($1) as owed",
    [krishna],
  );
  return Number(rows[0].owed);
}

/** Payout and reversal rows on the fixture, for delta assertions. */
async function payoutRowCount(): Promise<number> {
  const { rows } = await pg.admin.query(
    `select count(*)::int as n from public.provider_ledger
      where provider_id = $1 and kind in ('payout', 'payout_reversal')`,
    [krishna],
  );
  return Number(rows[0].n);
}

async function balance(): Promise<number> {
  const { rows } = await pg.admin.query(
    "select public.provider_balance($1) as net",
    [krishna],
  );
  return Number(rows[0].net);
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
      [id, name, `+9779813${id.slice(0, 6)}`, role],
    );
  }

  const { rows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, 'Krishna Tamang', 900) returning id`,
    [KRISHNA],
  );
  krishna = rows[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the guarantee account and the money account are separate", () => {
  it("leaves the guarantee balance untouched by every money kind", async () => {
    await entry("redo_debt", 34_000);
    expect(await outstanding()).toBe(34_000);

    for (const kind of MONEY_KINDS) {
      await entry(kind, 1_000);
    }

    expect(
      await outstanding(),
      "a money kind moved the guarantee balance",
    ).toBe(34_000);
  });

  /**
   * THE BREAK-IT-ON-PURPOSE STEP, and here it is the only thing that gives the
   * case above any value.
   *
   * Naming the kinds explicitly and leaving the catch-all in place produce
   * identical results on every row that existed before this migration. So the
   * rewrite is proven by putting the old body back and watching the same
   * assertion fail — without this, "explicit kinds" is a claim about the source
   * rather than a fact about behaviour.
   */
  it("would have been wrong under the catch-all it replaced", async () => {
    await pg.admin.query(CATCH_ALL_OUTSTANDING);
    try {
      // The five money rows above are 1,000 each and all read as negative.
      expect(await outstanding()).toBe(34_000 - 5_000);
    } finally {
      await pg.admin.query(EXPLICIT_OUTSTANDING);
    }

    expect(await outstanding()).toBe(34_000);
  });

  it("reports a negative balance while the guarantee account reads zero", async () => {
    /*
     * A WEEK THAT WAS ALL CASH. The professional collected from customers and
     * owes us the fee; nothing is owed on a guarantee. `provider_balance` must
     * be able to say so, and `provider_outstanding` must keep its floor — the
     * two disagreeing is the entire reason there are two functions.
     */
    const { rows } = await pg.admin.query(
      `insert into public.providers (profile_id, display_name, base_rate)
       values ($1, 'Cash Week', 800) returning id`,
      [ANITA],
    );
    const cashOnly = rows[0].id as string;

    await pg.admin.query(
      `insert into public.provider_ledger (provider_id, kind, amount_rupees, note)
       values ($1, 'commission_due', 2_400, 'fixture'),
              ($1, 'earning', 400, 'fixture')`,
      [cashOnly],
    );

    const { rows: net } = await pg.admin.query(
      `select public.provider_balance($1) as net,
              public.provider_outstanding($1) as owed`,
      [cashOnly],
    );

    expect(Number(net[0].net)).toBe(-2_000);
    expect(Number(net[0].owed)).toBe(0);
  });

  it("counts a failed payout's reversal back, rather than deleting the payout", async () => {
    const rowsBefore = await payoutRowCount();
    const before = await balance();
    await entry("payout", 5_000);
    expect(await balance()).toBe(before - 5_000);

    await entry("payout_reversal", 5_000);
    expect(await balance(), "a reversal did not restore the balance").toBe(
      before,
    );

    /*
     * BOTH ROWS SURVIVE. The payout row is the evidence a remittance was
     * attempted, which is what somebody chasing a missing payment needs — so
     * the reversal must add a row rather than remove one.
     *
     * Asserted as a DELTA, not a total: this fixture already carries a payout
     * and a reversal from the money-kinds case above, and pinning an absolute
     * count made this pass or fail on what an unrelated case happened to
     * insert. That is the same blindness as a test written against a constant
     * the code also reads.
     */
    expect(await payoutRowCount()).toBe(rowsBefore + 2);
  });
});

describe("the aggregates are server-side only", () => {
  /**
   * WHAT WAS OPEN, AND WHY A POLICY DID NOT CLOSE IT.
   *
   * `provider_ledger`'s policies are right — a professional reads their own
   * rows, an admin reads all. But both aggregates are `security definer`, so
   * they never consult a policy, and both had `execute` for `authenticated`.
   * Any signed-in customer could name any professional's id and read their
   * guarantee debt and money position. Proven against production before the
   * fix: the call returned a row rather than being refused.
   *
   * That is `listBookings()` one layer down. RLS is a floor; a definer function
   * standing on it answers only to its own grant. So the guard is the GRANT,
   * asserted here as the caller actually experiences it, and the break-test
   * below is what stops this passing for the wrong reason.
   */
  it("refuses a signed-in caller naming somebody else's id", async () => {
    const asCustomer = await pg.asUser(ANITA);

    for (const fn of ["provider_outstanding", "provider_balance"]) {
      await expect(
        asCustomer.query(`select public.${fn}($1)`, [krishna]),
        `${fn} answered a caller who is not that provider`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("refuses them even when the caller IS that provider", async () => {
    /*
     * Deliberate, and the reason the fix is a revoke rather than an ownership
     * check inside the function. Nothing in the product calls these from a
     * browser: both call sites hold the service role, and the professional's
     * money view is server-rendered. A grant that exists for nobody is a grant
     * that only an attacker can use.
     */
    const asProvider = await pg.asUser(KRISHNA);

    await expect(
      asProvider.query("select public.provider_balance($1)", [krishna]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("still answers the service role", async () => {
    // The half that must keep working: `pg.admin` is the owner, standing in for
    // `createAdminClient()`. A revoke that broke this would have taken the
    // provider dashboard and the claim signals down with it.
    await expect(
      pg.admin.query("select public.provider_balance($1) as net", [krishna]),
    ).resolves.toBeDefined();
  });
});

describe("the constraint and the append-only guard cover the new kinds", () => {
  it("accepts every kind the TypeScript list names", async () => {
    for (const kind of LEDGER_KINDS) {
      await expect(
        pg.admin.query(
          `insert into public.provider_ledger (provider_id, kind, amount_rupees)
           values ($1, $2, 100)`,
          [krishna, kind],
        ),
        `${kind} was refused by the constraint`,
      ).resolves.toBeDefined();
    }
  });

  it("refuses a kind nobody declared", async () => {
    await expect(
      pg.admin.query(
        `insert into public.provider_ledger (provider_id, kind, amount_rupees)
         values ($1, 'commission_returned', 100)`,
        [krishna],
      ),
    ).rejects.toThrow(/provider_ledger_kind_check/);
  });

  it("still refuses UPDATE and DELETE on a money row, as the service role", async () => {
    /*
     * The append-only trigger predates this migration and is not touched by it.
     * What is new is the rows it now guards: a payout row that could be edited
     * is a payment record that proves nothing.
     */
    const { rows } = await pg.admin.query(
      `insert into public.provider_ledger (provider_id, kind, amount_rupees)
       values ($1, 'payout', 700) returning id`,
      [krishna],
    );
    const id = rows[0].id as string;

    await expect(
      pg.admin.query(
        "update public.provider_ledger set amount_rupees = 1 where id = $1",
        [id],
      ),
    ).rejects.toThrow();

    await expect(
      pg.admin.query("delete from public.provider_ledger where id = $1", [id]),
    ).rejects.toThrow();
  });

  it("files every declared kind under exactly one account", () => {
    // The same partition as the unit test, asserted here too because this is
    // the file somebody edits when they add a kind to the constraint.
    const guarantee = new Set<string>(GUARANTEE_KINDS);
    const money = new Set<string>(MONEY_KINDS);
    for (const kind of LEDGER_KINDS) {
      expect(
        guarantee.has(kind) !== money.has(kind),
        `${kind} is counted by neither account or by both`,
      ).toBe(true);
    }
  });
});
