import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AREA_KEY_SHAPE } from "@/lib/config/areas";

import { startPostgres, type Harness } from "../support/postgres";
import { BROWSER_WRITE_REFUSED } from "../support/refusals";

/**
 * Service areas: retired, never deleted — and seeded from the file, not from me.
 *
 * THE BOOTSTRAP CASE EXISTS BECAUSE I GOT IT WRONG. The migration generates its
 * fifteen rows from `lib/data/seed/areas.json`, and the file was right; then I
 * applied the insert to production by RETYPING it into a SQL call, and wrote ten
 * place names from memory — "Kalimati" for Kalanki, "Balaju" for Swayambhu,
 * "Jorpati" for Sinamangal, "Dekocha" for Kamalbinayak, and a wrong Devanagari
 * spelling of Kupondole. Nine of fifteen wards were wrong in production, on the
 * names a customer picks their own address from.
 *
 * Nothing could have caught it: no check compared the table to the file, and a
 * plausible-looking Kathmandu ward name is invisible to review. So the first
 * case below compares every column of every seeded row against the JSON, and it
 * is the reason this file exists at all rather than an afterthought in it.
 *
 * THE OTHER RULE IS THAT RETIREMENT IS NOT REMOVAL. `addresses.area_key`,
 * `provider_leads.area_key` and `providers.service_areas` all hold these keys
 * with no foreign key behind them, so deleting a row would orphan live bookings
 * and leave an old booking page unable to say where the job was.
 */

type SeedArea = {
  key: string;
  city: string;
  cityNe: string;
  wardNumber: number;
  name: string;
  nameNe: string;
};

const SEED: SeedArea[] = JSON.parse(
  readFileSync("lib/data/seed/areas.json", "utf8"),
);

const ADMIN = "cccccccc-9444-4444-8444-cccccccccccc";

let pg: Harness;

