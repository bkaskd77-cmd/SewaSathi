import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bandOutcome,
  categoryAgrees,
  fallbackCause,
  hazardCase,
} from "@/lib/ai/accuracy";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * The join that makes triage measurable, against the real schema.
 *
 * WHY THIS FILE EXISTS. `bookings.triage_log_id` had a column, a zod field, a
 * flow-state slot, an insert that wrote it and a `/book` page that read it off
 * `?triage=`. Every link was built and the chain was still broken, because the
 * id never left `/api/triage` — so nothing ever set the parameter, and every
 * booking this product has ever taken carries a null there.
 *
 * That is the failure this file is guarding: not a wrong answer, but a chain
 * that looked complete at every individual link. So the test asserts the
 * ends — a booking that carries an id can be joined back to the triage that
 * produced it, and the classifications read the real columns.
 *
 * MEASUREMENT, NOT TUNING. Nothing here asserts a rate is good. There is no
 * threshold to assert against, deliberately.
 */

let pg: Harness;

const ANITA = "aaaaaaaa-9111-4111-8111-aaaaaaaaaaaa";
let anitaAddress: string;

async function logTriage(over: {
  category: string;
  priceLow: number;
  priceHigh: number;
  source?: string;
  textHazard?: string | null;
  visionHazard?: string | null;
  hazard?: string | null;
  reason?: string | null;
}): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.triage_logs
       (user_id, input_text, had_photo, category, urgency,
        price_low, price_high, source, text_hazard, vision_hazard, hazard,
        reason)
     values ($1, 'the tap is dripping', false, $2, 'soon',
             $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      ANITA,
      over.category,
      over.priceLow,
      over.priceHigh,
      over.source ?? "claude",
      over.textHazard ?? null,
      over.visionHazard ?? null,
      over.hazard ?? null,
      over.reason ?? null,
    ],
  );
  return rows[0].id as string;
}

