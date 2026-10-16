# Backups, and how to restore one

A nightly `pg_dump`, encrypted before it leaves the runner, kept as a GitHub
artifact. `.github/workflows/backup.yml` is the job;
`tests/db/backup-restore.test.ts` is the proof that what it produces can be read
back, and it runs on every `npm run verify`.

## What this is, and what it is not

**It is the second copy.** Supabase's own backups are the primary one and this
does not replace them. What it adds is independence: it lives in a different
provider's storage, under a key that provider does not hold, so it survives the
scenarios that take the primary with them — a billing lapse, a deleted project,
a compromised dashboard login, a `drop schema public cascade` run by somebody
with the service-role key.

**It is not an archive.** GitHub deletes artifacts after their retention window
(90 days is the maximum and what this uses) and deletes all of them with the
repository. Anything that has to outlive that must be downloaded and kept
somewhere a person chooses. There is no monthly or yearly copy and this file
will not pretend otherwise.

**It is not point-in-time recovery.** The dump is taken once a night, so the
worst case is losing a day. Supabase's PITR is the answer to that and it is a
paid plan; until then, a day is the exposure and it is written down rather than
assumed away.

**Nothing has restored it in production.** The drill restores a dump of the real
schema into a scratch database on every CI run, which proves the commands, the
encryption, the key handling and the archive format. It does **not** prove that
the runner's `pg_dump` accepts the live server, because the sandbox cannot reach
the database and the drill's cluster is PostgreSQL 16 against Supabase's 17.
That half is proven the first time the job runs green with the secrets set.

## Setting it up

Two repository secrets. Both are the owner's to create; neither can be made
from here, and neither ever enters the repository.

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | What it is |
| --- | --- |
| `BACKUP_ENCRYPTION_KEY` | A long random passphrase. **Lose it and every backup is landfill** — there is no recovery, by design. Keep it somewhere that is not this repository and not the same account. |
| `SUPABASE_DB_URL` | The database connection string. |

Generate the key on your own machine, not in a chat:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

For `SUPABASE_DB_URL`, use Supabase → Project Settings → Database → **Session
pooler** (port 5432). Not the transaction pooler on 6543: `pg_dump` holds a
session and transaction mode will refuse it. The direct connection also works
if the project has IPv4.

Then run it once by hand — **Actions → Nightly backup → Run workflow** — rather
than waiting for 19:15 UTC to find out whether the secrets are right.

## Restoring one

### 1. Get the file

**Actions → Nightly backup →** pick a run **→ Artifacts →**
`sajilokaam-db-<timestamp>`. It downloads as a `.zip` containing one
`.dump.gpg`.

```bash
unzip sajilokaam-db-20261016T191500Z.zip
```

### 2. Open it

```bash
gpg --batch --decrypt \
  --passphrase-file ./key.txt \
  -o restore.dump \
  sajilokaam-20261016T191500Z.dump.gpg
```

Put the passphrase in `key.txt` rather than on the command line — a passphrase
in an argument is in your shell history and in `ps` output for every user on
the machine.

A wrong key fails loudly here. It does not produce a partial file, which is the
property the drill asserts: silent partial output would mean restoring garbage
over a live database on the worst day of the year.

### 3. Restore into a scratch database first

**Never restore straight over anything you still need.** Make an empty database,
restore into that, and look at it.

```bash
createdb sajilokaam_restore
pg_restore --dbname=sajilokaam_restore --no-owner --no-privileges restore.dump
```

`pg_restore` will print errors for roles and extensions that do not exist on the
target. Those are expected on a plain PostgreSQL instance and are why the dump
is taken `--no-owner --no-privileges`. What is **not** expected is an error
mentioning a table or a constraint.

### 4. Check it is actually there

The same four questions the drill asks:

```sql
-- Tables. Should be dozens, not a handful.
select count(*) from information_schema.tables where table_schema = 'public';

-- The guards. A restore that brought back the rows and not the rules is the
-- quietest possible disaster: every page renders and every policy is gone.
select count(*) from pg_policies where schemaname = 'public';
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';

-- The data, in a table whose contents you can recognise.
select slug, name_en from public.categories order by slug;
```

### 5. Only then, the real target

Restoring into the live Supabase project is a decision, not a step, and it is
not scripted here on purpose. The two reasons:

- **The dump has no roles or grants in it.** `--no-owner --no-privileges` makes
  it portable and means a restore does not re-establish `anon` and
  `authenticated`'s column grants. Those come from the migrations — re-run them
  after, and `npm run check:drift` is how you find out whether the result
  matches the tree.
- **A restore over a live database loses everything written since the dump.**
  That is a day at most, and it is still somebody's bookings.

## When it breaks

| What you see | What it is |
| --- | --- |
| `server version mismatch` | The runner's `pg_dump` is older than Supabase. The job installs `postgresql-client-17`; if Supabase upgrades to 18, that pin moves. |
| `Not configured: BACKUP_ENCRYPTION_KEY` | The secret is unset. The job refuses **before** dumping, so there is no plaintext on disk to leak. |
| `no valid OpenPGP data found` | The file is not encrypted, or the download was truncated. The job checks this against the real artifact before uploading, so it should be impossible to reach. |
| Job green, artifact missing | Cannot happen: `if-no-files-found: error`. The default is a warning and a green tick, which is a nightly success for a backup that does not exist. |
| `decryption failed: Bad session key` | Wrong passphrase. |

## The one thing worth re-reading

A backup nobody has restored is a belief, not a backup, and the failure is
perfectly silent until the day it matters. That is why the drill is a test that
runs on every verify rather than a procedure in this file — and why the step
above that restores into a *scratch* database is not optional.
