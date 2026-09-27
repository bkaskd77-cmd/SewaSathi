import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";

/**
 * A throwaway Postgres, running the project's real migrations.
 *
 * RLS is the one thing in this product that cannot be tested by reading the
 * code: a policy either lets the wrong person read a row or it does not, and
 * the only way to know is to ask a database. Mocking Supabase would test the
 * mock.
 *
 * WHAT IS REAL HERE: the migration files, verbatim — every table, constraint,
 * trigger and policy under test is the one that ships.
 *
 * WHAT IS STUBBED: the identity source. Supabase provides `auth.uid()` backed
 * by a JWT; here it reads a session setting (`request.jwt.claim.sub`) that the
 * test sets, which is the same shape Supabase's own local tooling uses. The
 * policies are real; only who-is-asking is injected. That distinction matters
 * when reading a green result: this proves the policies are right, not that
 * Supabase's auth is.
 *
 * Supabase's `storage` schema is modelled rather than skipped — two tables and
 * `storage.foldername`, which is what every object policy uses to scope a file
 * to its owner. It used to be skipped, which meant the one bucket holding
 * photographs of the inside of people's homes was the one migration with no
 * test at all.
 */

const PG_BIN = "/usr/lib/postgresql/16/bin";

/**
 * Postgres refuses to run as root, and CI containers usually are.
 *
 * When we are root, the cluster is created and run as the unprivileged
 * `postgres` account instead. When we are not, nothing is wrapped. Either way
 * the connecting client is this process, over a unix socket in a temp dir.
 */
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const DROP_TO = "postgres";

function run(command: string, args: string[]): void {
  if (AS_ROOT) {
    execFileSync("su", [
      "-s",
      "/bin/sh",
      DROP_TO,
      "-c",
      [command, ...args].map((a) => `'${a}'`).join(" "),
    ], { stdio: "ignore" });
    return;
  }
  execFileSync(command, args, { stdio: "ignore" });
}

function spawnServer(args: string[]): ChildProcess {
  if (AS_ROOT) {
    return spawn(
      "su",
      [
        "-s",
        "/bin/sh",
        DROP_TO,
        "-c",
        [bin("postgres"), ...args].map((a) => `'${a}'`).join(" "),
      ],
      { stdio: "ignore" },
    );
  }
  return spawn(bin("postgres"), args, { stdio: "ignore" });
}

export type Harness = {
  /** A connection as the table owner, bypassing RLS. Sets up fixtures. */
  admin: Client;
  /** Open a connection that RLS applies to, acting as a given profile id. */
  asUser: (userId: string) => Promise<Client>;
  /** A logged-out connection — the join form's caller. */
  asAnon: () => Promise<Client>;
  stop: () => Promise<void>;
};

function bin(name: string): string {
  return path.join(PG_BIN, name);
}

/** Everything Supabase gives us that plain Postgres does not. */
const SUPABASE_SHIM = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  phone text,
  -- Set by Supabase when an OTP is verified, which is the only thing that
  -- distinguishes an account somebody proved they own from one that merely
  -- names their number. Modelled rather than skipped because
  -- \`session_is_verified()\` reads them, and a guard on every customer read is
  -- not something to test against an approximation.
  --
  -- DEFAULTED, because in this product an account cannot come into existence
  -- any other way: OTP is the only path in and verifying the code is what
  -- confirms the phone. So a fixture that says nothing about confirmation is
  -- describing a real account, and every existing test keeps meaning what it
  -- meant. A test that wants the unverified case passes null explicitly, which
  -- is also the honest signal that it is constructing something the product
  -- cannot yet produce.
  phone_confirmed_at timestamptz default now(),
  email_confirmed_at timestamptz
);

-- Supabase reads the caller from the JWT. Here the test sets it directly, so
-- the policies under test are exercised with a real, switchable identity.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- The app role RLS actually applies to. The owner bypasses it, so every
-- assertion below runs as this.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;

-- Supabase Storage, modelled far enough to run its policies.
--
-- Two tables and one function. storage.foldername is the one that matters:
-- every policy in this product scopes an object to its owner by comparing the
-- first path segment to auth.uid(), so a shim that got it wrong would make
-- those policies pass here and fail in production. It returns the directory
-- segments — everything except the filename — exactly as Supabase's does.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id) on delete cascade,
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  metadata jsonb
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[
    1 : greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)
  ];
$$;

-- Supabase hands anon and authenticated EXECUTE on every function created in
-- the public schema, as a default privilege — a *direct* grant, not one inherited from
-- PUBLIC. Without this line the harness was more locked-down than the real
-- database, and a migration that revoked only from PUBLIC passed here while
-- changing nothing in production. It did: the Security Advisor still showed
-- nine of the warnings 20260903000001 was supposed to clear.
alter default privileges in schema public
  grant execute on functions to anon, authenticated;

-- And the same thing for TABLES, for the same reason one level along.
--
-- This used to be a loop AFTER the migrations had applied, walking every table
-- in \`public\` and granting select, insert and update to anon and authenticated.
-- It modelled the right fact the wrong way round: Supabase grants those through
-- a default privilege, at CREATION, so a migration that narrows them afterwards
-- narrows them for real — whereas a loop running last puts them all back.
--
-- NOTHING WAS ACTUALLY BEING ERASED, and that is worth writing down rather than
-- claiming otherwise. The five \`revoke all\` statements in this repository
-- (category_pricing_signals, payment_mix_signals, category_rate_signals,
-- survey_decline_signals, band_ask_signals) are all on VIEWS, and the loop
-- excluded views on purpose — its comment said so and it was right. The first
-- thing it WOULD have erased is \`20260927000005\`, which revokes UPDATE on
-- \`public.profiles\` and grants it back on three columns; under the loop that
-- migration was silently undone before any test looked, and the escalation it
-- closes would have read as still open with no way to tell the two apart.
--
-- So this is the ordering fixed before it costs anything, not a leak repaired.
-- No test relies on a grant this does not make: a default privilege set before
-- the migrations is exactly what production has.
alter default privileges in schema public
  grant select, insert, update on tables to anon, authenticated;
`;

