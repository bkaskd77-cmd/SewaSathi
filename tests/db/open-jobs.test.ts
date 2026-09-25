import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The open-job board is the trade and the ward, for everybody who asks.
 *
 * WHY THIS IS NOT AN RLS TEST. The policies are right. "Providers see open
 * jobs they can do" narrows the board to a professional's own trades and
 * wards, `tests/db/rls-matrix.test.ts` asserts that an admin can read every
 * booking, and `docs/rls-matrix.md` publishes it — all three deliberate. What
 * was wrong was that a Postgres policy is PERMISSIVE: the admin one ORs past
 * the trade-and-ward clause, so `listOpenJobs`, which left the whole filter to
 * RLS, would have shown an admin who also works here every pending job in the
 * country and then resolved each one's ward with the service role.
 *
 * `open_job_ids()` is that predicate written once, called by the policy and by
 * the application. So this asserts the FUNCTION, which is the thing both sides
 * now depend on.
 *
 * TO PROVE IT BITES: drop `provider_can_serve` from the function's body and
 * the cross-trade case goes green when it should not.
 */

const CUSTOMER = "aaaaaaaa-0001-4000-8000-000000000001";
const PLUMBER = "aaaaaaaa-0002-4000-8000-000000000002";
/** An admin who is ALSO a linked professional — the account that gets it wrong. */
const ADMIN_WHO_WORKS = "aaaaaaaa-0003-4000-8000-000000000003";

let pg: Harness;
let plumbingJob: string;
let electricalJob: string;
let farJob: string;

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [CUSTOMER, "Anita Shrestha", "customer"],
    [PLUMBER, "Krishna Tamang", "provider"],
    [ADMIN_WHO_WORKS, "Support who also works", "admin"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779814${id.slice(0, 6)}`, role],
    );
  }

  const provider = async (profile: string, name: string, trade: string) => {
    const { rows } = await pg.admin.query(
      `insert into public.providers
         (profile_id, display_name, base_rate, is_active, service_areas)
       values ($1, $2, 900, true, array['lalitpur-4']) returning id`,
      [profile, name],
    );
    const id = rows[0].id as string;
    await pg.admin.query(
      `insert into public.provider_categories (provider_id, category_slug)
       values ($1, $2)`,
      [id, trade],
    );
    return id;
  };

  // Both work plumbing in ward 4 and nothing else. The admin's listing is what
  // makes the leak reachable at all — without one, the board is never read.
  await provider(PLUMBER, "Krishna Tamang", "plumbing");
  await provider(ADMIN_WHO_WORKS, "Support Plumbing", "plumbing");

  const address = async (areaKey: string, city: string, ward: number) => {
    const { rows } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', $2, $3, $4, 'Jhamsikhel', 'Gate')
       returning id`,
      [CUSTOMER, areaKey, city, ward],
    );
    return rows[0].id as string;
  };

  const openJob = async (
    reference: string,
    category: string,
    addressId: string,
  ) => {
    const { rows } = await pg.admin.query(
      `insert into public.bookings
         (reference, customer_id, category_slug, address_id,
          description, quoted_min, quoted_max, status, opened_at)
       values ($1, $2, $3, $4, 'Something is wrong', 900, 4500,
               'pending', now())
       returning id`,
      [reference, CUSTOMER, category, addressId],
    );
    return rows[0].id as string;
  };

  const nearby = await address("lalitpur-4", "Lalitpur", 4);
  const faraway = await address("kathmandu-16", "Kathmandu", 16);

  plumbingJob = await openJob("SK-OPEN1", "plumbing", nearby);
  electricalJob = await openJob("SK-OPEN2", "electrical", nearby);
  farJob = await openJob("SK-OPEN3", "plumbing", faraway);
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

async function boardFor(profileId: string): Promise<string[]> {
  const client = await pg.asUser(profileId);
  try {
    const { rows } = await client.query("select id from public.open_job_ids()");
    return rows.map((r) => r.id as string);
  } finally {
    await client.end();
  }
}

describe("open_job_ids", () => {
  it("offers a professional the job in their trade and their ward", async () => {
    expect(await boardFor(PLUMBER)).toEqual([plumbingJob]);
  });

  /*
   * THE CASE THAT WAS BROKEN. Being an admin is not a trade. Before this
   * function existed the board was RLS alone, and "Admins read every booking"
   * answered for all three jobs — a different trade and a different city
   * included, each with somebody's address behind it.
   */
  it("gives an admin who also works here no more than their own trade and ward", async () => {
    expect(await boardFor(ADMIN_WHO_WORKS)).toEqual([plumbingJob]);
  });

  it("excludes another trade and another ward for both of them", async () => {
    for (const person of [PLUMBER, ADMIN_WHO_WORKS]) {
      const board = await boardFor(person);
      expect(board).not.toContain(electricalJob);
      expect(board).not.toContain(farJob);
    }
  });

  it("offers a customer nothing at all", async () => {
    expect(await boardFor(CUSTOMER)).toEqual([]);
  });
});

describe("the policy and the board are the same rule", () => {
  /*
   * ONE IMPLEMENTATION, NOT TWO. `applyDispatch` exists because two copies of
   * an escalation rule escalate differently and nobody notices until an
   * emergency sits unwidened. Same class of mistake here, so the policy is
   * asserted to CALL the function rather than to carry its own copy of the
   * predicate.
   */
  it("the select policy calls open_job_ids rather than repeating it", async () => {
    const { rows } = await pg.admin.query(
      `select pg_get_expr(polqual, polrelid) as qual
         from pg_policy
        where polrelid = 'public.bookings'::regclass
          and polname = 'Providers see open jobs they can do'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toContain("open_job_ids");
    expect(rows[0].qual).not.toContain("provider_can_serve");
  });

  /*
   * AND THE CLAIM POLICY DELIBERATELY DOES NOT. Its `using` clause is what
   * makes claiming a race exactly one person wins: Postgres re-evaluates it
   * against the freshly locked row. A STABLE set-returning function is
   * evaluated once per statement and cached, so the re-check would consult a
   * snapshot taken before the other claimant committed — and two professionals
   * would be sent to one house.
   */
  it("the claim policy keeps its per-row predicate", async () => {
    const { rows } = await pg.admin.query(
      `select pg_get_expr(polqual, polrelid) as qual
         from pg_policy
        where polrelid = 'public.bookings'::regclass
          and polname = 'Providers claim an open job'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toContain("provider_can_serve");
    expect(rows[0].qual).not.toContain("open_job_ids");
  });
});