async function bookedFrom(
  reference: string,
  category: string,
  triageLogId: string | null,
  finalAmount: number | null,
): Promise<string> {
  const { rows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, category_slug, address_id, description,
        quoted_min, quoted_max, triage_log_id)
     values ($1, $2, $3, $4, 'Tap drips', 900, 4500, $5)
     returning id`,
    [reference, ANITA, category, anitaAddress, triageLogId],
  );
  const id = rows[0].id as string;
  if (finalAmount !== null) {
    for (const status of ["accepted", "en_route", "in_progress", "completed"]) {
      await pg.admin.query(
        "update public.bookings set status = $1 where id = $2",
        [status, id],
      );
    }
    await pg.admin.query(
      `update public.bookings
          set payment_status = 'paid', final_amount = $2, completed_at = now()
        where id = $1`,
      [id, finalAmount],
    );
  }
  return id;
}

/** The join the accuracy read makes, in SQL. */
async function attributed(): Promise<
  {
    predicted: string;
    booked: string;
    price_low: number;
    price_high: number;
    final_amount: number | null;
  }[]
> {
  const { rows } = await pg.admin.query(
    `select t.category as predicted, b.category_slug as booked,
            t.price_low, t.price_high, b.final_amount
       from public.bookings b
       join public.triage_logs t on t.id = b.triage_log_id
      order by b.reference`,
  );
  return rows;
}

beforeAll(async () => {
  pg = await startPostgres();

  await pg.admin.query("insert into auth.users (id) values ($1)", [ANITA]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, 'Anita Shrestha', '+9779812000001', 'customer')
     on conflict (id) do update set role = excluded.role`,
    [ANITA],
  );

  const { rows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  anitaAddress = rows[0].id as string;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("a booking can point back at the triage that produced it", () => {
  it("joins, which it could not do for the whole life of the product", async () => {
    const log = await logTriage({
      category: "plumbing",
      priceLow: 900,
      priceHigh: 4500,
    });
    await bookedFrom("SK-TA01", "plumbing", log, 2000);

    const rows = await attributed();
    expect(rows).toHaveLength(1);
    expect(categoryAgrees(rows[0].predicted, rows[0].booked)).toBe(true);
    expect(
      bandOutcome(rows[0].price_low, rows[0].price_high, rows[0].final_amount),
    ).toBe("inside");
  });

  /*
   * THE ENTIRE CURRENT POPULATION. Every booking in production has a null
   * here, so the unattributed case is not an edge — it is the norm, and it
   * must count as "not measurable" rather than as the AI getting it wrong.
   */
  it("leaves a booking with no triage out of the comparison entirely", async () => {
    await bookedFrom("SK-TA02", "electrical", null, 1500);

    const rows = await attributed();
    // Still just the one attributed booking; the unlinked one is absent from
    // the join rather than counted as a disagreement.
    expect(rows).toHaveLength(1);
    expect(rows[0].booked).toBe("plumbing");
  });

  it("records a disagreement when the customer booked something else", async () => {
    const log = await logTriage({
      category: "plumbing",
      priceLow: 900,
      priceHigh: 4500,
    });
    await bookedFrom("SK-TA03", "carpentry", log, 3000);

    const row = (await attributed()).find((r) => r.booked === "carpentry")!;
    expect(categoryAgrees(row.predicted, row.booked)).toBe(false);
  });

  it("has no band answer on a job nobody has settled", async () => {
    const log = await logTriage({
      category: "plumbing",
      priceLow: 900,
      priceHigh: 4500,
    });
    await bookedFrom("SK-TA04", "plumbing", log, null);

    const { rows } = await pg.admin.query(
      `select t.price_low, t.price_high, b.final_amount
         from public.bookings b join public.triage_logs t on t.id = b.triage_log_id
        where b.reference = 'SK-TA04'`,
    );
    expect(
      bandOutcome(rows[0].price_low, rows[0].price_high, rows[0].final_amount),
    ).toBeNull();
  });
});

describe("what each hazard detector said, from the real columns", () => {
  /**
   * THE COMPARISON THE OLD COLUMN COULD NOT MAKE. `hazard` records the
   * winner — the text guard beats vision whenever both fire — so a `text:gas`
   * row is silent about whether vision agreed. These two columns are each
   * detector's own reading.
   */
  it("distinguishes agreement from the text guard simply winning", async () => {
    const both = await logTriage({
      category: "electrical",
      priceLow: 500,
      priceHigh: 5000,
      textHazard: "gas",
      visionHazard: "gas",
      // What the customer was actually shown, and what the old column held.
      hazard: "text:gas",
    });
    const textWon = await logTriage({
      category: "electrical",
      priceLow: 500,
      priceHigh: 5000,
      textHazard: "gas",
      visionHazard: null,
      hazard: "text:gas",
    });

    const { rows } = await pg.admin.query(
      `select id, hazard, text_hazard, vision_hazard
         from public.triage_logs where id = any($1)`,
      [[both, textWon]],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Identical in the old column …
    expect(byId.get(both).hazard).toBe(byId.get(textWon).hazard);

    // … and distinguishable now.
    expect(
      hazardCase({
        textHazard: byId.get(both).text_hazard,
        visionHazard: byId.get(both).vision_hazard,
        recorded: true,
      }),
    ).toBe("agreed");
    expect(
      hazardCase({
        textHazard: byId.get(textWon).text_hazard,
        visionHazard: byId.get(textWon).vision_hazard,
        recorded: true,
      }),
    ).toBe("textOnly");
  });

  it("counts the two firing on different hazards", async () => {
    const id = await logTriage({
      category: "electrical",
      priceLow: 500,
      priceHigh: 5000,
      textHazard: "gas",
      visionHazard: "burning",
      hazard: "text:gas",
    });
    const { rows } = await pg.admin.query(
      "select text_hazard, vision_hazard from public.triage_logs where id = $1",
      [id],
    );
    expect(
      hazardCase({
        textHazard: rows[0].text_hazard,
        visionHazard: rows[0].vision_hazard,
        recorded: true,
      }),
    ).toBe("disagreed");
  });

  it("never reads a row written before the columns as a quiet one", async () => {
    // The fifteen rows live in production right now. Null in both is silence,
    // not a clean safety record.
    const old = await logTriage({
      category: "plumbing",
      priceLow: 900,
      priceHigh: 4500,
      source: "fallback",
    });
    const { rows } = await pg.admin.query(
      "select text_hazard, vision_hazard from public.triage_logs where id = $1",
      [old],
    );
    expect(rows[0].text_hazard).toBeNull();
    expect(
      hazardCase({
        textHazard: rows[0].text_hazard,
        visionHazard: rows[0].vision_hazard,
        recorded: false,
      }),
    ).toBe("notRecorded");
  });
});

describe("why the keyword matcher answered, against the real column", () => {
  /**
   * THE CONSTRAINT IS THE HALF A TYPE CANNOT ENFORCE. `LoggableReason` stops a
   * bad value being written by code that typechecks; the check constraint stops
   * one written by anything else — a migration, a backfill, a hand-typed UPDATE
   * in the dashboard. Both exist because the cost of a wrong value is not a
   * wrong count: `reason` is written in the same insert as the row itself, so a
   * refused value loses the log row, its id, and therefore the attribution of
   * whatever booking followed.
   */
  it("refuses a reason the loggable set does not name", async () => {
    await expect(
      logTriage({
        category: "plumbing",
        priceLow: 900,
        priceHigh: 4500,
        source: "fallback",
        // The browser fallback's own reason: by construction no server ever
        // sees one, so no row may carry it.
        reason: "unreachable",
      }),
    ).rejects.toThrow(/triage_logs_reason_known/);
  });

  it("accepts each reason a server can actually produce", async () => {
    for (const reason of [
      "ok",
      "cache-hit",
      "no-api-key",
      "timeout",
      "auth-rejected",
      "rate-limited",
      "provider-error",
      "unparseable",
    ]) {
      const id = await logTriage({
        category: "plumbing",
        priceLow: 900,
        priceHigh: 4500,
        source: reason === "ok" ? "claude" : "fallback",
        reason,
      });
      expect(id).toBeTruthy();
    }
  });

  it("groups a refused key apart from a model that merely failed", async () => {
    const refused = await logTriage({
      category: "plumbing",
      priceLow: 900,
      priceHigh: 4500,
      source: "fallback",
      reason: "auth-rejected",
    });
    const blipped = await logTriage({
      category: "plumbing",
      priceLow: 900,
      priceHigh: 4500,
      source: "fallback",
      reason: "provider-error",
    });

    const { rows } = await pg.admin.query(
      "select id, reason from public.triage_logs where id = any($1)",
      [[refused, blipped]],
    );
    const byId = new Map(rows.map((r) => [r.id, r.reason as string]));

    expect(
      fallbackCause({ reason: byId.get(refused)!, recorded: true }),
    ).toBe("keyRejected");
    expect(
      fallbackCause({ reason: byId.get(blipped)!, recorded: true }),
    ).toBe("providerFailed");
  });

  /*
   * THE FIFTEEN ROWS LIVE RIGHT NOW. They have no reason, because the column
   * did not exist when they were written, and they are deliberately not
   * backfilled — so this is the ordinary case rather than an edge one.
   */
  it("reads a row written before the column as undiagnosed, not as a missing key", async () => {
    const old = await logTriage({
      category: "plumbing",
      priceLow: 900,
      priceHigh: 4500,
      source: "fallback",
    });
    const { rows } = await pg.admin.query(
      "select reason from public.triage_logs where id = $1",
      [old],
    );
    expect(rows[0].reason).toBeNull();
    expect(fallbackCause({ reason: rows[0].reason, recorded: false })).toBe(
      "notRecorded",
    );
  });
});
