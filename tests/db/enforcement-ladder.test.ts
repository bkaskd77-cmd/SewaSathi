import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The published ladder, proven by setting a step and watching something change.
 *
 * WHY THIS FILE IS THE POINT OF THE WHOLE CHANGE. `/providers/standards`
 * publishes five steps in both languages, linked from `/providers/join` before
 * anybody signs up. Until 20261017000001 the schema could express one of them —
 * `removed_at`, written by nothing anywhere — and steps 3 and 4 had no state at
 * all. A column that can be set and changes nothing is a FALSE CONTROL: worse
 * than a missing feature, because somebody sets it and believes it worked.
 *
 * SO EVERY CASE HERE SETS A VALUE AND ASSERTS AN EFFECT, never that a column
 * accepts a write. `customer_risk.banned_at` is the cautionary tale sitting one
 * table over: it has existed since 20260910000002, accepted writes the whole
 * time, and `createBooking` never consulted it once.
 */

let pg: Harness;

const KRISHNA = "11111111-1111-4111-8111-111111111111";
const ANITA = "22222222-2222-4222-8222-222222222222";

let providerId: string;
let addressId: string;

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [KRISHNA, "Krishna Tamang", "provider"],
    [ANITA, "Anita Shrestha", "customer"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779813${id.slice(0, 6)}`, role],
    );
  }

  const { rows: providerRows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate, service_areas)
     values ($1, 'Krishna Tamang', 900, array['lalitpur-4']) returning id`,
    [KRISHNA],
  );
  providerId = providerRows[0].id as string;

  await pg.admin.query(
    `insert into public.provider_categories (provider_id, category_slug)
     values ($1, 'plumbing')`,
    [providerId],
  );

  const { rows: addressRows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  addressId = addressRows[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

/** Ask the question the open-job policy asks, as the professional themselves. */
async function canServe(): Promise<boolean> {
  const client = await pg.asUser(KRISHNA);
  const { rows } = await client.query(
    "select public.provider_can_serve('plumbing', $1) as ok",
    [addressId],
  );
  return rows[0].ok === true;
}

async function setStep(step: number | null, reason: string | null) {
  await pg.admin.query(
    `update public.providers
        set enforcement_step = $2::smallint,
            enforcement_reason = $3::text,
            enforcement_at = case when $2::smallint is null then null else now() end,
            removed_at = case when $2::smallint = 5 then now() else null end
      where id = $1`,
    [providerId, step, reason],
  );
}

describe("step 3 closes the open pool, and only that", () => {
  /*
   * THE BASELINE IS ASSERTED FIRST, because a test whose "after" is false is
   * worthless if the "before" was false too — the professional might simply not
   * serve that ward. `ACTIVITY_FLOOR`'s blind-test lesson.
   */
  it("offers open jobs to a professional with no step in force", async () => {
    await setStep(null, null);
    expect(await canServe()).toBe(true);
  });

  it("stops offering them the moment step 3 is set", async () => {
    await setStep(3, "Three under-reported cash jobs in one week.");
    expect(await canServe()).toBe(false);
  });

  it("stops at step 4 and step 5 as well", async () => {
    await setStep(4, "Review opened.");
    expect(await canServe()).toBe(false);
    await setStep(5, "Confirmed, deliberate under-reporting.");
    expect(await canServe()).toBe(false);
  });

  /*
   * REVERSIBLE IS A PROPERTY OF THE FIRST FOUR STEPS AND IS WORTH ASSERTING.
   * The page says each step "is lifted after a conversation and a run of clean
   * jobs"; a lift that did not restore the pool would be a step nobody could
   * actually come back from.
   */
  it("offers them again once the step is lifted", async () => {
    await setStep(4, "Review opened.");
    expect(await canServe()).toBe(false);
    await setStep(null, null);
    expect(await canServe()).toBe(true);
  });
});

describe("a step cannot be recorded without the reason it was raised for", () => {
  /*
   * `/providers/standards` promises "At every step you can see what triggered
   * it, in numbers, and ask a person to look again." A row that cannot say why
   * is a step that cannot be appealed, which is the trap that page exists to
   * refuse — so the database refuses it rather than trusting every writer.
   */
  it("refuses a step with no words beside it", async () => {
    await setStep(null, null);
    await expect(
      pg.admin.query(
        `update public.providers
            set enforcement_step = 3, enforcement_at = now()
          where id = $1`,
        [providerId],
      ),
    ).rejects.toThrow(/providers_enforcement_shape/);
  });

  it("refuses a reason with no step", async () => {
    await expect(
      pg.admin.query(
        `update public.providers set enforcement_reason = 'because' where id = $1`,
        [providerId],
      ),
    ).rejects.toThrow(/providers_enforcement_shape/);
  });

  it("refuses a step that is not on the published ladder", async () => {
    await expect(
      pg.admin.query(
        `update public.providers
            set enforcement_step = 2,
                enforcement_reason = 'list position',
                enforcement_at = now()
          where id = $1`,
        [providerId],
      ),
    ).rejects.toThrow(/providers_enforcement_shape/);
  });
});

describe("removal and step 5 are one fact", () => {
  /*
   * `removed_at` PREDATES THE STEP COLUMN AND FOUR MODULES ALREADY READ IT —
   * `platform.ts`, `recovery.ts`, `verification.ts` and the claim-reassignment
   * policy. None of them knows about the step number, so the two disagreeing
   * would mean a listing removed everywhere except the ladder, or a step 5 that
   * four readers treat as active.
   */
  it("refuses removal without the step", async () => {
    await setStep(null, null);
    await expect(
      pg.admin.query(
        "update public.providers set removed_at = now() where id = $1",
        [providerId],
      ),
    ).rejects.toThrow(/providers_removed_is_step_five/);
  });

  it("refuses step 5 without the removal stamp", async () => {
    await expect(
      pg.admin.query(
        `update public.providers
            set enforcement_step = 5,
                enforcement_reason = 'confirmed',
                enforcement_at = now()
          where id = $1`,
        [providerId],
      ),
    ).rejects.toThrow(/providers_removed_is_step_five/);
  });

  it("accepts the pair", async () => {
    await setStep(5, "Confirmed, deliberate under-reporting.");
    const { rows } = await pg.admin.query(
      "select enforcement_step, removed_at from public.providers where id = $1",
      [providerId],
    );
    expect(rows[0].enforcement_step).toBe(5);
    expect(rows[0].removed_at).not.toBeNull();
    await setStep(null, null);
  });
});

describe("a customer suspension needs its reason too", () => {
  /*
   * THE COLUMNS ARE FIVE WEEKS OLDER THAN THIS CONSTRAINT and accepted anything
   * in between, including a ban with no reason — which is a person stopped from
   * booking with nothing to tell them.
   */
  it("refuses a ban with no reason", async () => {
    await expect(
      pg.admin.query(
        `insert into public.customer_risk (profile_id, banned_at)
         values ($1, now())`,
        [ANITA],
      ),
    ).rejects.toThrow(/customer_risk_ban_shape/);
  });

  it("refuses a reason with no ban", async () => {
    await expect(
      pg.admin.query(
        `insert into public.customer_risk (profile_id, banned_reason)
         values ($1, 'repeated no-shows')`,
        [ANITA],
      ),
    ).rejects.toThrow(/customer_risk_ban_shape/);
  });

  it("accepts the pair, and lets it be lifted", async () => {
    await pg.admin.query(
      `insert into public.customer_risk (profile_id, banned_at, banned_reason, banned_by)
       values ($1, now(), 'Four no-shows, two professionals out of pocket.', $2)
       on conflict (profile_id) do update
         set banned_at = excluded.banned_at,
             banned_reason = excluded.banned_reason,
             banned_by = excluded.banned_by`,
      [ANITA, KRISHNA],
    );

    const { rows: on } = await pg.admin.query(
      "select banned_at, banned_by from public.customer_risk where profile_id = $1",
      [ANITA],
    );
    expect(on[0].banned_at).not.toBeNull();
    expect(on[0].banned_by).toBe(KRISHNA);

    await pg.admin.query(
      `update public.customer_risk
          set banned_at = null, banned_reason = null, banned_by = null
        where profile_id = $1`,
      [ANITA],
    );

    const { rows: off } = await pg.admin.query(
      "select banned_at from public.customer_risk where profile_id = $1",
      [ANITA],
    );
    expect(off[0].banned_at).toBeNull();
  });
});
