import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { doubtsOnRow, inspectionRequired } from "@/lib/photos/evidence";
import { startPostgres, type Harness } from "../support/postgres";

/**
 * Claim evidence, against the real constraints.
 *
 * THE RULE WORTH THE WHOLE FILE: the three answers that mean "this is not evidence"
 * cannot be stored. `lib/photos/evidence.ts` decides them and gives the customer a
 * sentence they can act on, but a refusal that lives only in the application is one the
 * next caller forgets — and this is the path that ends in a cash refund funded from a
 * professional's future earnings. So no camera clock, a near-duplicate of a photograph
 * from another job, and a capture time before the work finished are refused by the
 * database, for every caller including the service role.
 *
 * The doubts are the other half and they must stay storable, because refusing them would
 * refuse honest claims: a phone clock set wrongly by a week, a picture near one we hold,
 * a picture near the one sent with the booking.
 */

const ANITA = "aaaaaaaa-6111-4111-8111-aaaaaaaaaaaa";
const KRISHNA = "bbbbbbbb-6222-4222-8222-bbbbbbbbbbbb";
const ADMIN = "cccccccc-6333-4333-8333-cccccccccccc";
const STRANGER = "eeeeeeee-6555-4555-8555-eeeeeeeeeeee";

let pg: Harness;
let claimId = "";
let anitaAddress = "";
let krishnaProvider = "";

/** The row the application writes on the happy path, so a case can change one field. */
function sound(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    position: 0,
    taken_at: new Date().toISOString(),
    taken_before_completion: false,
    hash: "0f1e2d3c4b5a6978",
    duplicate_verdict: "unseen",
    duplicate_distance: null,
    freshness_verdict: "fresh",
    booking_photo_match: "different-picture",
    ...overrides,
  };
}

async function insertPhoto(
  claim: string,
  overrides: Record<string, unknown> = {},
) {
  const row = sound(overrides);
  const keys = Object.keys(row);
  return pg.admin.query(
    `insert into public.guarantee_claim_photos
       (claim_id, storage_path, ${keys.join(", ")})
     values ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(", ")})`,
    [claim, `${ANITA}/${claim}-${row.position}.jpg`, ...keys.map((k) => row[k])],
  );
}

async function freshClaim(reference: string): Promise<string> {
  const { rows: bookingRows } = await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, 'plumbing', $4, 'Kitchen tap drips', 900, 4500)
     returning id`,
    [reference, ANITA, krishnaProvider, anitaAddress],
  );
  const bookingId = bookingRows[0].id as string;
  for (const status of ["accepted", "en_route", "in_progress", "completed"]) {
    await pg.admin.query("update public.bookings set status = $1 where id = $2", [
      status,
      bookingId,
    ]);
  }

  const { rows } = await pg.admin.query(
    `insert into public.guarantee_claims
       (booking_id, customer_id, provider_id, category_slug, description)
     values ($1, $2, $3, 'plumbing', 'It is dripping again')
     returning id`,
    [bookingId, ANITA, krishnaProvider],
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
    [ADMIN, "Admin", "admin"],
    [STRANGER, "Passer By", "customer"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779814${id.slice(0, 6)}`, role],
    );
  }

  const { rows: providerRows } = await pg.admin.query(
    `insert into public.providers (profile_id, display_name, base_rate)
     values ($1, 'Krishna Tamang', 900) returning id`,
    [KRISHNA],
  );
  krishnaProvider = providerRows[0].id as string;

  const { rows: addressRows } = await pg.admin.query(
    `insert into public.addresses
       (profile_id, label, area_key, city, ward_number, tole, landmark)
     values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Blue gate')
     returning id`,
    [ANITA],
  );
  anitaAddress = addressRows[0].id as string;

  claimId = await freshClaim("SK-EVID1");
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the three answers this table refuses to hold", () => {
  it("refuses a photograph with no camera clock", async () => {
    const claim = await freshClaim("SK-EVID2");
    await expect(insertPhoto(claim, { taken_at: null })).rejects.toThrow(
      /taken_at/i,
    );
  });

  it("refuses a photograph we have already been sent on another job", async () => {
    /* `reject` is simply not in the allowed set, so there is no verdict a caller can
       write that records a reuse and keeps the photograph. */
    const claim = await freshClaim("SK-EVID3");
    await expect(
      insertPhoto(claim, { duplicate_verdict: "reject", duplicate_distance: 2 }),
    ).rejects.toThrow(/duplicate_verdict/i);
  });

  it("refuses a photograph taken before the work finished", async () => {
    const claim = await freshClaim("SK-EVID4");
    await expect(
      insertPhoto(claim, { taken_before_completion: true }),
    ).rejects.toThrow(/taken_before_completion/i);
  });

  it("refuses one where nobody established the order of the two events", async () => {
    /*
     * TWO GUARDS, EITHER OF WHICH WOULD DO, AND THE MEASUREMENT IS IN THE MIGRATION
     * HEADER. `not null` is what actually refuses this row; `check (… is false)` would
     * refuse it alone if the column were ever made nullable, where `= false` alone
     * accepts it because a NULL CHECK passes. Proven by running all four combinations and
     * watching only the last one go green — the "break it on purpose" step catching a
     * claim in a comment rather than a bug in the code.
     */
    const claim = await freshClaim("SK-EVID5");
    await expect(
      insertPhoto(claim, { taken_before_completion: null }),
    ).rejects.toThrow(/taken_before_completion/i);
  });
});

