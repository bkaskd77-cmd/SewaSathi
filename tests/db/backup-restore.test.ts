import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgres, type Harness } from "../support/postgres";

/**
 * The backup is restorable, proven by restoring it.
 *
 * WHY THIS IS A TEST AND NOT A RUNBOOK. A backup nobody has restored is a
 * belief, not a backup, and the failure is perfectly silent until the day it
 * matters: the nightly job goes green for months, the artifacts accumulate, and
 * the first attempt to read one back is made by somebody who has just lost the
 * database. Every failure mode here — a version mismatch, a truncated upload, a
 * wrong key, a dump that silently excluded the schema — produces a file of
 * plausible size that only fails when opened.
 *
 * IT RUNS THE SAME COMMANDS THE WORKFLOW RUNS. `.github/workflows/backup.yml`
 * and this file are one procedure written twice, which is the sin this
 * repository keeps recording — so the shape is pinned at the bottom by reading
 * the workflow and asserting the flags that decide whether a dump is
 * restorable at all appear in both.
 *
 * WHAT IT DOES NOT PROVE, SAID HERE RATHER THAN DISCOVERED LATER: this cluster
 * is PostgreSQL 16 and Supabase runs 17, so the drill cannot establish that the
 * runner's `pg_dump` will accept the production server. `pg_dump` REFUSES a
 * server newer than itself, which is why the workflow installs
 * `postgresql-client-17` from PGDG rather than using the runner's default 16 —
 * and that half is proven only by the job running green against production.
 */

let pg: Harness;
let work: string;
/** Every category slug and name, as the source database holds them. */
let catalogue: string;

/** The passphrase the drill encrypts with. Not a secret — it never leaves here. */
const KEY = "drill-passphrase-not-a-real-secret-0123456789";
const WRONG_KEY = "drill-passphrase-but-the-wrong-one-9876543210";

function pgBin(name: string): string {
  return path.join("/usr/lib/postgresql/16/bin", name);
}

/**
 * Run a command and return everything it said, whatever it exited with.
 *
 * `gpg --list-packets` ON A SYMMETRIC FILE EXITS NON-ZERO. It prints the
 * header it was asked for — the cipher and "encrypted with 1 passphrase" — and
 * then tries to decrypt, fails for want of a passphrase, and returns 1. That
 * is the right behaviour and it is a trap for any caller that reads an exit
 * code: the first version of the workflow piped it under `set -euo pipefail`
 * and would have failed every night AFTER writing a perfectly good backup.
 * Found here rather than in production, which is the only reason this drill is
 * a test and not a runbook.
 */
