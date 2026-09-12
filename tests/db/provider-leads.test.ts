import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The open door: a stranger with no account leaving their details.
 *
 * WHY THIS FILE EXISTS. `/providers/join` refused every submission in
 * production with "We couldn't save that just now" — on an empty table, from a
 * form with valid input. The cause was an upsert: `INSERT ... ON CONFLICT DO
 * UPDATE` needs an UPDATE policy, because Postgres must satisfy the update arm
 * of the statement whether or not a conflict can occur, and this table grants
 * anonymous visitors INSERT and nothing else. The whole professional funnel
 * was dead and nothing in the suite noticed, because every test of that code
 * path mocked the database away.
 *
 * So these assertions are deliberately about the *shape of the statement* the
 * application is allowed to send, not only about the policies. A policy test
 * that checked "anon can insert" would have passed throughout the outage.
 */

let pg: Harness;

const LEAD = {
  full_name: "Bikas Khadka",
  phone: "+9779800000011",
  category_slug: "appliance-repair",
  area_key: "kathmandu-4",
  years_experience: 10,
  locale: "en",
};

async function insertAsAnon(client: Awaited<ReturnType<Harness["asAnon"]>>) {
  return client.query(
    `insert into public.provider_leads
       (full_name, phone, category_slug, area_key, years_experience, locale)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      LEAD.full_name,
      LEAD.phone,
      LEAD.category_slug,
      LEAD.area_key,
      LEAD.years_experience,
      LEAD.locale,
    ],
  );
}

beforeAll(async () => {
  pg = await startPostgres();
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("a stranger can leave their details", () => {
  it("accepts a plain insert from an anonymous visitor", async () => {
    // The entire funnel for professionals runs through this one statement.
    const client = await pg.asAnon();
    await expect(insertAsAnon(client)).resolves.toBeDefined();
    await client.end();

    const { rows } = await pg.admin.query(
      "select id from public.provider_leads where phone = $1",
      [LEAD.phone],
    );
    expect(rows).toHaveLength(1);
  });

  it("REFUSES an upsert from an anonymous visitor", async () => {
    /*
     * THE REGRESSION. This is what the application used to send, and it fails
     * even when no conflicting row exists, because the update arm of the
     * statement has no policy to satisfy. Asserted rather than merely fixed:
     * an upsert is the obvious way to make a double tap idempotent, so
     * somebody will reach for it again.
     */
    const client = await pg.asAnon();
    await expect(
      client.query(
        `insert into public.provider_leads
           (full_name, phone, category_slug, area_key, years_experience, locale)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (phone, category_slug) do update
           set full_name = excluded.full_name`,
        [
          "Someone Else",
          "+9779800000099",
          LEAD.category_slug,
          LEAD.area_key,
          5,
          "en",
        ],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await client.end();
  });

  it("refuses the upsert with a code the duplicate handler must not accept", async () => {
    // `isDuplicateLead` turns 23505 into success. The refusal that caused the
    // outage is 42501, and if those two were ever confused the form would
    // report a cheerful "thanks" for a submission that saved nothing — worse
    // than the red error it replaced. Both codes are pinned here against a
    // real Postgres rather than against anybody's memory of them.
    const client = await pg.asAnon();
    const refusal = await client
      .query(
        `insert into public.provider_leads
           (full_name, phone, category_slug, area_key, years_experience, locale)
         values ('X', '+9779800000098', 'plumbing', $1, 1, 'en')
         on conflict (phone, category_slug) do nothing`,
        [LEAD.area_key],
      )
      .then(() => null)
      .catch((error: { code?: string }) => error.code);
    expect(refusal).toBe("42501");
    await client.end();
  });

  it("raises a unique violation on a second identical submission", async () => {
    // Which the data layer turns into success — from the applicant's side,
    // "you already applied" and "you have applied" are the same outcome, and a
    // red error for having done the right thing twice is worse than silence.
    const client = await pg.asAnon();
    await expect(insertAsAnon(client)).rejects.toMatchObject({ code: "23505" });
    await client.end();
  });

  it("lets the same person apply for a different trade", async () => {
    // The uniqueness is per trade on purpose: a plumber who also does tank
    // cleaning is two listings, not a duplicate.
    const client = await pg.asAnon();
    await expect(
      client.query(
        `insert into public.provider_leads
           (full_name, phone, category_slug, area_key, years_experience, locale)
         values ($1, $2, 'plumbing', $3, $4, 'en')`,
        [LEAD.full_name, LEAD.phone, LEAD.area_key, LEAD.years_experience],
      ),
    ).resolves.toBeDefined();
    await client.end();
  });
});

describe("and can do nothing else with the table", () => {
  it("cannot read anybody's lead", async () => {
    // It holds a name, a phone number and a ward for every professional who
    // ever filled the form. There is no select policy and there must not be.
    const client = await pg.asAnon();
    const { rows } = await client.query(
      "select id from public.provider_leads",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("cannot rewrite somebody else's lead", async () => {
    // The reason the fix is insert-only rather than an added update policy: an
    // update policy permissive enough for a stranger to use is permissive
    // enough for a stranger to overwrite every other applicant.
    const client = await pg.asAnon();
    const result = await client
      .query("update public.provider_leads set full_name = 'Hijacked'")
      .catch(() => ({ rowCount: 0 }));
    expect(result.rowCount).toBe(0);
    await client.end();

    const { rows } = await pg.admin.query(
      "select full_name from public.provider_leads where full_name = 'Hijacked'",
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot delete a lead", async () => {
    const client = await pg.asAnon();
    const result = await client
      .query("delete from public.provider_leads")
      .catch(() => ({ rowCount: 0 }));
    expect(result.rowCount).toBe(0);
    await client.end();
  });
});