describe("the doubts stay storable, because refusing them would refuse honest claims", () => {
  it("keeps a photograph whose camera clock is weeks out", async () => {
    const claim = await freshClaim("SK-EVID6");
    await insertPhoto(claim, { freshness_verdict: "stale" });
    const { rows } = await pg.admin.query(
      "select freshness_verdict from public.guarantee_claim_photos where claim_id = $1",
      [claim],
    );
    expect(rows[0].freshness_verdict).toBe("stale");
  });

  it("keeps one near a photograph we hold, with the distance as the evidence", async () => {
    const claim = await freshClaim("SK-EVID7");
    await insertPhoto(claim, {
      duplicate_verdict: "flag",
      duplicate_distance: 7,
    });
    const { rows } = await pg.admin.query(
      "select duplicate_verdict, duplicate_distance from public.guarantee_claim_photos where claim_id = $1",
      [claim],
    );
    expect(rows[0].duplicate_verdict).toBe("flag");
    expect(rows[0].duplicate_distance).toBe(7);
  });

  it("keeps one that is the booking's own photograph", async () => {
    const claim = await freshClaim("SK-EVID8");
    await insertPhoto(claim, { booking_photo_match: "same-picture" });
    const { rows } = await pg.admin.query(
      "select booking_photo_match from public.guarantee_claim_photos where claim_id = $1",
      [claim],
    );
    expect(rows[0].booking_photo_match).toBe("same-picture");
  });

  it("keeps a comparison that failed, as a failure and not as a pass", async () => {
    const claim = await freshClaim("SK-EVID9");
    await insertPhoto(claim, {
      hash: null,
      duplicate_verdict: "not-compared",
      booking_photo_match: "not-compared",
    });
    const { rows } = await pg.admin.query(
      "select duplicate_verdict, booking_photo_match from public.guarantee_claim_photos where claim_id = $1",
      [claim],
    );
    expect(rows[0].duplicate_verdict).toBe("not-compared");
    expect(rows[0].booking_photo_match).toBe("not-compared");
  });
});

describe("three to a claim, counted by a key", () => {
  it("takes three and has nowhere to put a fourth", async () => {
    const claim = await freshClaim("SK-EVID10");
    for (const position of [0, 1, 2]) await insertPhoto(claim, { position });

    await expect(insertPhoto(claim, { position: 3 })).rejects.toThrow(
      /position/i,
    );
    /* And a race for a slot somebody already took is the key's refusal, not a read. */
    await expect(insertPhoto(claim, { position: 2 })).rejects.toThrow(
      /guarantee_claim_photos_one_per_slot/i,
    );
  });
});