/** Migrations that need Supabase-only schemas we cannot stand up here. */
/*
 * Nothing is skipped any more, and what used to be skipped is the point.
 *
 * `20260901000002_booking_photos.sql` was excluded because it touches
 * `storage.*`, which plain Postgres does not have — so the one bucket holding
 * photographs of the inside of people's homes was the one migration with no
 * test at all. The shim below models enough of Supabase Storage to run those
 * policies for real, which is how they get proved rather than assumed.
 */
const SKIP = new Set<string>();

export async function startPostgres(): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), "sk-pg-"));
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "sock");

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(socketDir, { recursive: true });
  if (AS_ROOT) {
    // The server writes to both; this process only reads the socket.
    execFileSync("chown", ["-R", `${DROP_TO}:${DROP_TO}`, root]);
    execFileSync("chmod", ["-R", "0777", socketDir]);
  }

  run(bin("initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"]);

  const server = spawnServer([
    "-D",
    dataDir,
    "-k",
    socketDir,
    "-h",
    "",
    "-c",
    "fsync=off",
  ]);

  const connect = async (user = "postgres") => {
    const client = new Client({
      host: socketDir,
      user,
      database: "postgres",
    });
    await client.connect();
    return client;
  };

  // initdb is done but the server takes a moment to accept connections.
  let admin: Client | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      admin = await connect();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!admin) throw new Error("Postgres did not start");

  await admin.query(SUPABASE_SHIM);

  const dir = path.join(process.cwd(), "supabase/migrations");
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql") || SKIP.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    try {
      await admin.query(sql);
    } catch (error) {
      throw new Error(`${file} failed to apply: ${(error as Error).message}`);
    }
  }

  /*
   * RLS is bypassed for table owners, so the tests connect as these roles.
   *
   * THE TABLE GRANTS ARE NOT HERE ANY MORE. They were a loop over `pg_class`
   * run at this point — after every migration — which is why a revoke in a
   * migration could not survive: the loop put the privilege straight back and
   * the harness ended up more permissive than production. The default privilege
   * in the shim above is what Supabase actually does, and it happens before the
   * tables exist, so a later `revoke` or `grant (columns)` means what it says.
   *
   * The schema and storage grants stay explicit: `storage` is our own shim, so
   * there is no Supabase default privilege to imitate, and usage on a schema is
   * not granted by one either.
   */
  await admin.query(`
    grant usage on schema public to authenticated, anon;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema storage to authenticated, anon;
    grant select, insert, update on storage.objects to authenticated, anon;
    grant select on storage.buckets to authenticated, anon;
  `);

  const open: Client[] = [];

  return {
    admin,
    async asUser(userId: string) {
      const client = await connect();
      await client.query("set role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, false)", [
        userId,
      ]);
      open.push(client);
      return client;
    },
    async asAnon() {
      const client = await connect();
      await client.query("set role anon");
      open.push(client);
      return client;
    },
    async stop() {
      for (const client of open) await client.end().catch(() => {});
      await admin!.end().catch(() => {});
      server.kill("SIGQUIT");
      await new Promise((resolve) => setTimeout(resolve, 300));
      rmSync(root, { recursive: true, force: true });
    },
  };
}
