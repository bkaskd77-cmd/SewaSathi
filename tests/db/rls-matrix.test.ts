import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * Every table, every role, every verb — asserted, and written down.
 *
 * WHAT THIS ADDS TO THE SWEEP IN `booking-rls.test.ts`. That one reads the
 * catalog, which is the right instinct, but it only ever asks SELECT and only
 * ever as three of the six roles: a stranger and two customers. So a table
 * added tomorrow gets no assertion at all about what a PROFESSIONAL, another
 * professional, or an ADMIN can see — and nothing anywhere asserts what any
 * signed-in role may WRITE. Two facts that are true today were true by
 * accident rather than by test: only six tables grant a browser any write, and
 * no table in the product has a DELETE policy.
 *
 * TWO HALVES, BECAUSE THEY PROVE DIFFERENT THINGS AND SAYING SO MATTERS.
 *
 *   READS ARE EXECUTED. Each role runs `select count(*)` against each table
 *   and the result is compared with what the owner sees. This is the half that
 *   catches a policy that exists and is wrong — the `using (true)` that reads
 *   as coverage and restricts nothing.
 *
 *   WRITES ARE READ FROM `pg_policy`. Executing an INSERT against 36 tables
 *   would mean inventing valid rows for all of them, and a test that spends
 *   nine tenths of its length building fixtures stops being read. The policy
 *   catalog answers the question completely: a table with no INSERT policy for
 *   `authenticated` cannot be inserted into from any browser, by anybody, ever.
 *   Where a write policy DOES exist the interesting question is which rows, and
 *   those cases are executed — inside a savepoint that is rolled back, so the
 *   fixtures the read half depends on are not disturbed.
 *
 * "NO DATA" IS A THIRD ANSWER AND IT IS PRINTED. A table with no rows, or with
 * rows belonging to only one party, cannot demonstrate isolation — and a green
 * tick there would be the same lie as a default presented as a measurement.
 * The matrix says `no data` in those cells rather than implying a result
 * nobody obtained.
 *
 * TO PROVE THIS BITES, EDIT A POLICY'S *LAST* DEFINITION. Several are created
 * once and created again later — "Customers read their own bookings" gains its
 * verified-session clause in `20260911000001_unverified_session_guard.sql`.
 * Widening the copy in `20260901000001_bookings.sql` changes nothing, because
 * the later migration overwrites it before the suite runs, and the test then
 * passes for a reason that has nothing to do with the test. That cost an hour
 * and nearly got this file reported as blind.
 *
 * THE MATRIX IS A FILE SOMEBODY CAN READ. `npm run rls:matrix` regenerates
 * `docs/rls-matrix.md`; running the suite normally fails if the committed copy
 * has gone stale. Same shape as the function fingerprints: a document that
 * cannot rot, because it is derived rather than maintained.
 */

const ANITA = "11111111-a111-4111-8111-111111111111";
const BINA = "22222222-b222-4222-8222-222222222222";
const KRISHNA = "33333333-c333-4333-8333-333333333333";
const SITA = "44444444-d444-4444-8444-444444444444";
const ADMIN = "55555555-e555-4555-8555-555555555555";

/** The six roles, in the order the matrix prints them. */
const ROLES = [
  { key: "anon", label: "anon", id: null },
  { key: "customer", label: "customer (owner)", id: ANITA },
  { key: "otherCustomer", label: "other customer", id: BINA },
  { key: "provider", label: "professional (assigned)", id: KRISHNA },
  { key: "otherProvider", label: "other professional", id: SITA },
  { key: "admin", label: "admin", id: ADMIN },
] as const;

type RoleKey = (typeof ROLES)[number]["key"];

/** Readable by anybody on purpose: the catalogue and the public directory. */
const PUBLIC_TO_ANON = new Set([
  "categories",
  "category_price_bands",
  "providers",
  "provider_categories",
  "provider_reviews",
  "provider_stats",
]);

