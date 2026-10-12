import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DURATION_OUTCOMES } from "@/lib/booking";

import { startPostgres, type Harness } from "../support/postgres";
import { BROWSER_WRITE_REFUSED } from "../support/refusals";

/**
 * The duration loop's own record.
 *
 * WHY IT IS APPEND-ONLY. The loop replaces a published figure without anybody
 * approving it, so the only thing that can later answer "why is this 90
 * minutes?" is a row saying what the sample was on the night it moved. A log
 * the application can rewrite answers nothing — the rule `security_events` and
 * `application_decisions` already follow, through the same trigger.
 *
 * AND IT IS THE SHADOW HALF: a product below its floor logs what it WOULD
 * publish, every night, so a figure can be watched converging for months before
 * anything uses it.
 */

const ANITA = "cccccccc-7111-4111-8111-cccccccccccc";

let pg: Harness;

async function reading(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = {
    category_slug: "painting",
    band_slug: "room-supplied",
    kind: "minutes",
    sample: 12,
    observed: 960,
    published: 960,
    published_source: "invented",
    unusual: 0,
    floor_sample: 12,
    outcome: "below-floor",
    ...overrides,
  };
  const columns = Object.keys(row);
  const { rows } = await pg.admin.query(
    `insert into public.duration_observations (${columns.join(", ")})
     values (${columns.map((_, i) => `$${i + 1}`).join(", ")})
     returning id`,
    columns.map((c) => (row as Record<string, unknown>)[c]),
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  pg = await startPostgres();
  await pg.admin.query("insert into auth.users (id) values ($1)", [ANITA]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, 'Anita Shrestha', '+9779815000991', 'customer')
     on conflict (id) do nothing`,
    [ANITA],
  );
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the loop's record cannot be rewritten", () => {
  it("refuses an UPDATE for the service role", async () => {
    const id = await reading();
    await expect(
      pg.admin.query(
        "update public.duration_observations set observed = 1 where id = $1",
        [id],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses a DELETE for the service role", async () => {
    const id = await reading();
    await expect(
      pg.admin.query("delete from public.duration_observations where id = $1", [
        id,
      ]),
    ).rejects.toThrow(/append-only/i);
  });
});

describe("no browser writes it and only an admin reads it", () => {
  it("refuses an insert from a signed-in customer", async () => {
    const anita = await pg.asUser(ANITA);
    await expect(
      anita.query(
        `insert into public.duration_observations
           (category_slug, band_slug, kind, sample, observed, published,
            published_source, floor_sample, outcome)
         values ('painting', 'flat', 'span', 99, 1, 7, 'invented', 20, 'applied')`,
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
    await anita.end();
  });

  /*
   * A SELECT GRANT WITHOUT AN ADMIN IS NOT A LEAK, and this is the pair that
   * proves the grant and the policy are doing different jobs: the grant decides
   * whether you may ask at all, the policy decides which rows. A new table on
   * this project grants nothing, so the grant is explicit in the migration and
   * the policy is what keeps a customer out.
   */
  it("returns nothing to a customer who may ask", async () => {
    await reading();
    const anita = await pg.asUser(ANITA);
    const { rows } = await anita.query(
      "select id from public.duration_observations",
    );
    expect(rows).toHaveLength(0);
    await anita.end();
  });
});

describe("the shapes a reading may hold", () => {
  /*
   * ONE LIST WRITTEN TWICE — `DURATION_OUTCOMES` and the check constraint.
   * `LOGGABLE_REASONS` learned this the expensive way: a value the column
   * refuses loses the row in the same statement that writes it, and on this
   * table that would lose the only explanation a published figure has.
   */
  it("admits exactly the outcomes the loop can produce", async () => {
    const { rows } = await pg.admin.query(
      `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'public.duration_observations'::regclass
          and conname = 'duration_observations_outcome_check'`,
    );
    expect(rows).toHaveLength(1);
    const inSql = [...(rows[0].def as string).matchAll(/'([a-z-]+)'::text/g)].map(
      (m) => m[1],
    );
    expect([...inSql].sort()).toEqual([...DURATION_OUTCOMES].sort());
  });

  it("admits both kinds and refuses a third", async () => {
    await expect(reading({ kind: "span", observed: 4 })).resolves.toBeTruthy();
    await expect(reading({ kind: "hours" })).rejects.toThrow(/kind_check/i);
  });

  /*
   * A SAMPLE OF ZERO IS NOT A READING. `durationOutcome` returns null for
   * no-evidence so the sweep never attempts one, and the column refuses it as
   * well — because the row would otherwise assert a median computed from
   * nothing.
   */
  it("refuses a reading with no sample behind it", async () => {
    await expect(reading({ sample: 0 })).rejects.toThrow(/sample_check/i);
  });

  it("refuses a zero figure, measured or published", async () => {
    await expect(reading({ observed: 0 })).rejects.toThrow(/shape_check/i);
    await expect(reading({ published: 0 })).rejects.toThrow(/shape_check/i);
  });

  it("refuses a provenance that is not one of the three", async () => {
    await expect(reading({ published_source: "guessed" })).rejects.toThrow(
      /source_check/i,
    );
  });
});

/* ------------------------------------------------------------------ *
 * The revert — a person overruling a loop that acts unattended
 * ------------------------------------------------------------------ */

async function revert(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = {
    category_slug: "painting",
    band_slug: "room-supplied",
    kind: "minutes",
    from_value: 300,
    to_value: 960,
    to_source: "invented",
    sample: 12,
    actor_id: ANITA,
    reason: "Three of those jobs were left open overnight.",
    ...overrides,
  };
  const columns = Object.keys(row);
  const { rows } = await pg.admin.query(
    `insert into public.duration_reverts (${columns.join(", ")})
     values (${columns.map((_, i) => `$${i + 1}`).join(", ")})
     returning id`,
    columns.map((c) => (row as Record<string, unknown>)[c]),
  );
  return rows[0].id as string;
}

describe("a revert cannot be rewritten either", () => {
  /*
   * THE SAME RULE AS THE OBSERVATIONS, AND IT CARRIES MORE WEIGHT HERE. This
   * table does work rather than only recording: the nightly sweep reads it to
   * know a figure is held back, so a row the application could edit would be a
   * suppression the application could lift — and the loop would re-publish a
   * figure a person took down, which is the one outcome the whole mechanism
   * exists to prevent.
   */
  it("refuses an UPDATE for the service role", async () => {
    const id = await revert();
    await expect(
      pg.admin.query(
        "update public.duration_reverts set from_value = 1 where id = $1",
        [id],
      ),
    ).rejects.toThrow(/append-only|cannot be/i);
  });

  it("refuses a DELETE for the service role", async () => {
    const id = await revert();
    await expect(
      pg.admin.query("delete from public.duration_reverts where id = $1", [id]),
    ).rejects.toThrow(/append-only|cannot be/i);
  });
});

describe("no browser writes a revert and only an admin reads one", () => {
  it("refuses an insert from a signed-in customer", async () => {
    const client = await pg.asUser(ANITA);
    await expect(
      client.query(
        `insert into public.duration_reverts
           (category_slug, band_slug, kind, from_value, to_value, to_source,
            sample, reason)
         values ('painting', 'room-supplied', 'minutes', 300, 960, 'invented',
                 12, 'let me publish my own')`,
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
    await client.end();
  });

  it("returns nothing to a customer who may ask", async () => {
    await revert({ band_slug: "room-own-paint" });
    const client = await pg.asUser(ANITA);
    const { rows } = await client.query(
      "select id from public.duration_reverts",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("the shapes a revert may hold", () => {
  it("admits all three provenances, because a second promotion reverts to a measurement", async () => {
    /*
     * A FIRST DRAFT OF THE MIGRATION REFUSED `observed` HERE, on the reasoning
     * that reverting to a measured figure would read as `settled` and stop the
     * loop looking. That is not what `proposeDuration` does — `settled` needs
     * the median to EQUAL the published figure, which after a revert it does
     * not — and the rule would have made the second promotion of any sub-band
     * unrevertable. Asserted as the behaviour rather than left as a comment.
     */
    for (const source of ["invented", "researched", "observed"]) {
      await expect(revert({ to_source: source })).resolves.toBeTruthy();
    }
    await expect(revert({ to_source: "guessed" })).rejects.toThrow(
      /to_source/i,
    );
  });

  it("refuses a revert that moves nothing", async () => {
    // `proposeDuration` cannot produce a promotion to the figure already
    // published, so a revert whose two ends are equal is a bug upstream rather
    // than a decision — and recording it would suppress a figure for ever on
    // evidence of nothing having happened.
    await expect(revert({ from_value: 960, to_value: 960 })).rejects.toThrow(
      /moved/i,
    );
  });

  it("refuses a revert with no sample behind it", async () => {
    // The sample is the denominator the suppression rule needs: without it,
    // "has the evidence moved since" cannot be answered at all.
    await expect(revert({ sample: 0 })).rejects.toThrow(/sample/i);
  });

  it("refuses a blank reason", async () => {
    // A figure with no sentence beside it is indistinguishable from a mistake
    // six months later, which is why the column insists rather than the form.
    for (const reason of ["", "   "]) {
      await expect(revert({ reason })).rejects.toThrow(/reason/i);
    }
  });

  it("refuses a kind that is not one of the two", async () => {
    await expect(revert({ kind: "rupees" })).rejects.toThrow(/kind/i);
  });
});
