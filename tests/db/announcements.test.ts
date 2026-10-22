import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_TONES,
} from "@/lib/config/announcements";

import { startPostgres, type Harness } from "../support/postgres";
import { BROWSER_WRITE_REFUSED } from "../support/refusals";

/**
 * The banner table: anybody reads, nobody but the server writes.
 *
 * THREE THINGS ARE WORTH A DATABASE CASE HERE, and the first is the one that
 * would otherwise fail in production on the first request that produced the new
 * value. `ANNOUNCEMENT_AUDIENCES` and `ANNOUNCEMENT_TONES` are rendered into the
 * publish form, and the column's check constraint is the same list written a
 * second time in SQL. Widening one without the other means a radio button whose
 * write the constraint refuses — losing the banner in the statement that wrote
 * it. The lists are read out of `pg_constraint` rather than out of a migration
 * file, because that is the text actually in force.
 *
 * THE SECOND IS THAT THE WINDOW AND THE SWITCH ARE NOT TIED. `categories` has
 * `categories_retired_shape` because `is_active` and `retired_at` are one fact
 * in two columns and the database must refuse them out of step. Here they are
 * genuinely two facts, so a disabled row inside its own window has to be
 * storable — it is the state "somebody took this down early", and a constraint
 * tying them would make that unrecordable. Asserted as behaviour, because the
 * reflex of the next reader will be to add the constraint.
 *
 * THE THIRD IS THE GRANT. This is copy that reaches every visitor on every
 * page, so a browser that could insert a row could put a sentence of its own on
 * the landing page — the `push_subscriptions` reasoning with a bigger audience.
 * Read is open to `anon` on purpose and is asserted in both directions.
 */

const ADMIN = "dddddddd-9444-4444-8444-dddddddddddd";
const CUSTOMER = "dddddddd-9444-4444-8444-eeeeeeeeeeee";

let pg: Harness;

/** Parses `check (audience = ANY (ARRAY['a'::text, …]))` into its values. */
function admittedValues(def: string): string[] {
  return [...def.matchAll(/'((?:[^']|'')*)'::text/g)].map((m) =>
    m[1].replace(/''/g, "'"),
  );
}

async function constraintDef(name: string): Promise<string> {
  const { rows } = await pg.admin.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.announcements'::regclass and conname = $1`,
    [name],
  );
  expect(rows.length, `${name} is not on public.announcements`).toBe(1);
  return rows[0].def as string;
}

