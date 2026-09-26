import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasRoom } from "@/lib/booking";
import { jobFit } from "@/lib/provider";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * The gate and the database have to agree about who is bookable.
 *
 * THE BUG THIS EXISTS FOR. `canServeAt`, `hasRoom` and `providerCapacity` all
 * existed and all ran at claim time — and the catalogue called none of them. So
 * `/services/plumbing` could rank first somebody whose window was already
 * promised to another customer; the customer taps, `enforce_slot_capacity`
 * refuses the insert, and they find out at the confirm button.
 *
 * SO THE ASSERTION IS AGREEMENT, NOT CORRECTNESS. A gate that is wrong in the
 * same direction as the database is merely strict; a gate that says yes where
 * the database says no is the failure. This runs both against the same rows.
 *
 * `reason_code` IS HERE TOO because it is written in the same statement as the
 * free text — a value the check constraint refuses would take the prose with
 * it, which is a worse outcome than not recording a count.
 */

let pg: Harness;

const ANITA = "aaaaaaaa-9111-4111-8111-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-9222-4222-8222-bbbbbbbbbbbb";
let krishnaProvider: string;
let anitaAddress: string;

/** A booking that holds one of Krishna's windows. */
async function holdWindow(
  reference: string,
  scheduledFor: string,
  workingMinutes: number,
): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max, scheduled_for,
        estimated_working_minutes, status)
     values ($1, $2, $3, 'plumbing', $4, 'Kitchen tap drips', 900, 4500,
             $5, $6, 'pending')
     returning id`,
    [reference, ANITA, krishnaProvider, anitaAddress, scheduledFor, workingMinutes],
  );
  const id = rows[0].id as string;
  // A booking must start as pending and move; the transition trigger refuses an
  // insert straight into `accepted`. Same path a real booking takes.
  await pg.admin.query(
    "update public.bookings set status = 'accepted' where id = $1",
    [id],
  );
  return id;
}

/** The windows Krishna already holds, in the shape `hasRoom` reads. */
async function heldWindows(): Promise<
  {
    scheduledFor: string | null;
    status: string;
    workingMinutes: number | null;
    id: string;
  }[]
> {
  const { rows } = await pg.admin.query(
    `select id, status, scheduled_for, estimated_working_minutes
       from public.bookings
      where provider_id = $1
        and status in ('pending', 'accepted', 'en_route', 'in_progress')`,
    [krishnaProvider],
  );
  return rows.map((r) => ({
    id: r.id as string,
    status: r.status as string,
    scheduledFor: r.scheduled_for ? new Date(r.scheduled_for).toISOString() : null,
    workingMinutes: r.estimated_working_minutes,
  }));
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
      [id, name, `+9779812${id.slice(0, 6)}`, role],
    );
  }

  const { rows: p } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate, availability)
     values ($1, 'Krishna Tamang', 900, 'today') returning id`,
    [KRISHNA],
  );
  krishnaProvider = p[0].id as string;
  await pg.admin.query(
    "insert into public.provider_categories (provider_id, category_slug) values ($1, 'plumbing')",
    [krishnaProvider],
  );

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

