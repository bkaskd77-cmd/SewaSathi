import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The content tables, and who may touch them.
 *
 * WHAT THESE TABLES CAN DO IF THEY GO WRONG. `content_strings` feeds
 * `i18n/request.ts`, which every rendered string in the product passes through — so a
 * browser able to write one could change what any page says, in both languages, to
 * anybody. That is a larger surface than anything else a customer can reach, which is
 * why the writes go through the service role and these cases assert it from the
 * browser's side rather than trusting the policy list.
 */
let pg: Harness;

const ADMIN = "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa";
const CUSTOMER = "bbbbbbbb-9999-4999-8999-bbbbbbbbbbbb";

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ADMIN, "Admin", "admin"],
    [CUSTOMER, "Customer", "customer"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      /* The phone is built from a literal rather than from $1: Postgres cannot deduce
         one type for a parameter used as both a uuid and a string. */
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $4, $3)
       on conflict (id) do update set role = excluded.role`,
      [id, name, role, `+97798${id.slice(0, 7)}`],
    );
  }
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("nobody edits the product's words from a browser", () => {
  /*
   * BOTH ROLES, because the risk is not that a customer is malicious — it is that the
   * table is reachable at all. An admin writes through the service role like every
   * other admin action in this product; a grant here would be a second, unaudited path
   * to the same change.
   */
  it("refuses an insert from a customer and from an admin alike", async () => {
    for (const [who, id] of [
      ["a customer", CUSTOMER],
      ["an admin", ADMIN],
    ] as const) {
      const client = await pg.asUser(id);
      const result = await client
        .query(
          `insert into public.content_strings (message_key, locale, value, tier)
           values ('home.lead', 'en', 'anything at all', 'none')`,
        )
        .then(
          () => "allowed",
          (error: { message: string }) => error.message,
        );
      expect(result, `${who} must not be able to write a string`).toMatch(
        /permission denied/i,
      );
      await client.end();
    }
  });

  /* The words on a page are public, so reading them is. Asserted so a later tightening
     cannot break the catalogue without a test saying so. */
  it("lets anybody read them, because they are the words on a page", async () => {
    await pg.admin.query(
      `insert into public.content_strings (message_key, locale, value, tier)
       values ('home.lead', 'en', 'Find a tradesperson', 'none')`,
    );
    const anon = await pg.asAnon();
    const { rows } = await anon.query(
      "select value from public.content_strings where message_key = 'home.lead'",
    );
    expect(rows).toHaveLength(1);
    await anon.end();
  });

  /*
   * THE HISTORY IS STAFF-ONLY, because it carries who changed what — which is about
   * people rather than about the words.
   */
  it("hides the edit history from a customer", async () => {
    await pg.admin.query(
      `insert into public.content_string_revisions
         (message_key, locale, previous_value, new_value, tier)
       values ('home.lead', 'en', null, 'Find a tradesperson', 'none')`,
    );
    const client = await pg.asUser(CUSTOMER);
    const { rows } = await client.query(
      "select id from public.content_string_revisions",
    );
    expect(rows).toEqual([]);
    await client.end();
  });
});

describe("a record of what changed cannot be rewritten", () => {
  /*
   * APPEND-ONLY FOR EVERY CALLER, THE SERVICE ROLE INCLUDED — the `security_events`
   * rule, and the reason is the same one level across: a rollback is only trustworthy
   * if the thing it reads cannot have been edited since. A history the application can
   * tidy proves nothing about what the product used to say.
   */
  it("refuses an update to a revision, even from the server", async () => {
    await expect(
      pg.admin.query(
        "update public.content_string_revisions set new_value = 'rewritten'",
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses a delete of a revision, even from the server", async () => {
    await expect(
      pg.admin.query("delete from public.content_string_revisions"),
    ).rejects.toThrow(/append-only/i);
  });

  /*
   * AND THE SAME FOR A PUBLISHED DOCUMENT VERSION, which is the sharper case: a
   * customer agreed to a specific text, and `bookings.terms_version` points at it. If
   * that text could be edited afterwards, the pointer would name something nobody ever
   * saw — which is worse than having no version at all, because it looks like a record.
   */
  it("refuses an edit to a published document version", async () => {
    await pg.admin.query(
      "insert into public.content_documents (slug) values ('terms')",
    );
    await pg.admin.query(
      `insert into public.content_document_versions
         (slug, version, body_en, body_ne, effective_from)
       values ('terms', 1, 'The terms', 'सर्तहरू', now())`,
    );

    await expect(
      pg.admin.query(
        "update public.content_document_versions set body_en = 'something else'",
      ),
    ).rejects.toThrow(/append-only/i);
  });
});

describe("a category icon a card cannot draw", () => {
  /*
   * THE CONSTRAINT THAT ALREADY CAUGHT SOMETHING. Its first list was written from the
   * seed file's opening rows with the rest guessed, and Postgres refused the migration
   * because `ac-servicing` is `AirVent` and had been guessed as `Wind`. The catalogue
   * renders a lucide component by name, so an unknown name is a blank tile on the grid
   * that is the first thing a customer sees — and an admin can now type one.
   */
  it("is refused, so the grid cannot grow a blank tile", async () => {
    await expect(
      pg.admin.query(
        "update public.categories set icon = 'NotARealIcon' where slug = 'plumbing'",
      ),
    ).rejects.toThrow(/categories_icon_known/i);
  });

  it("allows one the picker actually offers", async () => {
    await pg.admin.query(
      "update public.categories set icon = 'AirVent' where slug = 'plumbing'",
    );
    const { rows } = await pg.admin.query(
      "select icon from public.categories where slug = 'plumbing'",
    );
    expect(rows[0].icon).toBe("AirVent");
  });
});