beforeAll(async () => {
  pg = await startPostgres();
  await pg.admin.query("insert into auth.users (id) values ($1)", [ADMIN]);
  await pg.admin.query(
    `insert into public.profiles (id, full_name, phone, role)
     values ($1, 'Admin', '+9779813000444', 'admin')
     on conflict (id) do update set role = excluded.role`,
    [ADMIN],
  );
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe("the seeded areas are the authored ones", () => {
  it("has a row for every area in the seed, and no stranger", async () => {
    const { rows } = await pg.admin.query("select key from public.areas");
    const live = new Set(rows.map((r) => r.key as string));

    expect(live.size, "rows in public.areas").toBe(SEED.length);
    for (const area of SEED) {
      expect(live.has(area.key), `${area.key} is missing from the table`).toBe(
        true,
      );
    }
  });

  it("matches the seed on every column, Devanagari included", async () => {
    /*
     * THE CASE THAT WOULD HAVE CAUGHT THE REAL BUG. Every column, compared
     * exactly — a place name is not reviewable by eye, and the failure mode is
     * a name that looks like a Kathmandu ward and is a different Kathmandu
     * ward. The message prints both so the diff is readable rather than
     * "expected false to be true".
     */
    const { rows } = await pg.admin.query(
      "select key, city, city_ne, ward_number, name, name_ne from public.areas",
    );
    const byKey = new Map(rows.map((r) => [r.key as string, r]));

    for (const area of SEED) {
      const live = byKey.get(area.key);
      expect(live, area.key).toBeDefined();
      const pairs: Array<[string, unknown, unknown]> = [
        ["city", area.city, live!.city],
        ["city_ne", area.cityNe, live!.city_ne],
        ["ward_number", area.wardNumber, live!.ward_number],
        ["name", area.name, live!.name],
        ["name_ne", area.nameNe, live!.name_ne],
      ];
      for (const [column, authored, stored] of pairs) {
        expect(
          stored,
          `${area.key}.${column}: the seed says ${JSON.stringify(authored)}, ` +
            `the table says ${JSON.stringify(stored)}`,
        ).toBe(authored);
      }
    }
  });

  it("starts with nothing retired", async () => {
    /* Null in all three, which is "we still serve it" and never "unknown". */
    const { rows } = await pg.admin.query(
      `select count(*)::int as n from public.areas
        where retired_at is not null or retired_reason is not null
           or retired_by is not null`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("a retirement is a date, a reason and an actor, or it is nothing", () => {
  it("refuses a date with no reason", async () => {
    await expect(
      pg.admin.query(
        "update public.areas set retired_at = now() where key = 'lalitpur-4'",
      ),
    ).rejects.toThrow(/areas_retired_shape/);
  });

  it("refuses a reason with no date", async () => {
    await expect(
      pg.admin.query(
        "update public.areas set retired_reason = 'nobody there' where key = 'lalitpur-4'",
      ),
    ).rejects.toThrow(/areas_retired_shape/);
  });

  it("refuses a blank reason", async () => {
    /* A withdrawal nobody can answer a question about later is the thing the
       constraint exists for; "   " satisfies not-null and says nothing. */
    await expect(
      pg.admin.query(
        `update public.areas set retired_at = now(), retired_reason = '   '
          where key = 'lalitpur-4'`,
      ),
    ).rejects.toThrow(/areas_retired_shape/);
  });

  it("accepts the whole triple, and lets it be lifted again", async () => {
    await pg.admin.query(
      `update public.areas
          set retired_at = now(), retired_reason = 'no professional there since June',
              retired_by = $1
        where key = 'bhaktapur-9'`,
      [ADMIN],
    );

    const { rows } = await pg.admin.query(
      "select retired_at, retired_reason, retired_by from public.areas where key = 'bhaktapur-9'",
    );
    expect(rows[0].retired_at).not.toBeNull();
    expect(rows[0].retired_reason).toBe("no professional there since June");
    expect(rows[0].retired_by).toBe(ADMIN);

    /* UN-RETIRING IS THE SAME TRIPLE GOING BACK TO NULL. A one-way door would
       mean a ward withdrawn by mistake needs a migration to reopen. */
    await pg.admin.query(
      `update public.areas
          set retired_at = null, retired_reason = null, retired_by = null
        where key = 'bhaktapur-9'`,
    );
    const after = await pg.admin.query(
      "select retired_at from public.areas where key = 'bhaktapur-9'",
    );
    expect(after.rows[0].retired_at).toBeNull();
  });
});

describe("the key is the string everything else already holds", () => {
  it("refuses a key that is not city-slug and ward number", async () => {
    /*
     * NOT COSMETIC. This string is `addresses.area_key`,
     * `providers.service_areas` and the keys in `seed/area-centroids.json`,
     * with no foreign key anywhere — so an area keyed "Kathmandu 4" would look
     * right on the admin screen and match nothing: no centroid, no coverage
     * array, and `provider_serves` quietly finding nobody.
     */
    for (const key of ["Kathmandu 4", "ktm_4", "kathmandu", "kathmandu-", "KATHMANDU-4"]) {
      await expect(
        pg.admin.query(
          `insert into public.areas (key, city, city_ne, ward_number, name, name_ne)
           values ($1, 'Kathmandu', 'काठमाडौँ', 4, 'X', 'X')`,
          [key],
        ),
        key,
      ).rejects.toThrow(/areas_key_shape/);
    }
  });

  it("carries the same pattern the application refuses on", async () => {
    /*
     * ONE PATTERN WRITTEN TWICE, COMPARED RATHER THAN TRUSTED.
     * `AREA_KEY_SHAPE` turns a bad key into a sentence on the admin screen and
     * `areas_key_shape` is what makes it impossible; the cases above prove the
     * constraint bites, and nothing proved the two agree. They would drift
     * silently and fail on the first ward somebody opened with a key the screen
     * had accepted — losing the audit row in the same statement that writes it.
     *
     * Read out of `pg_constraint` rather than out of the migration file,
     * because this constraint is dropped and re-added by its own migration and
     * may be again.
     */
    const { rows } = await pg.admin.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'areas_key_shape'`,
    );
    expect(rows, "areas_key_shape is not on the table").toHaveLength(1);

    const quoted = /'((?:[^']|'')*)'/.exec(rows[0].def as string);
    expect(quoted, `no regex literal in ${rows[0].def}`).not.toBeNull();
    expect(quoted![1].replace(/''/g, "'")).toBe(AREA_KEY_SHAPE.source);
  });

  it("accepts a new ward in the shape the product already uses", async () => {
    await pg.admin.query(
      `insert into public.areas (key, city, city_ne, ward_number, name, name_ne, sort_order)
       values ('kirtipur-5', 'Kirtipur', 'कीर्तिपुर', 5, 'Naya Bazar', 'नयाँ बजार', 200)`,
    );
    const { rows } = await pg.admin.query(
      "select ward_number from public.areas where key = 'kirtipur-5'",
    );
    expect(rows[0].ward_number).toBe(5);
  });

  it("refuses a ward number of zero", async () => {
    await expect(
      pg.admin.query(
        `insert into public.areas (key, city, city_ne, ward_number, name, name_ne)
         values ('kirtipur-0', 'Kirtipur', 'कीर्तिपुर', 0, 'X', 'X')`,
      ),
    ).rejects.toThrow(/areas_ward_positive/);
  });
});

describe("who may read it and who may write it", () => {
  it("lets a signed-out visitor read every area, retired included", async () => {
    /*
     * PUBLIC ON PURPOSE, like `categories`: `/providers/join` lists the wards
     * before anybody has an account. Retired rows come back too — a public page
     * may have to name the ward an old booking was in, and hiding the row would
     * make that page unable to say where the job was.
     */
    await pg.admin.query(
      `update public.areas
          set retired_at = now(), retired_reason = 'testing the read'
        where key = 'bhaktapur-6'`,
    );

    const anon = await pg.asAnon();
    const { rows } = await anon.query(
      "select key, retired_at from public.areas where key in ('lalitpur-4','bhaktapur-6') order by key",
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === "bhaktapur-6")!.retired_at).not.toBeNull();

    await pg.admin.query(
      `update public.areas set retired_at = null, retired_reason = null
        where key = 'bhaktapur-6'`,
    );
  });

  it("lets no browser write one", async () => {
    /* Every write is the service role through `lib/data/areas-admin.ts`,
       behind a fresh second factor — retiring a ward stops new work for every
       professional in it. */
    const anon = await pg.asAnon();
    await expect(
      anon.query(
        `insert into public.areas (key, city, city_ne, ward_number, name, name_ne)
         values ('anon-1', 'X', 'X', 1, 'X', 'X')`,
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);

    const signedIn = await pg.asUser(ADMIN);
    await expect(
      signedIn.query(
        `update public.areas set retired_at = now(), retired_reason = 'from a browser'
          where key = 'lalitpur-4'`,
      ),
    ).rejects.toThrow(BROWSER_WRITE_REFUSED);
  });
});