async function publish(over: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = {
    body_en: "We are closed for Dashain.",
    body_ne: "दसैंमा बन्द छ।",
    audience: "everyone",
    ...over,
  };
  const keys = Object.keys(row);
  const { rows } = await pg.admin.query(
    `insert into public.announcements (${keys.join(", ")})
     values (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     returning id`,
    keys.map((k) => row[k]),
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  pg = await startPostgres();
  for (const [id, role, phone] of [
    [ADMIN, "admin", "+9779813000555"],
    [CUSTOMER, "customer", "+9779813000556"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, 'Someone', $2, $3)
       on conflict (id) do update set role = excluded.role`,
      [id, phone, role],
    );
  }
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the closed sets are one list written twice", () => {
  it("admits exactly the audiences the form offers", async () => {
    const def = await constraintDef("announcements_audience_check");
    expect(admittedValues(def).sort()).toEqual(
      [...ANNOUNCEMENT_AUDIENCES].sort(),
    );
  });

  it("admits exactly the tones the form offers", async () => {
    const def = await constraintDef("announcements_tone_check");
    expect(admittedValues(def).sort()).toEqual([...ANNOUNCEMENT_TONES].sort());
  });

  it("refuses a value neither list names", async () => {
    /*
     * BEHAVIOURAL AS WELL AS TEXTUAL. The two cases above compare lists; this
     * one proves the constraint is actually enforced, which a constraint
     * created `NOT VALID` or dropped by a later migration would not be.
     */
    await expect(publish({ audience: "staff" })).rejects.toThrow(
      /announcements_audience_check/,
    );
    await expect(publish({ tone: "shouting" })).rejects.toThrow(
      /announcements_tone_check/,
    );
  });
});

describe("both languages or nothing", () => {
  it("refuses a banner with only English", async () => {
    await expect(
      pg.admin.query(
        `insert into public.announcements (body_en, audience)
         values ('English only', 'everyone')`,
      ),
    ).rejects.toThrow(/body_ne/);
  });

  it("refuses a blank or whitespace-only sentence", async () => {
    /*
     * RULE 5, AND THE ONE PLACE A MISSING TRANSLATION IS INVISIBLE: a Nepali
     * reader meeting an English banner assumes it was meant that way rather
     * than that somebody forgot. NOT NULL alone would accept a space, so the
     * column's own check is `length(btrim(…)) > 0` and this is what proves it.
     */
    await expect(publish({ body_ne: "   " })).rejects.toThrow(
      /announcements_body_ne_check/,
    );
    await expect(publish({ body_en: "" })).rejects.toThrow(
      /announcements_body_en_check/,
    );
  });
});

describe("the window", () => {
  it("refuses an end at or before its start", async () => {
    await expect(
      publish({
        starts_at: "2026-10-20T00:00:00Z",
        ends_at: "2026-10-19T00:00:00Z",
      }),
    ).rejects.toThrow(/announcements_window/);
    await expect(
      publish({
        starts_at: "2026-10-20T00:00:00Z",
        ends_at: "2026-10-20T00:00:00Z",
      }),
    ).rejects.toThrow(/announcements_window/);
  });

  it("accepts no end at all, which is the common case", async () => {
    const id = await publish({ ends_at: null });
    const { rows } = await pg.admin.query(
      "select ends_at from public.announcements where id = $1",
      [id],
    );
    /* NULL is "until somebody takes it down", never "for ever by accident" —
       and never a far-future date standing in for it. */
    expect(rows[0].ends_at).toBeNull();
  });

  it("keeps the switch and the window independent, unlike categories", async () => {
    /*
     * THE REFLEX THIS GUARDS AGAINST. `categories_retired_shape` exists because
     * `is_active` and `retired_at` are one fact in two columns; the obvious next
     * move is to tie `enabled` to the window the same way, and it would be
     * wrong. A banner switched off INSIDE its window is a real state — the
     * outage ended early, or the sentence was wrong — and it is the row
     * `setAnnouncementEnabled` writes. If a constraint ever refuses this, the
     * take-down path has no row to write.
     */
    const id = await publish({
      starts_at: "2020-01-01T00:00:00Z",
      ends_at: "2099-01-01T00:00:00Z",
      enabled: false,
    });
    const { rows } = await pg.admin.query(
      "select enabled from public.announcements where id = $1",
      [id],
    );
    expect(rows[0].enabled).toBe(false);
  });

  it("defaults to showing from now, as an ordinary notice", async () => {
    const id = await publish();
    const { rows } = await pg.admin.query(
      `select tone, enabled, ends_at,
              starts_at <= now() as started,
              now() - starts_at < interval '1 minute' as just_now
         from public.announcements where id = $1`,
      [id],
    );
    expect(rows[0].tone).toBe("notice");
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].ends_at).toBeNull();
    expect(rows[0].started).toBe(true);
    expect(rows[0].just_now).toBe(true);
  });
});

describe("anybody reads one, nobody but the server writes one", () => {
  it("lets a stranger with no session read it", async () => {
    /*
     * THE LANDING PAGE HAS NO SESSION, which is the whole reason the policy is
     * `using (true)` for `anon` — and the reason the read goes through the
     * cookie-free client rather than the service role: a policy nothing walks
     * through is a door nobody notices has been left open, which is what
     * `provider_applications`' write policies turned out to be.
     */
    await publish({ body_en: "Readable by anybody.", audience: "customer" });
    const anon = await pg.asAnon();
    try {
      const { rows } = await anon.query(
        "select body_en, body_ne, audience, tone from public.announcements",
      );
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await anon.end();
    }
  });

  it("reads a withdrawn and a future banner too, because RLS is a floor", async () => {
    /*
     * `showingNow` IS THE FILTER AND IT IS NOT THE POLICY'S JOB. The admin
     * screen, the banner and the unit tests all need one rule, and a `now()`
     * inside a policy would be a second copy of it that could disagree. A
     * withdrawn or unstarted banner being readable costs nothing: it is copy we
     * wrote and chose not to show yet, with no person and no amount in it.
     */
    const id = await publish({
      body_en: "Not showing yet.",
      starts_at: "2099-01-01T00:00:00Z",
      enabled: false,
    });
    const anon = await pg.asAnon();
    try {
      const { rows } = await anon.query(
        "select enabled from public.announcements where id = $1",
        [id],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].enabled).toBe(false);
    } finally {
      await anon.end();
    }
  });

  it("gives a browser the eight columns it reads and not the two staff ids", async () => {
    /*
     * THE COLUMNS, NOT THE TABLE — `profiles`' own lesson, where a table-wide
     * UPDATE grant on a correct row-level policy let any customer write their
     * own `role`. Nothing here is that dangerous: `created_by` is a staff UUID
     * with no name attached. But `liveAnnouncements` selects exactly eight
     * columns and the admin list reads the other two through the service role,
     * so a grant matching the read costs nothing — and this case is what stops
     * it silently widening back, since Postgres's own HINT on a column refusal
     * recommends granting the whole table.
     */
    await publish({ body_en: "Who published me." });
    const anon = await pg.asAnon();
    try {
      await expect(
        anon.query("select created_by from public.announcements"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        anon.query("select updated_by from public.announcements"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        anon.query("select * from public.announcements"),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await anon.end();
    }
  });

  it("refuses a signed-in customer putting up a banner of their own", async () => {
    const user = await pg.asUser(CUSTOMER);
    try {
      await expect(
        user.query(
          `insert into public.announcements (body_en, body_ne, audience)
           values ('Buy my thing', 'मेरो सामान किन्नू', 'everyone')`,
        ),
      ).rejects.toThrow(BROWSER_WRITE_REFUSED);
    } finally {
      await user.end();
    }
  });

  it("refuses an admin's own browser editing or deleting one directly", async () => {
    /*
     * EVEN AN ADMIN'S BROWSER, because every write goes through
     * `lib/data/announcements-admin.ts` under the service role behind the admin
     * gate — which is what guarantees an audit row exists for the change. A
     * browser-side update would move the sentence on every page with nothing in
     * `security_events` to say who did it.
     */
    const id = await publish({ body_en: "Mine to edit." });
    const admin = await pg.asUser(ADMIN);
    try {
      await expect(
        admin.query(
          "update public.announcements set body_en = 'changed' where id = $1",
          [id],
        ),
      ).rejects.toThrow(BROWSER_WRITE_REFUSED);
      await expect(
        admin.query("delete from public.announcements where id = $1", [id]),
      ).rejects.toThrow(BROWSER_WRITE_REFUSED);
    } finally {
      await admin.end();
    }
  });

  it("refuses a stranger too", async () => {
    const anon = await pg.asAnon();
    try {
      await expect(
        anon.query(
          `insert into public.announcements (body_en, body_ne, audience)
           values ('From nobody', 'कोही होइन', 'everyone')`,
        ),
      ).rejects.toThrow(BROWSER_WRITE_REFUSED);
    } finally {
      await anon.end();
    }
  });
});