describe("who may write, and who may look", () => {
  it("lets no browser write, whatever the policy says", async () => {
    const anita = await pg.asUser(ANITA);
    try {
      await expect(
        anita.query(
          `insert into public.guarantee_claim_photos
             (claim_id, storage_path, position, taken_at, taken_before_completion,
              duplicate_verdict, freshness_verdict)
           values ($1, 'x/y.jpg', 0, now(), false, 'unseen', 'fresh')`,
          [claimId],
        ),
      ).rejects.toThrow(/permission denied|violates row-level security/i);
    } finally {
      await anita.end();
    }
  });

  it("refuses a browser editing a verdict on a photograph that is already evidence", async () => {
    await insertPhoto(claimId, { position: 1 });
    const anita = await pg.asUser(ANITA);
    try {
      await expect(
        anita.query(
          `update public.guarantee_claim_photos
             set freshness_verdict = 'fresh', duplicate_verdict = 'unseen'
           where claim_id = $1`,
          [claimId],
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await anita.end();
    }
  });

  it("shows a customer their own claim's photographs and nobody else's", async () => {
    const anita = await pg.asUser(ANITA);
    const stranger = await pg.asUser(STRANGER);
    const admin = await pg.asUser(ADMIN);
    try {
      const mine = await anita.query(
        "select id from public.guarantee_claim_photos where claim_id = $1",
        [claimId],
      );
      expect(mine.rows.length).toBeGreaterThan(0);

      const theirs = await stranger.query(
        "select id from public.guarantee_claim_photos where claim_id = $1",
        [claimId],
      );
      expect(theirs.rows).toHaveLength(0);

      const seen = await admin.query(
        "select id from public.guarantee_claim_photos where claim_id = $1",
        [claimId],
      );
      expect(seen.rows.length).toBeGreaterThan(0);
    } finally {
      await anita.end();
      await stranger.end();
      await admin.end();
    }
  });

  it("keeps the bucket private and JPEG-only", async () => {
    const { rows } = await pg.admin.query(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'claim-photos'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
    expect(Number(rows[0].file_size_limit)).toBe(2 * 1024 * 1024);
    expect(rows[0].allowed_mime_types).toEqual(["image/jpeg"]);
  });

  it("grants nobody an insert on the bucket", async () => {
    /* The bytes are validated and stripped on the server; a browser that could write here
       could store a photograph carrying the coordinates of somebody's kitchen. */
    const { rows } = await pg.admin.query(
      `select policyname, cmd from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and qual like '%claim-photos%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.cmd).toBe("SELECT");
  });

  it("goes away with the claim it belongs to", async () => {
    const claim = await freshClaim("SK-EVID11");
    await insertPhoto(claim);
    await pg.admin.query("delete from public.guarantee_claims where id = $1", [
      claim,
    ]);
    const { rows } = await pg.admin.query(
      "select id from public.guarantee_claim_photos where claim_id = $1",
      [claim],
    );
    expect(rows).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * The one thing a doubt does
 * ------------------------------------------------------------------ */

/** Walk a claim to `resolved` with a verdict, the only route the machine allows. */
async function inspect(claim: string, verdict: string) {
  await pg.admin.query(
    `update public.guarantee_claims
        set status = 'dispatched', attending_provider_id = $2 where id = $1`,
    [claim, krishnaProvider],
  );
  await pg.admin.query(
    "update public.guarantee_claims set status = 'attended' where id = $1",
    [claim],
  );
  await pg.admin.query(
    `update public.guarantee_claims
        set status = 'resolved', verdict = $2, payer = 'provider' where id = $1`,
    [claim, verdict],
  );
}

/** Settle the booking behind a claim, so a refund has something to come out of. */
async function settle(claim: string) {
  await pg.admin.query(
    `update public.bookings b
        set payment_status = 'paid', final_amount = 3000, completed_at = now()
      from public.guarantee_claims c
      where c.id = $1 and b.id = c.booking_id`,
    [claim],
  );
}

async function tryRefund(claim: string) {
  return pg.admin.query(
    `update public.guarantee_claims
        set refund_rupees = 1200, refund_decided_by = $2 where id = $1`,
    [claim, ADMIN],
  );
}

describe("a doubtful photograph asks for the visit before money goes back", () => {
  it("refuses a refund on a claim whose photograph was stale", async () => {
    const claim = await freshClaim("SK-EVID12");
    await settle(claim);
    await insertPhoto(claim, { freshness_verdict: "stale" });

    await expect(tryRefund(claim)).rejects.toThrow(/needs the visit/i);
  });

  it("refuses one on a near-duplicate, and one on the booking's own photograph", async () => {
    const near = await freshClaim("SK-EVID13");
    await settle(near);
    await insertPhoto(near, { duplicate_verdict: "flag", duplicate_distance: 8 });
    await expect(tryRefund(near)).rejects.toThrow(/needs the visit/i);

    const same = await freshClaim("SK-EVID14");
    await settle(same);
    await insertPhoto(same, { booking_photo_match: "same-picture" });
    await expect(tryRefund(same)).rejects.toThrow(/needs the visit/i);
  });

  it("allows it once somebody has been and found the same fault", async () => {
    const claim = await freshClaim("SK-EVID15");
    await settle(claim);
    await insertPhoto(claim, { freshness_verdict: "stale" });
    await inspect(claim, "sameFault");

    await tryRefund(claim);
    const { rows } = await pg.admin.query(
      "select refund_rupees from public.guarantee_claims where id = $1",
      [claim],
    );
    expect(rows[0].refund_rupees).toBe(1200);
  });

  it("is not lifted by a visit that found something else", async () => {
    const claim = await freshClaim("SK-EVID16");
    await settle(claim);
    await insertPhoto(claim, { freshness_verdict: "stale" });
    await inspect(claim, "differentProblem");

    await expect(tryRefund(claim)).rejects.toThrow(/needs the visit/i);
  });

  it("leaves a claim with no photograph exactly as it was", async () => {
    /* Every claim before this phase. The gate is conditional on the doubt, which is
       what keeps it from being a change to how the guarantee works. */
    const claim = await freshClaim("SK-EVID17");
    await settle(claim);

    await tryRefund(claim);
    const { rows } = await pg.admin.query(
      "select refund_rupees from public.guarantee_claims where id = $1",
      [claim],
    );
    expect(rows[0].refund_rupees).toBe(1200);
  });

  it("does not gate on a comparison we failed to make", async () => {
    /* `not-compared` and `no-reference` are OUR failure and our gap. Gating on them
       would cost the customer a visit for a read that did not happen — rule 6 pointed
       the wrong way round. */
    const claim = await freshClaim("SK-EVID18");
    await settle(claim);
    await insertPhoto(claim, {
      hash: null,
      duplicate_verdict: "not-compared",
      booking_photo_match: "no-reference",
    });

    await tryRefund(claim);
    const { rows } = await pg.admin.query(
      "select refund_rupees from public.guarantee_claims where id = $1",
      [claim],
    );
    expect(rows[0].refund_rupees).toBe(1200);
  });

  /*
   * THE RULE IS WRITTEN TWICE AND THIS IS WHAT KEEPS THE TWO HONEST.
   * `inspectionRequired` runs in TypeScript so `issueRefund` can answer with a sentence;
   * `enforce_claim_refund` runs the same list in SQL so no caller can go round it. The
   * ceiling and the trigger came apart exactly this way once, and the fix then was one
   * fixture through both — the same shape as `materialsRead` in guarantee-claims.test.ts.
   */
  it("agrees with the TypeScript rule on every shape of row", async () => {
    const shapes = [
      { freshness_verdict: "stale" },
      { duplicate_verdict: "flag", duplicate_distance: 9 },
      { booking_photo_match: "same-picture" },
      { duplicate_verdict: "not-compared", hash: null },
      { booking_photo_match: "no-reference" },
      { duplicate_verdict: "retry" },
      {},
    ];

    for (const [index, shape] of shapes.entries()) {
      const claim = await freshClaim(`SK-EVIDX${index}`);
      await settle(claim);
      await insertPhoto(claim, shape);

      const { rows } = await pg.admin.query(
        `select duplicate_verdict, freshness_verdict, booking_photo_match
           from public.guarantee_claim_photos where claim_id = $1`,
        [claim],
      );
      const typescript = inspectionRequired({
        doubts: doubtsOnRow({
          duplicateVerdict: rows[0].duplicate_verdict as string,
          freshnessVerdict: rows[0].freshness_verdict as string,
          bookingPhotoMatch: rows[0].booking_photo_match as string | null,
        }),
        verdict: null,
        status: "open",
      });

      const refused = await tryRefund(claim).then(
        () => false,
        () => true,
      );
      expect(refused, `shape ${JSON.stringify(shape)}`).toBe(
        typescript.required,
      );
    }
  });
});
