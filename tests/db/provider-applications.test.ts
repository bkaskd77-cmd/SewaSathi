import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { matchKeysFor } from "@/lib/verification";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * Provider onboarding, against real Postgres with real policies.
 *
 * These are the assertions that cannot be made anywhere else. The unit tests
 * prove the RULES are right; only this proves the DATABASE enforces them when
 * the caller is a browser holding somebody's JWT rather than our own server
 * code being polite.
 *
 * Every hole found in this product so far was found here rather than by
 * reading the code — policy recursion, the money bug, the address-ownership
 * gap — and all three looked fine on the page.
 */

const SHYAM = "11111111-1111-4111-8111-111111111111";
const MANOJ = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";

let pg: Harness;
let shyamApplication: string;
let manojApplication: string;

/** The same hashing the data layer does. Kind included, so kinds cannot collide. */
function hash(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [SHYAM, "Shyam Shrestha", "customer"],
    [MANOJ, "Manoj Yadav", "customer"],
    [ADMIN, "Admin", "admin"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update
         set full_name = excluded.full_name, role = excluded.role`,
      [id, name, `+9779800000${id.slice(0, 3)}`, role],
    );
  }

  const application = async (owner: string, name: string) => {
    const { rows } = await pg.admin.query(
      `insert into public.provider_applications
         (profile_id, full_name, trades, service_areas, citizenship_number,
          payout_method, payout_account)
       values ($1, $2, '{plumbing}', '{lalitpur-4}', '12-01-70-01234',
               'esewa', '9801234567')
       returning id`,
      [owner, name],
    );
    return rows[0].id as string;
  };

  shyamApplication = await application(SHYAM, "Shyam Shrestha");
  manojApplication = await application(MANOJ, "Manoj Yadav");
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("an application belongs to the person who made it", () => {
  it("lets an applicant read their own", async () => {
    const client = await pg.asUser(SHYAM);
    const { rows } = await client.query(
      "select id from public.provider_applications where id = $1",
      [shyamApplication],
    );
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("hides one applicant's application from another", async () => {
    const client = await pg.asUser(MANOJ);
    const { rows } = await client.query(
      "select id from public.provider_applications where id = $1",
      [shyamApplication],
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("lets an admin read every application", async () => {
    const client = await pg.asUser(ADMIN);
    const { rows } = await client.query(
      "select id from public.provider_applications",
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await client.end();
  });

  it("shows nothing at all to somebody logged out", async () => {
    const client = await pg.asAnon();
    const { rows } = await client.query(
      "select id from public.provider_applications",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("an applicant cannot approve themselves", () => {
  /*
   * THE TRAP THIS COVERS. RLS is row-level: the update policy that lets
   * somebody edit their own draft also lets them write every column on it,
   * including `status`. Postgres has no per-column clause, so the trigger is
   * the actual rule and the policy only decides which rows are theirs. This is
   * the same shape as the bug that let a customer set their own
   * `final_amount`, which was found here and not by reading the code.
   */

  it("refuses a status jump straight to approved", async () => {
    const client = await pg.asUser(SHYAM);
    await expect(
      client.query(
        "update public.provider_applications set status = 'approved' where id = $1",
        [shyamApplication],
      ),
    ).rejects.toThrow(/not the applicant's to set/i);
    await client.end();
  });

  it("refuses an applicant setting their own risk score", async () => {
    const client = await pg.asUser(SHYAM);
    await expect(
      client.query(
        "update public.provider_applications set risk_score = 0 where id = $1",
        [shyamApplication],
      ),
    ).rejects.toThrow(/set by the server/i);
    await client.end();
  });

  it("refuses handing an application to somebody else", async () => {
    const client = await pg.asUser(SHYAM);
    await expect(
      client.query(
        "update public.provider_applications set profile_id = $2 where id = $1",
        [shyamApplication, MANOJ],
      ),
    ).rejects.toThrow(/cannot change hands/i);
    await client.end();
  });

  it("does allow them to submit their own draft", async () => {
    /*
     * And this is the half that must keep working. The SELECT policy carries
     * no status condition precisely so this update does not make the row
     * invisible to its own writer mid-statement — the trap that stopped a
     * professional releasing their own job in Phase 8.
     */
    const client = await pg.asUser(MANOJ);
    await client.query(
      "update public.provider_applications set status = 'submitted' where id = $1",
      [manojApplication],
    );
    const { rows } = await client.query(
      "select status from public.provider_applications where id = $1",
      [manojApplication],
    );
    expect(rows[0].status).toBe("submitted");
    await client.end();

    // Put it back so the later tests see a draft.
    await pg.admin.query(
      "update public.provider_applications set status = 'draft' where id = $1",
      [manojApplication],
    );
  });

  it("refuses an applicant editing somebody else's draft", async () => {
    const client = await pg.asUser(MANOJ);
    const result = await client.query(
      "update public.provider_applications set full_name = 'Hijacked' where id = $1",
      [shyamApplication],
    );
    // No error, no rows: the policy simply does not match it, which is the
    // correct answer — an error would confirm the row exists.
    expect(result.rowCount).toBe(0);
    await client.end();
  });
});

describe("documents belong to one person and nobody else", () => {
  beforeAll(async () => {
    await pg.admin.query(
      `insert into public.provider_documents
         (profile_id, application_id, kind, storage_path, mime_type, byte_size)
       values ($1, $2, 'citizenship', $3, 'image/jpeg', 120000)`,
      [SHYAM, shyamApplication, `${SHYAM}/citizenship/doc-1`],
    );
  });

  it("lets the owner read their own document row", async () => {
    const client = await pg.asUser(SHYAM);
    const { rows } = await client.query(
      "select id from public.provider_documents where profile_id = $1",
      [SHYAM],
    );
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("hides one provider's documents from another", async () => {
    // A photograph of somebody's citizenship certificate is the single most
    // sensitive thing this product holds.
    const client = await pg.asUser(MANOJ);
    const { rows } = await client.query(
      "select id from public.provider_documents",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("shows nothing to an unauthenticated caller", async () => {
    const client = await pg.asAnon();
    const { rows } = await client.query(
      "select id, storage_path from public.provider_documents",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });

  it("does not let anybody insert a document row from a browser", async () => {
    // There is no insert policy for anyone. Uploads go through the server,
    // which checks consent first — a row a client can write is a row that can
    // be written without consent.
    const client = await pg.asUser(SHYAM);
    await expect(
      client.query(
        `insert into public.provider_documents
           (profile_id, kind, storage_path, mime_type, byte_size)
         values ($1, 'selfie', $2, 'image/jpeg', 1000)`,
        [SHYAM, `${SHYAM}/selfie/forged`],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.end();
  });
});

describe("consent cannot be forged from a browser", () => {
  beforeAll(async () => {
    await pg.admin.query(
      `insert into public.application_consents
         (application_id, profile_id, consent_version, scope)
       values ($1, $2, '2026-09-10.1', '{citizenship,selfie}')`,
      [shyamApplication, SHYAM],
    );
  });

  it("lets somebody read the consent they gave", async () => {
    const client = await pg.asUser(SHYAM);
    const { rows } = await client.query(
      "select consent_version from public.application_consents",
    );
    expect(rows).toHaveLength(1);
    await client.end();
  });

  it("refuses a client writing its own consent row", async () => {
    /*
     * The row that would be produced if anybody asked under the Individual
     * Privacy Act. A consent a browser can write is a consent an attacker can
     * write, and the timestamp would be theirs rather than the server's.
     */
    const client = await pg.asUser(MANOJ);
    await expect(
      client.query(
        `insert into public.application_consents
           (application_id, profile_id, consent_version, scope)
         values ($1, $2, '2026-09-10.1', '{citizenship}')`,
        [manojApplication, MANOJ],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.end();
  });

  it("hides one person's consent from another", async () => {
    const client = await pg.asUser(MANOJ);
    const { rows } = await client.query(
      "select id from public.application_consents",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("a rejected applicant cannot come back on a new number", () => {
  /*
   * THE ATTACK THE WHOLE PHASE EXISTS TO STOP, end to end and against the real
   * indexes: somebody rejected for cause buys a new SIM, makes a new account,
   * spells their name the way the other document spells it, and applies again.
   */

  it("finds them on the identifiers they could not cheaply change", async () => {
    // The original, rejected.
    const rejected = await pg.admin.query(
      `insert into public.provider_applications
         (profile_id, full_name, trades, service_areas, citizenship_number,
          payout_account, status)
       values ($1, 'Shyam Kumar Shrestha', '{plumbing}', '{lalitpur-4}',
               '12-01-70-01234', '9801234567', 'rejected')
       returning id`,
      [ADMIN],
    );
    const rejectedId = rejected.rows[0].id as string;

    const originalKeys = matchKeysFor({
      documentNumbers: ["12-01-70-01234"],
      accounts: ["9801234567"],
      fullName: "Shyam Kumar Shrestha",
    });
    for (const key of originalKeys) {
      await pg.admin.query(
        `insert into public.application_match_keys (application_id, kind, key_hash)
         values ($1, $2, $3)`,
        [rejectedId, key.kind, hash(key.kind, key.value)],
      );
    }

    /*
     * The return. New phone, new account, and the name written the other way —
     * Devanagari numerals on the citizenship number, the middle name dropped,
     * "Syam" rather than "Shyam", and the country code on the wallet.
     */
    const returningKeys = matchKeysFor({
      documentNumbers: ["१२०१७००१२३४"],
      accounts: ["+977 9801234567"],
      fullName: "Syam Shrestha",
    });

    const { rows } = await pg.admin.query(
      `select k.kind, a.status
         from public.application_match_keys k
         join public.provider_applications a on a.id = k.application_id
        where k.key_hash = any($1::text[])`,
      [returningKeys.map((key) => hash(key.kind, key.value))],
    );

    const caughtOn = new Set(rows.map((row) => row.kind as string));
    expect(caughtOn.has("document")).toBe(true);
    expect(caughtOn.has("account")).toBe(true);
    expect(caughtOn.has("name")).toBe(true);
    expect(rows.every((row) => row.status === "rejected")).toBe(true);
  });

  it("keeps the hashed keys away from every browser", async () => {
    // Hashed already, so a leak reveals little — but a table of identity keys
    // still has no business being readable from a phone.
    const applicant = await pg.asUser(SHYAM);
    const { rows: applicantRows } = await applicant.query(
      "select id from public.application_match_keys",
    );
    expect(applicantRows).toHaveLength(0);
    await applicant.end();

    const anon = await pg.asAnon();
    const { rows: anonRows } = await anon.query(
      "select id from public.application_match_keys",
    );
    expect(anonRows).toHaveLength(0);
    await anon.end();
  });

  it("never stores an empty key, which would match every blank field", async () => {
    // The bug that turns a duplicate check into a machine for flagging honest
    // people: everybody who left the PAN field blank matching everybody else.
    const keys = matchKeysFor({
      documentNumbers: ["", "   ", "--/--"],
      accounts: [""],
      fullName: "",
    });
    expect(keys).toEqual([]);
  });
});

describe("decisions and assessments cannot be rewritten", () => {
  it("refuses an update to a decision, even as the owner", async () => {
    /*
     * The trigger refuses for EVERY caller, the service role included — the
     * same rule as security_events. A decision the application can edit is not
     * a record of anything.
     */
    const { rows } = await pg.admin.query(
      `insert into public.application_decisions
         (application_id, decision, decided_by, reason)
       values ($1, 'rejected', $2, 'Police clearance was missing.')
       returning id`,
      [shyamApplication, ADMIN],
    );
    const decisionId = rows[0].id as string;

    await expect(
      pg.admin.query(
        "update public.application_decisions set reason = 'Changed my mind' where id = $1",
        [decisionId],
      ),
    ).rejects.toThrow(/append-only/i);

    await expect(
      pg.admin.query("delete from public.application_decisions where id = $1", [
        decisionId,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses an update to an assessment", async () => {
    const { rows } = await pg.admin.query(
      `insert into public.application_assessments
         (application_id, category_slug, assessor_id, result, notes)
       values ($1, 'plumbing', $2, 'pass', 'Sweated a joint cleanly, first go.')
       returning id`,
      [shyamApplication, ADMIN],
    );

    await expect(
      pg.admin.query(
        "update public.application_assessments set result = 'fail' where id = $1",
        [rows[0].id],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("keeps an applicant from reading the assessment written about them", async () => {
    // A reviewer who knows the subject will read their notes writes different
    // notes. The decision's reason reaches them through the product instead,
    // worded for them.
    const client = await pg.asUser(SHYAM);
    const { rows } = await client.query(
      "select id from public.application_assessments",
    );
    expect(rows).toHaveLength(0);
    await client.end();
  });
});

describe("one open application per person", () => {
  it("refuses a second draft while one is already open", async () => {
    // Not one per person ever — somebody rejected for a missing clearance
    // comes back with it. This stops a queue filling with duplicates from
    // somebody tapping twice, which is the actual failure.
    await expect(
      pg.admin.query(
        `insert into public.provider_applications (profile_id, full_name)
         values ($1, 'Shyam again')`,
        [SHYAM],
      ),
    ).rejects.toThrow(/provider_applications_one_open_idx|duplicate key/i);
  });

  it("allows a fresh application once the last one was rejected", async () => {
    const { rows } = await pg.admin.query(
      `insert into public.provider_applications (profile_id, full_name, status)
       values ($1, 'Someone rejected', 'rejected')
       returning id`,
      [MANOJ],
    );
    expect(rows[0].id).toBeTruthy();
    await pg.admin.query("delete from public.provider_applications where id = $1", [
      rows[0].id,
    ]);
  });
});
