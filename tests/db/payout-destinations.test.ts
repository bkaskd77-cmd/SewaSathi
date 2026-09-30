import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { destinationUsableFrom } from "@/lib/payments/destination";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * Where the money goes, against the real schema.
 *
 * THIS IS THE ONE TABLE IN THE PRODUCT WHOSE CONTENTS ARE SOMEBODY'S BANK
 * ACCOUNT. Two guarantees are worth more than the rest and both are database
 * facts rather than application ones:
 *
 *   RETIRE, NEVER EDIT — a payout must be able to name the destination that was
 *   live when it was sent. An edited row makes every historical payout point at
 *   today's answer, which is exactly the question somebody asks when their
 *   money went somewhere else.
 *
 *   NO BROWSER REACHES IT — the privilege is revoked rather than filtered by a
 *   policy, so the planner refuses before a row is considered. Every read is
 *   service-role and audited, and a SELECT policy would be a second path that
 *   writes no audit row.
 *
 * The immutability trigger has NO service-role bypass, unlike
 * `enforce_booking_immutability`. Every write here is service-role anyway, so a
 * bypass would leave the guard enforcing nothing — the same reasoning as
 * `refuse_rewrite` on `provider_ledger`.
 */

let pg: Harness;

const KRISHNA = "bbbbbbbb-9522-4522-8522-bbbbbbbbbbbb";
const ANITA = "aaaaaaaa-9511-4511-8511-aaaaaaaaaaaa";

let krishna: string;

async function addDestination(
  ref: string,
  kind = "bank",
): Promise<string> {
  const created = new Date();
  /*
   * Retire whatever is live first — which is the real change flow, not a test
   * convenience. The one-live index refused the second insert when this helper
   * did not, which is the index doing its job and the fixture modelling
   * something the product never does.
   */
  await pg.admin.query(
    `update public.payout_destinations set retired_at = now()
      where provider_id = $1 and retired_at is null`,
    [krishna],
  );
  const { rows } = await pg.admin.query(
    `insert into public.payout_destinations
       (provider_id, kind, account_ref, account_name, bank_name, usable_from)
     values ($1, $2, $3, 'Krishna Tamang', 'Nabil Bank', $4)
     returning id`,
    [krishna, kind, ref, destinationUsableFrom(created).toISOString()],
  );
  return rows[0].id as string;
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
      [id, name, `+9779815${id.slice(0, 6)}`, role],
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

describe("a destination is replaced, never edited", () => {
  it("refuses a change to where the money goes", async () => {
    const id = await addDestination("12345678");

    await expect(
      pg.admin.query(
        "update public.payout_destinations set account_ref = $1 where id = $2",
        ["99999999", id],
      ),
      "the account number was editable in place",
    ).rejects.toThrow(/replaced, not edited/i);
  });

  it("refuses the service role too, with no bypass", async () => {
    /*
     * `pg.admin` IS the owner — the harness's stand-in for
     * `createAdminClient()`. `enforce_booking_immutability` deliberately lets
     * the service role through because the server writes the columns it guards;
     * here every write is service-role, so the same bypass would mean the
     * trigger guards nothing at all.
     */
    const id = await addDestination("22345678");

    for (const [column, value] of [
      ["kind", "esewa"],
      ["account_name", "Someone Else"],
      ["usable_from", new Date().toISOString()],
    ] as const) {
      await expect(
        pg.admin.query(
          `update public.payout_destinations set ${column} = $1 where id = $2`,
          [value, id],
        ),
        `${column} was editable`,
      ).rejects.toThrow(/replaced, not edited/i);
    }
  });

  it("refuses a delete, because retiring is the only way out", async () => {
    const id = await addDestination("32345678");
    await expect(
      pg.admin.query("delete from public.payout_destinations where id = $1", [id]),
    ).rejects.toThrow(/retired, not deleted/i);
  });

  it("allows retiring, and refuses bringing it back", async () => {
    const id = await addDestination("42345678");

    await expect(
      pg.admin.query(
        "update public.payout_destinations set retired_at = now() where id = $1",
        [id],
      ),
    ).resolves.toBeDefined();

    await expect(
      pg.admin.query(
        "update public.payout_destinations set retired_at = null where id = $1",
        [id],
      ),
      "a replaced address could be resurrected",
    ).rejects.toThrow(/cannot be brought back/i);
  });

  it("records the first-payout confirmation once and refuses a second", async () => {
    const id = await addDestination("52345678");

    await pg.admin.query(
      `update public.payout_destinations
          set first_payout_confirmed_at = now(), first_payout_confirmed_by = $1
        where id = $2`,
      [ANITA, id],
    );

    await expect(
      pg.admin.query(
        "update public.payout_destinations set first_payout_confirmed_at = now() where id = $1",
        [id],
      ),
      "a second look overwrote the first person's name on the record",
    ).rejects.toThrow(/already recorded/i);
  });
});

describe("one live destination at a time", () => {
  it("refuses a second live row for the same professional", async () => {
    /*
     * A partial unique index rather than an application check — the
     * `our_reference` idiom. Two concurrent changes are refused by the
     * database rather than remembered against by whichever caller read last.
     */
    const { rows } = await pg.admin.query(
      `insert into public.providers (profile_id, display_name, base_rate)
       values ($1, 'One Live', 700) returning id`,
      [ANITA],
    );
    const provider = rows[0].id as string;
    const usable = destinationUsableFrom(new Date()).toISOString();

    await pg.admin.query(
      `insert into public.payout_destinations
         (provider_id, kind, account_ref, account_name, usable_from)
       values ($1, 'esewa', '9779841111111', 'One Live', $2)`,
      [provider, usable],
    );

    await expect(
      pg.admin.query(
        `insert into public.payout_destinations
           (provider_id, kind, account_ref, account_name, usable_from)
         values ($1, 'khalti', '9779842222222', 'One Live', $2)`,
        [provider, usable],
      ),
    ).rejects.toThrow(/payout_destinations_one_live_idx/);

    // Retiring the first makes room for the next, which is the whole point of
    // retire-rather-than-edit.
    await pg.admin.query(
      "update public.payout_destinations set retired_at = now() where provider_id = $1",
      [provider],
    );
    await expect(
      pg.admin.query(
        `insert into public.payout_destinations
           (provider_id, kind, account_ref, account_name, usable_from)
         values ($1, 'khalti', '9779842222222', 'One Live', $2)`,
        [provider, usable],
      ),
    ).resolves.toBeDefined();
  });
});

describe("no browser reaches it", () => {
  it("refuses a signed-in professional reading their own destination", async () => {
    /*
     * Deliberately their OWN — the case somebody would be tempted to open with
     * a policy. They see it masked on a server-rendered page instead, which
     * shows them nothing they do not already know and keeps the number out of a
     * response, a cache and a screenshot.
     */
    const asProvider = await pg.asUser(KRISHNA);
    await expect(
      asProvider.query("select account_ref from public.payout_destinations"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a stranger", async () => {
    const anon = await pg.asAnon();
    await expect(
      anon.query("select 1 from public.payout_destinations"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a signed-in customer writing one", async () => {
    const asCustomer = await pg.asUser(ANITA);
    await expect(
      asCustomer.query(
        `insert into public.payout_destinations
           (provider_id, kind, account_ref, account_name, usable_from)
         values ($1, 'esewa', '9779843333333', 'Not Theirs', now())`,
        [krishna],
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