function say(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

function run(file: string, args: string[]): string {
  return execFileSync(file, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

beforeAll(async () => {
  pg = await startPostgres();
  work = mkdtempSync(path.join(tmpdir(), "sk-backup-"));

  /*
   * THE CANARY IS THE SEEDED CATALOGUE RATHER THAN A ROW THIS TEST INSERTS.
   *
   * A hand-written fixture was the first version and it broke twice inside a
   * minute: `categories` has gained NOT NULL columns across several
   * migrations, so the insert had to be rewritten each time the schema grew —
   * maintenance on a test whose subject is not the schema at all. Reading what
   * the migrations already put there proves the same thing (text survived the
   * round trip) and cannot go stale.
   */
  const { rows } = await pg.admin.query(
    "select slug, name_en from public.categories order by slug",
  );
  expect(rows.length).toBeGreaterThan(0);
  catalogue = rows.map((row) => `${row.slug}=${row.name_en}`).join("|");
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe("a dump can be taken, sealed, opened and restored", () => {
  const dump = () => path.join(work, "backup.dump");
  const sealed = () => path.join(work, "backup.dump.gpg");
  const opened = () => path.join(work, "opened.dump");

  it("takes a custom-format dump of the whole database", () => {
    /*
     * `-Fc` RATHER THAN PLAIN SQL, and it is the flag that decides whether a
     * restore is usable. A custom-format archive can be restored selectively,
     * reordered to satisfy dependencies, and parallelised; a plain `.sql` file
     * is one long transaction that stops at the first error and leaves a
     * half-built database with no way to resume.
     */
    run(pgBin("pg_dump"), [
      "-h", pg.socketDir,
      "-U", "postgres",
      "-d", "postgres",
      "-Fc",
      "-f", dump(),
    ]);

    // A dump of a schema this size is never a handful of bytes. A zero-length
    // or near-empty file is the failure that uploads happily.
    expect(statSync(dump()).size).toBeGreaterThan(20_000);
  });

  it("seals it, and the file really is an encrypted one", () => {
    /*
     * "WE RAN GPG" AND "THE BYTES ARE ENCRYPTED" ARE DIFFERENT CLAIMS, and a
     * pipeline that wrote the plaintext through — a missing flag, a redirect to
     * the wrong name — produces an artifact of the right name and roughly the
     * right size.
     *
     * SEARCHING THE CIPHERTEXT FOR A KNOWN STRING WAS THE FIRST VERSION AND IT
     * PROVED NOTHING. A `-Fc` archive is zlib-compressed, so the slug is not
     * literal in the PLAINTEXT either: the "it is absent from the ciphertext"
     * half passed for the wrong reason, and the half that was supposed to make
     * it mean something failed. Found by running it rather than by reading it.
     *
     * So the check is the structural one, and it is the same one the workflow
     * runs on the real artifact before uploading: gpg reads the packet header
     * without the key. The second assertion is what makes the first meaningful
     * — a plaintext file must NOT satisfy it.
     */
    writeFileSync(path.join(work, "key"), KEY);
    run("gpg", [
      "--batch", "--yes", "--quiet",
      "--symmetric", "--cipher-algo", "AES256",
      "--passphrase-file", path.join(work, "key"),
      "-o", sealed(),
      dump(),
    ]);

    const packets = say("gpg", ["--batch", "--list-packets", sealed()]);
    expect(packets).toMatch(/encrypted data/i);
    expect(packets).toMatch(/passphrase/i);

    // The discriminator self-tests: the unsealed dump is not mistaken for one,
    // so the assertion above is doing work rather than matching anything.
    const plain = say("gpg", ["--batch", "--list-packets", dump()]);
    expect(plain).not.toMatch(/encrypted data/i);

    // And the bytes are not simply the dump under a new name.
    expect(readFileSync(sealed()).equals(readFileSync(dump()))).toBe(false);
  });

  it("refuses to open with the wrong key", () => {
    // A wrong key must be loud. Silent partial output here would mean restoring
    // garbage over a live database on the worst day of the year.
    writeFileSync(path.join(work, "wrong"), WRONG_KEY);
    expect(() =>
      run("gpg", [
        "--batch", "--yes", "--quiet",
        "--passphrase-file", path.join(work, "wrong"),
        "-o", path.join(work, "never.dump"),
        "--decrypt", sealed(),
      ]),
    ).toThrow();
  });

  it("opens byte-for-byte with the right key", () => {
    run("gpg", [
      "--batch", "--yes", "--quiet",
      "--passphrase-file", path.join(work, "key"),
      "-o", opened(),
      "--decrypt", sealed(),
    ]);
    expect(readFileSync(opened()).equals(readFileSync(dump()))).toBe(true);
  });

  it("restores into a scratch database with the schema and the row intact", () => {
    run(pgBin("createdb"), ["-h", pg.socketDir, "-U", "postgres", "restore_drill"]);
    run(pgBin("pg_restore"), [
      "-h", pg.socketDir,
      "-U", "postgres",
      "-d", "restore_drill",
      opened(),
    ]);

    const tables = run(pgBin("psql"), [
      "-h", pg.socketDir, "-U", "postgres", "-d", "restore_drill",
      "-tAc",
      "select count(*) from information_schema.tables where table_schema = 'public'",
    ]).trim();
    expect(Number(tables)).toBeGreaterThan(30);

    /*
     * THE WHOLE CATALOGUE, COMPARED AGAINST WHAT THE SOURCE HELD. A single row
     * would pass on a restore that brought back one table; this fails unless
     * every slug and every name came through with its text intact — including
     * the Devanagari, which is where an encoding mistake in a dump pipeline
     * actually shows up.
     */
    const restored = run(pgBin("psql"), [
      "-h", pg.socketDir, "-U", "postgres", "-d", "restore_drill",
      "-tAc",
      "select string_agg(slug || '=' || name_en, '|' order by slug) from public.categories",
    ]).trim();
    expect(restored).toBe(catalogue);
  });

  it("restores the guards, not just the rows", () => {
    /*
     * A RESTORE THAT BROUGHT BACK THE DATA AND NOT THE RULES is the quietest
     * possible disaster: the product runs, every page renders, and
     * `enforce_booking_immutability`, the RLS policies and the append-only
     * triggers are simply gone. That is the live drift this repository already
     * found once, arrived at through the back door.
     */
    const counts = run(pgBin("psql"), [
      "-h", pg.socketDir, "-U", "postgres", "-d", "restore_drill",
      "-tAc",
      `select
         (select count(*) from pg_policies where schemaname = 'public') || ',' ||
         (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not t.tgisinternal) || ',' ||
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public')`,
    ]).trim();

    const [policies, triggers, functions] = counts.split(",").map(Number);
    expect(policies).toBeGreaterThan(20);
    expect(triggers).toBeGreaterThan(5);
    expect(functions).toBeGreaterThan(5);
  });
});

describe("the workflow runs these same commands", () => {
  /*
   * ONE PROCEDURE WRITTEN TWICE — this drill and the nightly job — which is the
   * shape that drifts. There is no import that makes them one: the workflow is
   * YAML executed by a runner. So the flags that decide whether a dump is
   * restorable at all are asserted to appear in both, the way the deploy check
   * reads the middleware rather than trusting it.
   */
  const workflow = readFileSync(".github/workflows/backup.yml", "utf8");

  /*
   * COMMENTS STRIPPED, BECAUSE NAMING A FLAG IN ORDER TO WARN ABOUT IT IS NOT USING
   * IT. The first version of the `--no-privileges` case below went red against a
   * correct workflow: the paragraph explaining why that flag is gone contains the
   * flag. `check:secrets` draws the same line in its source pass — a mention is
   * documentation, a read is a read — and `provider-money-one-source.test.ts` has
   * exactly this arrangement for exactly this reason.
   *
   * Only whole comment lines go: YAML `#` and the shell `#` inside `run: |` blocks
   * are both line comments, and no flag in this file is written after live code on
   * the same line.
   */
  const command = workflow
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  it("takes a custom-format dump", () => {
    expect(workflow).toContain("-Fc");
  });

  it("encrypts with the same cipher before anything is uploaded", () => {
    expect(workflow).toContain("--symmetric");
    expect(workflow).toContain("AES256");
  });

  it("never writes the key to a path the repository could keep", () => {
    // The passphrase arrives as a secret and is written to a runner temp file,
    // never into the workspace — a file in the checkout is one `git add -A`
    // away from being committed by a later step.
    expect(workflow).toContain("RUNNER_TEMP");
    expect(workflow).not.toMatch(/passphrase[ =]["']?\$\{\{/);
  });

  it("installs a client new enough for the server", () => {
    /*
     * `pg_dump` REFUSES a server newer than itself. The runner ships 16 and
     * Supabase runs 17, so without this the job fails every night with
     * "server version mismatch" — or worse, somebody pins an older client and
     * gets a dump that silently omits newer object types.
     */
    expect(workflow).toContain("postgresql-client-17");
  });

  it("uploads one named file rather than a glob", () => {
    /*
     * An artifact step with a loose glob is how a plaintext dump ends up in
     * storage beside the encrypted one. The path is a single variable the seal
     * step set to the `.gpg` it just wrote — and the plaintext is shredded in
     * that same step, before any upload step exists to catch it.
     */
    expect(workflow).toContain("path: ${{ env.artifact }}");
    expect(workflow).not.toMatch(/path:\s*\*/);
    expect(workflow).toContain('echo "artifact=$out.gpg"');
    expect(workflow).toMatch(/shred -u "\$out"/);
  });

  it("fails the job when there is no file, rather than going green", () => {
    // The default for a missing artifact is a warning and a green tick, which
    // is a nightly success for a backup that does not exist.
    expect(workflow).toContain("if-no-files-found: error");
  });

  /*
   * THE FLAGS THAT DIVERGED, AND THE REASON THIS GROUP EXISTED WITHOUT CATCHING IT.
   * This drill dumps with no flags, so its archive carries the ACL and the restore
   * above proves the grants come back. The nightly job dumped `--no-privileges`
   * until 2026-10-17, so the artifact a real recovery would use carried none of
   * them — and every case in this group passed throughout, because they compared
   * `-Fc`, the cipher, the client version and the artifact path, which are the
   * parts somebody thought of.
   *
   * A DUMP WITHOUT ITS ACL IS BROKEN BOTH WAYS. Into a bare cluster the product is
   * dead: no GRANT means `42501` on every read through PostgREST. Into a real
   * Supabase project it is worse, because that project's default ACL hands `anon`
   * and `authenticated` everything on each table as the restore creates it, with
   * nothing in the dump to revoke it — 20261011000004 and 20260927000005 undone by
   * a recovery, silently.
   */
  it("dumps the grants, because nothing else re-establishes them", () => {
    expect(command).not.toContain("--no-privileges");
    expect(command).not.toContain("-x ");
  });

  /*
   * OWNERSHIP IS THE ONE THAT STAYS OFF. It is per-project, a restore target's
   * roles are not these ones, and nothing in this product depends on it — so the
   * assertion is that the two flags are judged separately rather than as a pair,
   * which is how they came to be written as a pair in the first place.
   */
  it("still drops ownership, which is per-project", () => {
    expect(command).toContain("--no-owner");
  });

  /*
   * AND THE JOB RESTORES WHAT IT UPLOADED. A backup nobody has restored is a file.
   * The order is asserted too: a drill that fails must not cost us the artifact it
   * was drilling, so the upload comes first and a red job then means "the backup
   * exists and could not be restored".
   */
  it("restores the artifact it just produced, after uploading it", () => {
    const upload = workflow.indexOf("upload-artifact");
    const restore = workflow.indexOf("Restore it into a scratch database");
    expect(restore).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(upload);
    // Against the sealed file, not a plaintext that no longer exists.
    expect(workflow).toContain("${{ env.artifact }}");
    expect(workflow).toContain("pg_restore");
  });

  /*
   * THE TWO ASSERTIONS THAT MAKE THE DRILL ABOUT ACCESS CONTROL rather than about
   * row counts. `full_name` proves the grants restored at all; `role` proves they
   * restored narrowly — it is the column that, one PATCH away, made any signed-in
   * customer an admin.
   */
  it("checks a restored grant in both directions", () => {
    expect(workflow).toContain("'public.profiles','full_name','UPDATE'");
    expect(workflow).toContain("'public.profiles','role','UPDATE'");
  });

  /*
   * AN OPAQUE FAILURE IS A FAILURE NOBODY CAN ACT ON. The drill's first real run
   * exited 127 — "command not found" — and GitHub reported exactly that, with the
   * log on a host this sandbox cannot read. A missing binary, an unreachable
   * service and a genuinely broken restore were indistinguishable, and the only
   * way to tell was another run.
   *
   * Same lesson as `?debug=auth` and `?debug=triage`: when the only channel is a
   * log somebody else holds, the step has to say the thing itself.
   */
  /*
   * THE GENERAL VERSION, AND IT TOOK TWO RUNS TO REACH. The preflight below
   * names a missing binary; the drill then failed 127 with every binary present,
   * so it reported nothing and the next fact still cost a whole run. An `::error::`
   * line becomes a GitHub annotation, which the API serves — the job log does not,
   * it sits on a storage host this sandbox cannot reach. So a failure that writes
   * only to the log has, from here, said nothing at all.
   */
  it("turns any failing command into a readable annotation", () => {
    expect(command).toContain("trap ");
    expect(command).toContain("$BASH_COMMAND");
    expect(command).toMatch(/::error::restore drill failed at line/);
  });

  it("names the binary it is missing instead of exiting 127", () => {
    expect(command).toContain("command -v");
    expect(command).toMatch(/::error::the restore drill needs these/);
    // And it lists what IS installed, because the absence alone does not say why.
    expect(command).toContain("ls -1 /usr/lib/postgresql/17/bin");
  });

  it("refuses to start without a key, before anything is dumped", () => {
    /*
     * ORDER IS THE POINT. With no key the sealing step fails having ALREADY
     * written a plaintext dump to the runner's disk. The job that cannot
     * encrypt must not produce anything to encrypt.
     */
    const check = workflow.indexOf("Refuse to run with no key");
    const dumpStep = workflow.indexOf("Dump and seal");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(dumpStep);
  });
});