let pg: Harness;
const clients = new Map<RoleKey, import("pg").Client | null>();

type Cell = "all" | "some" | "none" | "no data";
type Row = { table: string; total: number; reads: Record<RoleKey, Cell> };

const rows: Row[] = [];
let writePolicies: Array<{
  table: string;
  cmd: string;
  name: string;
  roles: string;
}> = [];

beforeAll(async () => {
  pg = await startPostgres();

  for (const [id, name, role] of [
    [ANITA, "Anita Shrestha", "customer"],
    [BINA, "Bina Rai", "customer"],
    [KRISHNA, "Krishna Tamang", "provider"],
    [SITA, "Sita Gurung", "provider"],
    [ADMIN, "Support", "admin"],
  ] as const) {
    await pg.admin.query("insert into auth.users (id) values ($1)", [id]);
    await pg.admin.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role`,
      [id, name, `+9779813${id.slice(0, 6)}`, role],
    );
  }

  const provider = async (profile: string, name: string) => {
    const { rows: r } = await pg.admin.query(
      `insert into public.providers (profile_id, display_name, base_rate)
       values ($1, $2, 900) returning id`,
      [profile, name],
    );
    return r[0].id as string;
  };
  const krishna = await provider(KRISHNA, "Krishna Tamang");
  const sita = await provider(SITA, "Sita Gurung");

  const address = async (owner: string) => {
    const { rows: r } = await pg.admin.query(
      `insert into public.addresses
         (profile_id, label, area_key, city, ward_number, tole, landmark)
       values ($1, 'home', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Gate')
       returning id`,
      [owner],
    );
    return r[0].id as string;
  };

  /*
   * TWO OWNERS FOR EVERYTHING THAT CAN HAVE THEM. One customer's rows prove
   * nothing about isolation: the read sweep compares what each role sees
   * against the whole table, and with a single owner "sees everything" and
   * "sees their own" are the same number.
   */
  await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, provider_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, $3, 'plumbing', $4, 'Tap leaks', 900, 4500)`,
    ["SK-MTRX1", ANITA, krishna, await address(ANITA)],
  );
  await pg.admin.query(
    `insert into public.bookings
       (reference, customer_id, category_slug, address_id,
        description, quoted_min, quoted_max)
     values ($1, $2, 'electrical', $3, 'Socket dead', 900, 4500)`,
    ["SK-MTRX2", BINA, await address(BINA)],
  );

  await pg.admin.query(
    `insert into public.notifications (profile_id, kind, params)
     values ($1, 'booking.accepted', '{}'::jsonb), ($2, 'booking.accepted', '{}'::jsonb)`,
    [ANITA, BINA],
  );

  /*
   * THE SENSITIVE FIVE, SEEDED ON PURPOSE. Twenty-seven tables have no rows in
   * this fixture and honestly read `no data`; these five do not get to, because
   * they are the ones the security audit was actually about — a professional's
   * private number, money, what a customer typed into triage, the audit log
   * itself, and identity documents. A matrix that said `no data` against those
   * would be a matrix that skipped the question.
   */
  // Both, so `all` on this table means "every professional's number" and not
  // "the only row happens to be mine".
  await pg.admin.query(
    `insert into public.provider_contacts (provider_id, phone)
     values ($1, '+9779800000001'), ($2, '+9779800000002')`,
    [krishna, sita],
  );

  const { rows: bookingRows } = await pg.admin.query(
    `select id, reference from public.bookings
      where reference in ('SK-MTRX1', 'SK-MTRX2') order by reference`,
  );
  await pg.admin.query(
    `insert into public.payments (booking_id, method, amount, our_reference)
     values ($1, 'cash', 2000, 'SKP-MTRX1'), ($2, 'cash', 1500, 'SKP-MTRX2')`,
    [bookingRows[0].id, bookingRows[1].id],
  );

  await pg.admin.query(
    `insert into public.triage_logs
       (input_text, category, urgency, price_low, price_high, source)
     values ('tap leaking', 'plumbing', 'routine', 900, 4500, 'fallback'),
            ('socket dead', 'electrical', 'routine', 900, 4500, 'fallback')`,
  );

  await pg.admin.query(
    `insert into public.security_events (kind, actor_id, actor_role)
     values ('auth.signedIn', $1, 'customer'), ('auth.signedIn', $2, 'customer')`,
    [ANITA, BINA],
  );

  await pg.admin.query(
    `insert into public.provider_documents
       (profile_id, kind, storage_path, mime_type, byte_size)
     values ($1, 'citizenship', 'krishna/citizenship.jpg', 'image/jpeg', 90000),
            ($2, 'citizenship', 'sita/citizenship.jpg', 'image/jpeg', 90000)`,
    [KRISHNA, SITA],
  );

  for (const role of ROLES) {
    clients.set(role.key, role.id ? await pg.asUser(role.id) : await pg.asAnon());
  }

  // ---- the read half, executed -------------------------------------------
  const { rows: tables } = await pg.admin.query(`
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  `);

  for (const { relname } of tables as Array<{ relname: string }>) {
    const { rows: all } = await pg.admin.query(
      `select count(*)::int as n from public.${relname}`,
    );
    const total = (all[0] as { n: number }).n;

    const reads = {} as Record<RoleKey, Cell>;
    for (const role of ROLES) {
      const client = clients.get(role.key)!;
      let seen = 0;
      try {
        const { rows: r } = await client.query(
          `select count(*)::int as n from public.${relname}`,
        );
        seen = (r[0] as { n: number }).n;
      } catch {
        // A refused SELECT is `none`, not an error worth failing on: some
        // tables grant the role no privilege at all rather than an empty view.
        seen = 0;
      }
      reads[role.key] =
        total === 0 ? "no data" : seen === 0 ? "none" : seen === total ? "all" : "some";
    }
    rows.push({ table: relname, total, reads });
  }

  // ---- the write half, from the catalog -----------------------------------
  const { rows: policies } = await pg.admin.query(`
    select c.relname as table, p.polcmd::text as cmd, p.polname as name,
           coalesce(
             (select string_agg(r.rolname, ',' order by r.rolname)
                from pg_roles r where r.oid = any (p.polroles)),
             'public'
           ) as roles
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and p.polcmd <> 'r' and p.polpermissive
     order by 1, 2, p.polname
  `);
  writePolicies = policies as typeof writePolicies;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

describe("what each role can read", () => {
  it("shows a stranger nothing outside the catalogue", () => {
    const leaked = rows
      .filter((r) => !PUBLIC_TO_ANON.has(r.table) && r.reads.anon !== "none")
      .filter((r) => r.total > 0)
      .map((r) => r.table);
    expect(leaked).toEqual([]);
  });

  it("still shows a stranger the catalogue", () => {
    // The other half of the guarantee: a database that has locked the product
    // out of its own front page passes every hiding test ever written.
    const categories = rows.find((r) => r.table === "categories");
    expect(categories?.reads.anon).toBe("all");
  });

  it("never lets one customer see another's rows in full", () => {
    /*
     * `all` for BOTH customers on a table with more than one row means the
     * table is shared. One of them seeing `all` alone is ordinary — every row
     * may simply be theirs.
     */
    const shared = rows
      .filter((r) => r.total > 1 && !PUBLIC_TO_ANON.has(r.table))
      .filter((r) => r.reads.customer === "all" && r.reads.otherCustomer === "all")
      .map((r) => r.table);
    expect(shared).toEqual([]);
  });

  it("never lets one professional see another's rows in full", () => {
    const shared = rows
      .filter((r) => r.total > 1 && !PUBLIC_TO_ANON.has(r.table))
      .filter((r) => r.reads.provider === "all" && r.reads.otherProvider === "all")
      .map((r) => r.table);
    expect(shared).toEqual([]);
  });

  /*
   * ADMIN IS THE ROLE NOTHING PREVIOUSLY ASSERTED, and the audit that produced
   * this file found the consequence: `profiles` and `provider_contacts` are
   * readable in full by an admin, which is every customer's and every
   * professional's phone number. That is deliberate and it is why
   * `recordContactAccess` exists — but it was never written down anywhere a
   * person could check. Now it is, in the matrix, by name.
   */
  it("names every table an admin can read in full", () => {
    const wide = rows
      .filter((r) => r.total > 0 && r.reads.admin === "all")
      .filter((r) => !PUBLIC_TO_ANON.has(r.table))
      .map((r) => r.table)
      .sort();

    /*
     * A LITERAL LIST AND NOT A SNAPSHOT. A snapshot gets re-blessed the moment
     * it goes red — `guard-clauses.test.ts` makes that argument about function
     * bodies and it is truer here, because the thing being re-blessed would be
     * a widening of what an admin may read.
     *
     * `profiles` is the one that matters: it holds every customer's and every
     * professional's phone number, which is why `recordContactAccess` exists.
     * It was never written down anywhere a person could check until this file.
     *
     * NOT EXHAUSTIVE, AND THE MATRIX SAYS SO. `provider_contacts` also grants
     * an admin every row, but no fixture here creates one — so it reads as
     * `no data` rather than appearing in this list. That is the honest answer,
     * not a reason to trust the list as complete.
     */
    expect(wide).toEqual([
      // Every booking and its history: what support exists to look at.
      "booking_status_history",
      "bookings",
      // Money. Read-only — RLS grants nobody an insert or update on it.
      "payments",
      // Every customer's and every professional's phone number. The reason
      // `recordContactAccess` exists, and the reason narrowing this policy is
      // still an open question rather than a settled one.
      "profiles",
      // The professionals' private numbers — the table that exists precisely
      // so they are NOT on `providers`, which `anon` can read.
      "provider_contacts",
      // Citizenship certificates and photographs of people's faces. Logged on
      // every read by `recordDocumentAccess`, which is a separate function so
      // it cannot be skipped.
      "provider_documents",
      // The audit log itself. Admin-only and append-only: the trigger refuses
      // UPDATE and DELETE to every caller, service role included.
      "security_events",
      // What customers typed into the hero, including the panicked ones.
      "triage_logs",
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

describe("what each role can write", () => {
  it("has no DELETE policy on any table, for anybody", () => {
    /*
     * True today and asserted nowhere until now. Nothing in this product is
     * deleted from a browser — rows are cancelled, withdrawn, removed by a
     * stamp. A DELETE policy appearing is a change of posture and should have
     * to be argued for.
     */
    const deletes = writePolicies.filter((p) => p.cmd === "d" || p.cmd === "*");
    expect(deletes.map((p) => `${p.table}:${p.cmd}`)).toEqual([]);
  });

  it("grants a browser a write on only the tables that need one", () => {
    // `Array.from`, not a spread: this repo's tsconfig target predates
    // downlevel iteration, and a spread over a Set fails the typecheck.
    const writable = Array.from(
      new Set(writePolicies.map((p) => p.table)),
    ).sort();

    /*
     * Six of thirty-six. Everything else is written by the service role in
     * `lib/data/`, which re-reads the subject rather than believing what it
     * was handed — payments, refunds, the ledger, the audit log, every signal
     * table. A seventh name appearing here is a new way into the database from
     * a browser, and it should be argued for in the commit that adds it.
     */
    expect(writable).toEqual([
      "addresses",
      "bookings",
      "notifications",
      "profiles",
      "provider_applications",
      "provider_leads",
    ]);
  });

  it("lets a stranger write to nothing but the join form", () => {
    const anonWritable = writePolicies
      .filter((p) => p.roles.split(",").includes("anon"))
      .map((p) => p.table);
    expect(Array.from(new Set(anonWritable))).toEqual(["provider_leads"]);
  });

  /*
   * EXECUTED, because on a table that DOES grant a write the question is which
   * rows — and that is exactly what a catalog read cannot answer. Each probe
   * runs in its own transaction and is rolled back, so the read half above
   * still has its fixtures. (`savepoint` needs an open transaction block and
   * these clients autocommit, so it is `begin`/`rollback` rather than a
   * nested savepoint.)
   */
  it("refuses a booking at somebody else's address", async () => {
    const bina = clients.get("otherCustomer")!;
    const { rows: mine } = await pg.admin.query(
      "select id from public.addresses where profile_id = $1 limit 1",
      [ANITA],
    );

    await bina.query("begin");
    await expect(
      bina.query(
        `insert into public.bookings
           (reference, customer_id, category_slug, address_id, description,
            quoted_min, quoted_max)
         values ('SK-PROBE1', $1, 'plumbing', $2, 'Not my house', 900, 4500)`,
        [BINA, mine[0].id],
      ),
    ).rejects.toThrow();
    await bina.query("rollback");
  });

  it("refuses an address saved against another person's profile", async () => {
    const bina = clients.get("otherCustomer")!;
    await bina.query("begin");
    await expect(
      bina.query(
        `insert into public.addresses
           (profile_id, label, area_key, city, ward_number, tole, landmark)
         values ($1, 'theirs', 'lalitpur-4', 'Lalitpur', 4, 'Jhamsikhel', 'Gate')`,
        [ANITA],
      ),
    ).rejects.toThrow(/row-level security/i);
    await bina.query("rollback");
  });
});

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

function renderMatrix(): string {
  const head = `| table | rows | ${ROLES.map((r) => r.label).join(" | ")} |`;
  const rule = `| --- | --- | ${ROLES.map(() => "---").join(" | ")} |`;

  const body = rows
    .map(
      (r) =>
        `| \`${r.table}\` | ${r.total} | ` +
        ROLES.map((role) => r.reads[role.key]).join(" | ") +
        " |",
    )
    .join("\n");

  const writes = writePolicies
    .map(
      (p) =>
        `| \`${p.table}\` | ${
          { a: "INSERT", w: "UPDATE", d: "DELETE", "*": "ALL" }[p.cmd] ?? p.cmd
        } | \`${p.name}\` | ${p.roles} |`,
    )
    .join("\n");

  return `# RLS matrix

**Generated by \`npm run rls:matrix\`. Do not edit — \`tests/db/rls-matrix.test.ts\`
fails when this file and the policies disagree.**

Every table in \`public\`, against the six roles, on a database running the real
migrations.

## Reads

\`all\` — the role sees every row in the table. \`some\` — it sees a subset,
which is what isolation looks like. \`none\` — it sees nothing.

**\`no data\` means the table was empty, so nothing was demonstrated.** It is
not a pass. A green tick there would be the same mistake as printing a column
default as a measurement.

${head}
${rule}
${body}

## Writes

Read from \`pg_policy\`: a table absent from this list grants no browser role
any INSERT, UPDATE or DELETE at all, so every write to it goes through the
service role in \`lib/data/\`.

| table | command | policy | roles |
| --- | --- | --- | --- |
${writes}
`;
}

describe("the matrix is written down", () => {
  const file = path.join(process.cwd(), "docs", "rls-matrix.md");

  it("matches the committed copy", () => {
    const current = renderMatrix();

    if (process.env.RLS_MATRIX_WRITE) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, current);
      return;
    }

    let committed: string;
    try {
      committed = readFileSync(file, "utf8");
    } catch {
      throw new Error(
        `docs/rls-matrix.md does not exist. Run \`npm run rls:matrix\` to write it.`,
      );
    }

    expect(
      current,
      "The policies and docs/rls-matrix.md disagree. If the change was " +
        "deliberate, run `npm run rls:matrix` and commit the result — the diff " +
        "is the description of what you changed about who can read what.",
    ).toBe(committed);
  });
});