describe("what the gate says and what the database does", () => {
  const SLOT = "2026-05-04T09:00:00.000Z";

  it("agrees that an empty window is bookable", async () => {
    const held = await heldWindows();
    const fit = jobFit({
      provider: {
        categories: ["plumbing"],
        availability: "today",
        busyUntil: null,
      },
      job: {
        categorySlug: "plumbing",
        urgency: "soon",
        when: SLOT,
        windowFull: !hasRoom({
          jobs: held,
          scheduledFor: SLOT,
          workingMinutes: 60,
          capacity: 1,
        }),
      },
      providerId: krishnaProvider,
    });
    expect(fit.fit).toBe("ok");

    // And the database accepts it, which is the half that matters.
    await expect(holdWindow("SK-FIT1", SLOT, 60)).resolves.toBeTruthy();
  });

  /*
   * THE TAP-THEN-REFUSED CASE. The window Krishna now holds is the one the next
   * customer wants. The gate must say blocked, and the database must refuse —
   * a disagreement in EITHER direction is the bug.
   */
  it("agrees that a taken window is not", async () => {
    const held = await heldWindows();
    const full = !hasRoom({
      jobs: held,
      scheduledFor: SLOT,
      workingMinutes: 60,
      capacity: 1,
    });
    expect(full).toBe(true);

    const fit = jobFit({
      provider: {
        categories: ["plumbing"],
        availability: "today",
        busyUntil: null,
      },
      job: {
        categorySlug: "plumbing",
        urgency: "soon",
        when: SLOT,
        windowFull: full,
      },
      providerId: krishnaProvider,
    });
    expect(fit.fit).toBe("blocked");
    expect(fit.fit !== "ok" && fit.why).toBe("full");

    // The database would have refused it too. Before this gate existed, the
    // catalogue showed this row first and the customer met this error.
    await expect(holdWindow("SK-FIT2", SLOT, 60)).rejects.toThrow();
  });

  /*
   * AND A DIFFERENT DAY IS STILL FREE. The gate must not over-block — refusing
   * to let the busiest people be booked at all would take work from exactly the
   * professionals the platform runs on.
   */
  it("agrees that a different day is free", async () => {
    const other = "2026-05-06T09:00:00.000Z";
    const held = await heldWindows();
    const fit = jobFit({
      provider: {
        categories: ["plumbing"],
        availability: "today",
        busyUntil: null,
      },
      job: {
        categorySlug: "plumbing",
        urgency: "soon",
        when: other,
        windowFull: !hasRoom({
          jobs: held,
          scheduledFor: other,
          workingMinutes: 60,
          capacity: 1,
        }),
      },
      providerId: krishnaProvider,
    });
    expect(fit.fit).toBe("ok");
    await expect(holdWindow("SK-FIT3", other, 60)).resolves.toBeTruthy();
  });
});

describe("the refusal reason the database will accept", () => {
  it("takes every code the shared list names", async () => {
    const { rows } = await pg.admin.query(
      "select id from public.bookings where reference = 'SK-FIT1'",
    );
    for (const code of ["too_far", "wrong_job", "already_busy", "price", "other"]) {
      await pg.admin.query("delete from public.booking_refusals");
      await expect(
        pg.admin.query(
          `insert into public.booking_refusals
             (booking_id, provider_id, kind, reason, reason_code)
           values ($1, $2, 'declined', 'not for me', $3)`,
          [rows[0].id, krishnaProvider, code],
        ),
      ).resolves.toBeTruthy();
    }
  });

  /*
   * A VALUE OUTSIDE THE SET TAKES THE PROSE WITH IT, which is why the
   * application guards before writing rather than relying on this. The
   * constraint is the backstop, not the first line.
   */
  it("refuses anything else", async () => {
    const { rows } = await pg.admin.query(
      "select id from public.bookings where reference = 'SK-FIT1'",
    );
    await pg.admin.query("delete from public.booking_refusals");
    await expect(
      pg.admin.query(
        `insert into public.booking_refusals
           (booking_id, provider_id, kind, reason, reason_code)
         values ($1, $2, 'declined', 'weather was bad', 'weather')`,
        [rows[0].id, krishnaProvider],
      ),
    ).rejects.toThrow(/booking_refusals_reason_code_known/i);
  });

  /*
   * RULE 6. Every row that already exists has null here, and a refusal recorded
   * without a code is a refusal that happened — not one with no reason.
   */
  it("allows a refusal with no code at all", async () => {
    const { rows } = await pg.admin.query(
      "select id from public.bookings where reference = 'SK-FIT1'",
    );
    await pg.admin.query("delete from public.booking_refusals");
    await expect(
      pg.admin.query(
        `insert into public.booking_refusals
           (booking_id, provider_id, kind, reason)
         values ($1, $2, 'declined', 'they typed prose only')`,
        [rows[0].id, krishnaProvider],
      ),
    ).resolves.toBeTruthy();
  });
});
