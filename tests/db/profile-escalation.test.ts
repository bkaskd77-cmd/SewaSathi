import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * A customer cannot promote themselves, and the hole this closes was live.
 *
 * WHAT WAS WRONG. `profiles` has one update policy — "Profiles are updatable by
 * their owner", `using ((select auth.uid()) = id)` — and Supabase grants
 * `authenticated` table-wide UPDATE on every table in `public`. RLS is
 * row-level, so that pair let the owner write EVERY column on their own row,
 * `role` included, and production had no BEFORE UPDATE trigger on the table at
 * all. One request from any signed-in customer's browser:
 *
 *     PATCH /rest/v1/profiles?id=eq.<self>   {"role":"admin"}
 *
 * Both `using` and `with check` pass, because `id` never changes. `is_admin()`
 * then returns true, and six policies open behind it — every profile, every
 * booking, every payment, every triage log, and the identity documents in the
 * private bucket. It is the same class CLAUDE.md records for `bookings` ("a
 * policy that lets somebody update a row lets them update every column on it"),
 * one table over, and it was found while adding the activity opt-out — which
 * would have been the product's first customer-facing write to this table.
 *
 * THE FIX IS A COLUMN GRANT, not a trigger. `20260927000005` revokes UPDATE
 * from `anon` and `authenticated` and grants it back on the three columns a
 * browser legitimately writes. A grant is refused before a row is touched and
 * needs no service-role bypass — `enforce_booking_immutability` needs one
 * because the service role writes the columns it guards, and `role` here is
 * written by `lib/data/review.ts` under `createAdminClient()`, which holds
 * `service_role`'s own grants and is unaffected.
 *
 * THE HALF THAT MUST NOT BREAK IS ASSERTED TOO. `components/auth/
 * onboarding-form.tsx` writes `full_name` and `preferred_language` from the
 * BROWSER, and `/account` writes `hide_from_activity` the same way. A revoke
 * that took those with it would lock every new customer out of onboarding, so
 * the three allowed writes are executed here beside the four refusals.
 *
 * TO PROVE IT BITES: re-add `grant update on public.profiles to authenticated`
 * at the end of that migration and the four refusals go red together.
 */

const ANITA = "11111111-a111-4111-8111-111111111111";
const BINA = "22222222-b222-4222-8222-222222222222";

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name] of [
    [ANITA, "Anita Shrestha"],
    [BINA, "Bina Tamang"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, 'customer')
       on conflict (id) do update
         set full_name = excluded.full_name, phone = excluded.phone`,
      [id, name, `+9779800000${id.slice(0, 2)}`],
    );
  }
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

/** What the row actually holds, read as the owner so RLS is out of the way. */
async function roleOf(id: string): Promise<string> {
  const { rows } = await pg.admin.query(
    "select role, phone, full_name, preferred_language, hide_from_activity from public.profiles where id = $1",
    [id],
  );
  return rows[0].role as string;
}

describe("a customer cannot write the columns that grant power", () => {
  it("refuses a self-promotion to admin", async () => {
    const anita = await pg.asUser(ANITA);

    await expect(
      anita.query("update public.profiles set role = 'admin' where id = $1", [
        ANITA,
      ]),
    ).rejects.toThrow(/permission denied/i);

    // The refusal is the point, but so is the row: a rejected statement that
    // had already written something would be worse than no guard at all.
    expect(await roleOf(ANITA)).toBe("customer");
  });

  it("refuses it through a bare update with no where clause too", async () => {
    // RLS would have limited this to their own row anyway; the grant refuses
    // the statement before any row is considered, which is the difference.
    const anita = await pg.asUser(ANITA);

    await expect(
      anita.query("update public.profiles set role = 'admin'"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a change to the phone number", async () => {
    // The phone is the login identifier and the number a professional is given
    // at the door. It is written by the signup trigger and by nothing else.
    const anita = await pg.asUser(ANITA);

    await expect(
      anita.query("update public.profiles set phone = $2 where id = $1", [
        ANITA,
        "+9779811111111",
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a change to the id", async () => {
    const anita = await pg.asUser(ANITA);

    await expect(
      anita.query("update public.profiles set id = $2 where id = $1", [
        ANITA,
        BINA,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("the writes a browser legitimately makes still work", () => {
  it("lets somebody set their own name and language — onboarding does this", async () => {
    const anita = await pg.asUser(ANITA);

    await anita.query(
      `update public.profiles
         set full_name = $2, preferred_language = 'ne'
       where id = $1`,
      [ANITA, "Anita S."],
    );

    const { rows } = await pg.admin.query(
      "select full_name, preferred_language from public.profiles where id = $1",
      [ANITA],
    );
    expect(rows[0].full_name).toBe("Anita S.");
    expect(rows[0].preferred_language).toBe("ne");
  });

  it("lets somebody opt out of the activity strip", async () => {
    const anita = await pg.asUser(ANITA);

    await anita.query(
      "update public.profiles set hide_from_activity = true where id = $1",
      [ANITA],
    );

    const { rows } = await pg.admin.query(
      "select hide_from_activity from public.profiles where id = $1",
      [ANITA],
    );
    expect(rows[0].hide_from_activity).toBe(true);
  });

  it("still refuses somebody else's row, which is the policy's half", async () => {
    const anita = await pg.asUser(ANITA);

    // An allowed column on a row that is not theirs: the grant permits the
    // statement and the policy matches nothing, so it writes zero rows rather
    // than raising. "Not yours" and "not found" are the same answer.
    const result = await anita.query(
      "update public.profiles set full_name = $2 where id = $1",
      [BINA, "Not Bina"],
    );
    expect(result.rowCount).toBe(0);

    const { rows } = await pg.admin.query(
      "select full_name from public.profiles where id = $1",
      [BINA],
    );
    expect(rows[0].full_name).toBe("Bina Tamang");
  });
});
