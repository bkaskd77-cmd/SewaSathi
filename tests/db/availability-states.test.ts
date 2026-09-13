import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * Availability the system maintains, and the trap beside it.
 *
 * TWO RULES CARRY THIS FILE.
 *
 * `on_job_since` is ours. A professional cannot write it and cannot override
 * it, because it is the one of the three availability facts we can verify —
 * and before it existed somebody could be listed "available now" while
 * `en_route` to a customer's house, at the top of an emergency search.
 *
 * And a customer widening a silent booking is NOT a refusal. Clearing
 * `provider_id` on a pending booking is exactly how a decline is detected, so
 * without the guard this would count one against somebody who did nothing and
 * hide the job from them for ever. `/providers/standards` publishes "Turning
 * work down. You are allowed to be busy" — recording a decline nobody made
 * would break that promise with the professional never knowing.
 */

const ANITA = "aaaaaaaa-7111-4111-8111-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-7222-4222-8222-bbbbbbbbbbbb";

let pg: Harness;
let provider: string;
let address: string;
let counter = 0;

async function booking(reference: string): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, 'plumbing', $4, 'Tap is dripping', 900, 4500)
     returning id`,
    [reference, ANITA, provider, address],
  );
  return rows[0].id as string;
}

async function move(id: string, status: string): Promise<void> {
  await pg.admin.query("update public.bookings set status = $1 where id = $2", [
    status,
    id,
  ]);
}

async function onJobSince(): Promise<string | null> {
  const { rows } = await pg.admin.query(
    "select on_job_since from public.providers where id = $1",
    [provider],
  );
  return rows[0].on_job_since as string | null;
}

async function declines(): Promise<number> {
  const { rows } = await pg.admin.query(
    "select coalesce(declines, 0) as n from public.provider_stats where provider_id = $1",
    [provider],
  );
  return rows.length === 0 ? 0 : Number(rows[0].n);
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

  const { rows: providerRows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate, availability)
     values ($1, 'Krishna Tamang', 900, 'today') returning id`,
    [KRISHNA],
  );
  provider = providerRows[0].id as string;

  const { rows: addressRows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  address = addressRows[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("on a job is the system's fact, not a setting", () => {
  it("is unset while a job is only accepted", async () => {
    const id = await booking(`SK-ONJ${(counter += 1)}`);
    await move(id, "accepted");

    // Accepting a job for Thursday does not make somebody busy this afternoon.
    expect(await onJobSince()).toBeNull();

    await move(id, "cancelled");
  });

  it("is set the moment they set off, and cleared when the job is done", async () => {
    const id = await booking(`SK-ONJ${(counter += 1)}`);
    await move(id, "accepted");
    await move(id, "en_route");
    expect(await onJobSince()).not.toBeNull();

    await move(id, "in_progress");
    expect(await onJobSince()).not.toBeNull();

    await move(id, "completed");
    expect(await onJobSince()).toBeNull();
  });

  /**
   * A RECOUNT, NOT A COUNTER. An established professional may hold several
   * live jobs, so finishing one does not mean free — and a decrement that got
   * this wrong would leave somebody invisible to every customer.
   */
  it("stays set while a second job is still live", async () => {
    const first = await booking(`SK-ONJ${(counter += 1)}`);
    const second = await booking(`SK-ONJ${(counter += 1)}`);

    for (const id of [first, second]) {
      await move(id, "accepted");
      await move(id, "en_route");
    }
    const started = await onJobSince();
    expect(started).not.toBeNull();

    await move(first, "in_progress");
    await move(first, "completed");
    // Still out on the second one, and the stamp is the ORIGINAL: it means
    // "since they started working", not "since the last status change".
    expect(await onJobSince()).toEqual(started);

    await move(second, "in_progress");
    await move(second, "completed");
    expect(await onJobSince()).toBeNull();
  });

  it("clears when the professional withdraws instead of finishing", async () => {
    const id = await booking(`SK-ONJ${(counter += 1)}`);
    await move(id, "accepted");
    await move(id, "en_route");
    expect(await onJobSince()).not.toBeNull();

    // The release path: back to the pool, provider cleared by the trigger.
    await move(id, "pending");
    expect(await onJobSince()).toBeNull();
  });

  it("cannot be written by the professional themselves", async () => {
    const client = await pg.asUser(KRISHNA);
    const { rowCount } = await client.query(
      "update public.providers set on_job_since = now() where id = $1",
      [provider],
    );
    // No update policy on `providers` at all, so RLS matches nothing.
    expect(rowCount).toBe(0);
    await client.end();
  });
});

describe("a customer widening a silent job is not a refusal", () => {
  it("counts no decline and writes no refusal row", async () => {
    const before = await declines();
    const id = await booking(`SK-WIDE${(counter += 1)}`);

    await pg.admin.query(
      `update public.bookings
          set widened_by_customer_at = now(), provider_id = null
        where id = $1`,
      [id],
    );

    expect(await declines()).toBe(before);

    const { rows } = await pg.admin.query(
      "select count(*)::int as n from public.booking_refusals where booking_id = $1",
      [id],
    );
    expect(rows[0].n).toBe(0);
  });

  /**
   * The point of not writing a refusal: `provider_refused` would otherwise hide
   * the job from them for ever, and `enforce_booking_immutability` would refuse
   * to give it back. They were slow, not unwilling.
   */
  it("leaves the job claimable by the professional who was slow", async () => {
    const id = await booking(`SK-WIDE${(counter += 1)}`);
    await pg.admin.query(
      `update public.bookings
          set widened_by_customer_at = now(), provider_id = null
        where id = $1`,
      [id],
    );

    await expect(
      pg.admin.query(
        "update public.bookings set provider_id = $1, status = 'accepted' where id = $2",
        [provider, id],
      ),
    ).resolves.toBeTruthy();
  });

  /** The ordinary decline still counts. The guard is narrow on purpose. */
  it("still records a decline when nobody widened it", async () => {
    const before = await declines();
    const id = await booking(`SK-DECL${(counter += 1)}`);

    await pg.admin.query(
      "update public.bookings set provider_id = null where id = $1",
      [id],
    );

    expect(await declines()).toBe(before + 1);

    const { rows } = await pg.admin.query(
      "select kind from public.booking_refusals where booking_id = $1",
      [id],
    );
    expect(rows[0].kind).toBe("declined");
  });
});
