import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PG_MAJOR } from "../support/postgres";

/**
 * The database suite's Postgres is installed by CI, and the version is one
 * fact written twice.
 *
 * WHY THIS EXISTS. `ci.yml` said "ubuntu-latest ships the server binaries" and
 * `tests/support/postgres.ts` hardcoded `/usr/lib/postgresql/16/bin`. Both were
 * true until GitHub moved `ubuntu-latest` to ubuntu-26.04 in November 2026,
 * which ships no PostgreSQL 16 — and all forty-nine db files failed with
 * `initdb ENOENT` on the commit carrying a next.js security fix, so a runner
 * image nobody here chose held a patch out of production. The fix names the
 * version in both places; this is what stops them drifting apart again, since
 * the next person to move the harness to 17 (production's major) will edit one
 * file and the other will still say 16.
 *
 * READ OUT OF THE WORKFLOW FILES rather than a list of jobs, the way
 * `drift-token.test.ts` reads them: any job that runs the test suite is
 * covered the day it exists.
 */

const WORKFLOWS = ".github/workflows";

function workflows(): Array<{ file: string; text: string }> {
  return readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({ file: f, text: readFileSync(path.join(WORKFLOWS, f), "utf8") }));
}

/** Every job block in a workflow, as its own text. */
function jobs(text: string): string[] {
  const body = text.slice(text.indexOf("\njobs:"));
  return body.split(/\n {2}(?=[A-Za-z0-9_-]+:\s*\n)/).slice(1);
}

describe("the database suite's Postgres is installed, not inherited", () => {
  const testingJobs = workflows().flatMap(({ file, text }) =>
    jobs(text)
      .filter((job) => /run:\s*npm run (test|verify)\b/.test(job))
      .map((job) => ({ file, job })),
  );

  it("finds the jobs it is meant to check", () => {
    /* A pattern that stopped matching would let every case below pass over an
       empty list — `drift-token.test.ts`' reason for counting first. */
    expect(testingJobs.length).toBeGreaterThanOrEqual(1);
  });

  it("installs the harness's major explicitly in every job that runs the suite", () => {
    for (const { file, job } of testingJobs) {
      const installs = [...job.matchAll(/apt-get install[^\n]*\bpostgresql-(\d+)\b/g)].map(
        (m) => Number(m[1]),
      );
      expect(installs, `${file} runs the db suite without installing Postgres`).not.toEqual(
        [],
      );
      expect(installs, `${file} installs a different major from the harness`).toContain(
        PG_MAJOR,
      );
    }
  });

  it("installs it BEFORE the suite runs", () => {
    for (const { file, job } of testingJobs) {
      const install = job.search(/apt-get install[^\n]*\bpostgresql-\d+\b/);
      const suite = job.search(/run:\s*npm run (test|verify)\b/);
      expect(install, `${file}: Postgres installed after the suite`).toBeLessThan(suite);
    }
  });

  it("no longer claims the runner ships it", () => {
    /* The sentence that broke. A comment describing behaviour the
       infrastructure no longer has is how this read as deliberate. */
    for (const { file, text } of workflows()) {
      expect(text, file).not.toMatch(/ubuntu-latest ships the server binaries/);
    }
  });
});
