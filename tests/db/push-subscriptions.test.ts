import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";
import { BROWSER_WRITE_REFUSED } from "../support/refusals";

/**
 * Who may write a push subscription, and who may read one.
 *
 * THE HOLE THIS TABLE WAS ONE POLICY AWAY FROM. A subscription arrives from a
 * browser, so the obvious design is an insert policy for `authenticated` — and
 * that is a row whose `profile_id` the browser chooses. Subscribing your own
 * phone to somebody else's account would deliver their booking progress, their
 * arrival notices and the warning that their payout destination has been
 * changed, straight to you. The answer is that no browser writes this table at
 * all: `lib/data/push.ts` writes it under the service role, having re-read the
 * session and named the actor itself.
 *
 * `listBookings()` IS WHY THIS IS A TEST AND NOT A COMMENT. A read that named
 * nobody showed an admin every customer's bookings for months, and nine reads
 * had the same shape. The grant is what makes "no browser writes this" a fact
 * the planner enforces rather than a convention the next person inherits.
 */

let pg: Harness;

const ANITA = "aaaaaaaa-9b11-4b11-8b11-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-9b22-4b22-8b22-bbbbbbbbbbbb";
const ADMIN = "cccccccc-9b33-4b33-8b33-cccccccccccc";

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
    [ADMIN, "Staff", "admin"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779816${id.slice(0, 6)}`, role],
    );
  }

  await pg.admin.query(
    `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, locale)
     values ($1, 'https://push.example.test/anita', 'key', 'auth', 'ne')`,
    [ANITA],
  );
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("no browser writes a subscription", () => {
  it("refuses a signed-in customer subscribing themselves", async () => {
    /*
     * DELIBERATELY THEIR OWN ROW — the case somebody would be tempted to open
     * with a policy, because it looks harmless. It is refused so that the
     * dangerous version cannot be reached by relaxing it slightly later.
     */
    const asCustomer = await pg.asUser(ANITA);
    await expect(
      asCustomer.query(
        `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
         values ($1, 'https://push.example.test/self', 'k', 'a')`,
        [ANITA],
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });

  it("refuses a signed-in customer subscribing somebody else", async () => {
    // The finding this table exists to prevent: somebody else's notifications
    // delivered to your phone, including that their payout destination moved.
    const asCustomer = await pg.asUser(ANITA);
    await expect(
      asCustomer.query(
        `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
         values ($1, 'https://push.example.test/theft', 'k', 'a')`,
        [KRISHNA],
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });

  it("refuses a stranger", async () => {
    const anon = await pg.asAnon();
    await expect(
      anon.query(
        `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
         values ($1, 'https://push.example.test/anon', 'k', 'a')`,
        [ANITA],
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });

  it("refuses a signed-in caller deleting somebody else's", async () => {
    /*
     * A QUIET WAY TO SILENCE SOMEBODY. Deleting a professional's subscription
     * stops them hearing that their payout destination changed — the one
     * notification whose whole value is reaching a person who did not make the
     * change.
     */
    const asProvider = await pg.asUser(KRISHNA);
    await expect(
      asProvider.query(
        "delete from public.push_subscriptions where profile_id = $1",
        [ANITA],
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });
});

describe("who may read one", () => {
  it("refuses a signed-in customer reading their own", async () => {
    /*
     * THEIR OWN, AND STILL NO. There is nothing for a person to read here: the
     * browser already knows its own subscription and asks its own push manager,
     * which is both faster and the only answer that cannot be stale. A policy
     * to show somebody a row they could already produce would put endpoints
     * into responses, caches and screenshots for nothing.
     */
    const asCustomer = await pg.asUser(ANITA);
    const { rows } = await asCustomer.query(
      "select endpoint from public.push_subscriptions",
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a stranger", async () => {
    const anon = await pg.asAnon();
    await expect(
      anon.query("select 1 from public.push_subscriptions"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("lets an admin read them", async () => {
    // Someone has to be able to answer "why did this person stop getting
    // notifications", and that is a support question with a real screen behind
    // it one day.
    const asAdmin = await pg.asUser(ADMIN);
    const { rows } = await asAdmin.query(
      "select endpoint from public.push_subscriptions",
    );
    expect(rows).toHaveLength(1);
  });
});

describe("one row per browser", () => {
  it("refuses a second row for the same endpoint", async () => {
    /*
     * A DUPLICATE MEANS EVERY NOTIFICATION ARRIVES TWICE ON ONE PHONE, which
     * reads as a broken product rather than as a database detail. The unique
     * index is what makes `savePushSubscription`'s upsert a replacement.
     */
    await expect(
      pg.admin.query(
        `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
         values ($1, 'https://push.example.test/anita', 'k', 'a')`,
        [KRISHNA],
      ),
    ).rejects.toThrow(/push_subscriptions_endpoint_key|duplicate key/i);
  });

  it("lets the same browser be re-recorded in place", async () => {
    await pg.admin.query(
      `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, locale, gone_at)
       values ($1, 'https://push.example.test/anita', 'rotated', 'auth2', 'en', null)
       on conflict (endpoint) do update
         set p256dh = excluded.p256dh,
             auth = excluded.auth,
             locale = excluded.locale,
             gone_at = null`,
      [ANITA],
    );
    const { rows } = await pg.admin.query(
      "select p256dh, locale, gone_at from public.push_subscriptions where endpoint = $1",
      ["https://push.example.test/anita"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("rotated");
    expect(rows[0].locale).toBe("en");
    expect(rows[0].gone_at).toBeNull();
  });

  it("refuses a locale that is not one we publish", async () => {
    await expect(
      pg.admin.query(
        `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, locale)
         values ($1, 'https://push.example.test/hi', 'k', 'a', 'hi')`,
        [ANITA],
      ),
    ).rejects.toThrow(/push_subscriptions_locale_check/i);
  });

  it("accepts a null locale as 'not recorded'", async () => {
    // Rule 6. A row written before that column meant anything falls back to
    // `profiles.preferred_language`, which is the answer the person gave.
    await expect(
      pg.admin.query(
        `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
         values ($1, 'https://push.example.test/nolocale', 'k', 'a')`,
        [KRISHNA],
      ),
    ).resolves.toBeTruthy();
  });
});

describe("a dead endpoint is stamped, not deleted", () => {
  it("keeps the row so a silence can be explained", async () => {
    /*
     * A sweep that deletes on the first refusal cannot tell "this browser is
     * gone" from "the push service had a bad minute", and a deleted row is a
     * person who silently stops being notified with nothing left to say why.
     */
    await pg.admin.query(
      "update public.push_subscriptions set gone_at = now() where endpoint = $1",
      ["https://push.example.test/nolocale"],
    );
    const { rows } = await pg.admin.query(
      "select gone_at from public.push_subscriptions where endpoint = $1",
      ["https://push.example.test/nolocale"],
    );
    expect(rows[0].gone_at).not.toBeNull();
  });
});
