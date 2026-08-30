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
 * The storage migration is skipped — it needs Supabase's `storage` schema,
 * which is not part of Postgres. Its policies are noted as untested in
 * ARCHITECTURE.md rather than pretended over.
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
  phone text
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
`;

/** Migrations that need Supabase-only schemas we cannot stand up here. */
const SKIP = new Set(["20260901000002_booking_photos.sql"]);

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

  // RLS is bypassed for table owners, so the tests connect as this role.
  await admin.query(`
    grant usage on schema public to authenticated, anon;
    grant select, insert, update on all tables in schema public
      to authenticated, anon;
    grant usage on schema auth to authenticated, anon;
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
    async stop() {
      for (const client of open) await client.end().catch(() => {});
      await admin!.end().catch(() => {});
      server.kill("SIGQUIT");
      await new Promise((resolve) => setTimeout(resolve, 300));
      rmSync(root, { recursive: true, force: true });
    },
  };
}
