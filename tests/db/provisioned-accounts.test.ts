import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * A role that is waiting before the person is.
 *
 * This is a privilege path, so it gets the same treatment as every other one
 * in the product: proved against a real Postgres running the real migrations,
 * from both directions — that the grant lands when it should, and that nobody
 * who is not the service role can write one.
 *
 * The second half is the half that matters. A grant table that authenticated
 * users can insert into is not a convenience, it is a self-service admin
 * button, and RLS being enabled says nothing on its own about which policies
 * exist.
 */

let pg: Harness;

const GRANTED_ADMIN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const GRANTED_PROVIDER = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const UNGRANTED = "cccccccc-3333-4333-8333-cccccccccccc";
const OUTSIDER = "dddddddd-4444-4444-8444-dddddddddddd";

/** A seed listing to hand to the provider grant. */
let listingId: string;

beforeAll(async () => {
  pg = await startPostgres();

  const listing = await pg.admin.query<{ id: string }>(
    "select id from public.providers where profile_id is null limit 1",
  );
  listingId = listing.rows[0].id;

  await pg.admin.query(
    `insert into public.provisioned_accounts (phone, role, label, provider_id)
     values ('9779800000091', 'admin', 'test admin grant', null),
            ('9779800000092', 'provider', 'test provider grant', $1)`,
    [listingId],
  );
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

/** Signing up is an insert into auth.users; the trigger does the rest. */
async function signUp(id: string, phone: string): Promise<void> {
  await pg.admin.query("insert into auth.users (id, phone) values ($1, $2)", [
    id,
    phone,
  ]);
}

async function roleOf(id: string): Promise<string | undefined> {
  const { rows } = await pg.admin.query<{ role: string }>(
    "select role from public.profiles where id = $1",
    [id],
  );
  return rows[0]?.role;
}

describe("a granted number arrives with its role", () => {
  it("makes a granted admin an admin at signup, with no manual UPDATE", async () => {
    await signUp(GRANTED_ADMIN, "9779800000091");
    expect(await roleOf(GRANTED_ADMIN)).toBe("admin");
  });

  it("gives an ungranted number the ordinary customer role", async () => {
    // The default has to survive the change, or every new customer becomes
    // whatever the last grant happened to say.
    await signUp(UNGRANTED, "9779800000099");
    expect(await roleOf(UNGRANTED)).toBe("customer");
  });

  it("links the provider grant to its listing", async () => {
    // Without this a provider walkthrough reaches /provider/jobs and is told
    // its account is not linked to a listing, which is a dead end.
    await signUp(GRANTED_PROVIDER, "9779800000092");
    expect(await roleOf(GRANTED_PROVIDER)).toBe("provider");

    const { rows } = await pg.admin.query<{ profile_id: string | null }>(
      "select profile_id from public.providers where id = $1",
      [listingId],
    );
    expect(rows[0].profile_id).toBe(GRANTED_PROVIDER);
  });

  it("marks the grant claimed, and by whom", async () => {
    const { rows } = await pg.admin.query<{
      claimed_at: Date | null;
      claimed_by: string | null;
    }>(
      "select claimed_at, claimed_by from public.provisioned_accounts where phone = '9779800000091'",
    );
    expect(rows[0].claimed_at).not.toBeNull();
    expect(rows[0].claimed_by).toBe(GRANTED_ADMIN);
  });

  it("writes the grant to the append-only log", async () => {
    // A privilege grant that leaves no trace is a back door. `security_events`
    // refuses UPDATE and DELETE for every caller, service role included, so
    // this cannot be used and then tidied away.
    const { rows } = await pg.admin.query<{ detail: Record<string, unknown> }>(
      `select detail from public.security_events
        where kind = 'role.changed' and actor_id = $1`,
      [GRANTED_ADMIN],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({
      via: "provisionedAccount",
      role: "admin",
    });
  });
});

describe("nobody can grant themselves anything", () => {
  it("refuses an insert from an ordinary signed-in user", async () => {
    // No insert policy exists for anybody, so this is not "denied by a rule
    // that could be widened" — there is no rule to widen.
    const client = await pg.asUser(UNGRANTED);
    await expect(
      client.query(
        "insert into public.provisioned_accounts (phone, role, label) values ('9779800000093', 'admin', 'mine now')",
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
    await client.end();
  });

  it("refuses an insert from an anonymous caller", async () => {
    const client = await pg.asAnon();
    await expect(
      client.query(
        "insert into public.provisioned_accounts (phone, role, label) values ('9779800000094', 'admin', 'mine now')",
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
    await client.end();
  });

  it("refuses an ordinary user promoting an existing grant to admin", async () => {
    // The grant that matters is not the one you insert, it is the one you
    // repoint at your own number. There is no update policy either.
    const client = await pg.asUser(UNGRANTED);
    const result = await client
      .query(
        "update public.provisioned_accounts set role = 'admin' where phone = '9779800000099'",
      )
      .catch(() => ({ rowCount: 0 }));
    expect(result.rowCount).toBe(0);
    await client.end();
  });

  it("hides every grant from a signed-in user who is not an admin", async () => {
    // Not a secret exactly — but a readable list of which numbers are admin is
    // a target list, and it costs nothing to withhold.
    const client = await pg.asUser(OUTSIDER);
    const { rows } = await client.query(
      "select phone from public.provisioned_accounts",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("lets an admin read them, because deciding to remove one means seeing it", async () => {
    const client = await pg.asUser(GRANTED_ADMIN);
    const { rows } = await client.query(
      "select phone from public.provisioned_accounts",
    );
    expect(rows.length).toBeGreaterThan(0);
    await client.end();
  });
});
