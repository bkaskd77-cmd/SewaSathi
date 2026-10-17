import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  bearerToken,
  cronTokenAccepted,
  jobTokenAccepted,
  tokenSeparation,
} from "@/lib/security/cron-token";

/**
 * The bearer token four scheduled jobs are guarded by.
 *
 * WHY THIS IS ONE FUNCTION NOW. The same five lines were written four times —
 * health's `deep=1`, the dispatch sweep, the payment reconciliation and the
 * retention sweep — and all four compared with `!==`, which returns at the
 * first differing byte. `/api/sms/send` next door had been written the careful
 * way with `timingSafeEqual`, so the product answered one question two ways and
 * the stricter answer was on the smaller consequence.
 *
 * THE BEHAVIOUR IS WHAT IS PINNED, NOT THE TIMING. Measuring a constant-time
 * comparison in a unit test measures the machine it runs on; what a test CAN
 * say is that the secret is never compared by length, that an unset secret
 * accepts nobody, and that `Bearer ` is stripped the way every caller sends it.
 * The constant-time property is the implementation's to keep, and
 * `tests/unit/admin-money-reauth.test.ts`'s honesty applies here too.
 */

describe("the cron bearer token", () => {
  const SECRET = "s3cr3t-value-nobody-guesses";

  it("accepts the right token, with or without the prefix", () => {
    expect(cronTokenAccepted(SECRET, `Bearer ${SECRET}`)).toBe(true);
    expect(cronTokenAccepted(SECRET, SECRET)).toBe(true);
    expect(cronTokenAccepted(SECRET, `bearer ${SECRET}`)).toBe(true);
  });

  it("refuses a wrong token of the same length", () => {
    const wrong = SECRET.slice(0, -1) + "X";
    expect(wrong).toHaveLength(SECRET.length);
    expect(cronTokenAccepted(SECRET, `Bearer ${wrong}`)).toBe(false);
  });

  it("refuses a prefix of the right token", () => {
    /* The case a length check would answer early and a digest comparison does
       not: the whole point of hashing first is that a near miss and a wild one
       are the same amount of work. */
    expect(cronTokenAccepted(SECRET, `Bearer ${SECRET.slice(0, 8)}`)).toBe(
      false,
    );
  });

  it("accepts nobody when the secret is unset", () => {
    /* `isFresh`'s direction for a missing stamp. A deployment that forgot the
       variable must not become one where every token works — and the empty
       string must not match the empty header, which is the shape that would do
       it. */
    for (const header of [null, "", "Bearer ", "Bearer anything"]) {
      expect(cronTokenAccepted(undefined, header)).toBe(false);
      expect(cronTokenAccepted("", header)).toBe(false);
    }
  });

  it("refuses a missing header against a real secret", () => {
    expect(cronTokenAccepted(SECRET, null)).toBe(false);
    expect(cronTokenAccepted(SECRET, "")).toBe(false);
  });

  it("strips only the scheme", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("abc")).toBe("abc");
    expect(bearerToken(null)).toBe("");
    /* A token that happens to start with the word is not re-stripped twice. */
    expect(bearerToken("Bearer Bearer-abc")).toBe("Bearer-abc");
  });
});

describe("nothing compares the secret itself", () => {
  it("has no route judging CRON_SECRET with an operator", () => {
    /* THE INVERSE CHECK, because four copies is how this started. A fifth cron
       endpoint written next month would reach for the shape that was in the
       other four, and nothing would have said so — the same reasoning
       `admin-gate-coverage.test.ts` gives for its eleventh action file. It
       looks for the comparison rather than for the absence of an import, since
       a route could import the helper and still compare by hand. */
    const offenders: string[] = [];

    for (const file of routeFiles()) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("CRON_SECRET")) continue;

      /*
       * THE OPERANDS, NOT THE LINE. The first version flagged any line holding
       * `===` and the word "secret", and its first catch was
       * `tokenSeparation(secrets) === "unset"` — a verdict string compared to a
       * verdict string, in the 401 hint. A checker that reports correct code is
       * one whose real entries get skimmed, which is the lesson `check:keys`
       * paid for three times. So this matches the shape that was actually
       * wrong: a bare secret-ish identifier, or a `process.env` member, as one
       * side of the comparison.
       */
      const COMPARED = [
        /\b(secret|token|offered|expected)\s*[!=]==/,
        /[!=]==\s*(secret|token|offered|expected)\b/,
        /process\.env\.\w+\s*[!=]==/,
        /[!=]==\s*process\.env\.\w+/,
      ];

      for (const line of source.split("\n")) {
        const code = line.split("//")[0];
        if (code.includes("undefined") || code.includes("null")) continue;
        if (COMPARED.some((rule) => rule.test(code))) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

function routeFiles(): string[] {
  const root = fileURLToPath(new URL("../../app/api/", import.meta.url));
  const out: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "route.ts") out.push(path);
    }
  }

  walk(root);
  return out.sort();
}

describe("one token no longer opens four doors", () => {
  const OWN = "the-health-token";
  const SHARED = "the-shared-cron-token";

  it("accepts the shared token until a job has its own", () => {
    /* The migration has to be safe on the deploy that ships it: until the owner
       sets the new variable, yesterday's token still works. */
    const secrets = { own: undefined, shared: SHARED };
    expect(jobTokenAccepted(secrets, `Bearer ${SHARED}`)).toBe(true);
    expect(tokenSeparation(secrets)).toBe("shared");
  });

  it("stops accepting the shared one the moment the job has its own", () => {
    /* THE PROPERTY THAT MAKES THIS A SEPARATION. Accepting either would be two
       keys to one door, which is the arrangement being ended — and it is the
       half somebody would get wrong by writing `||` over a list. */
    const secrets = { own: OWN, shared: SHARED };
    expect(jobTokenAccepted(secrets, `Bearer ${OWN}`)).toBe(true);
    expect(jobTokenAccepted(secrets, `Bearer ${SHARED}`)).toBe(false);
    expect(tokenSeparation(secrets)).toBe("own");
  });

  it("accepts nobody when neither is set", () => {
    const secrets = { own: undefined, shared: undefined };
    for (const header of [null, "", "Bearer ", `Bearer ${SHARED}`]) {
      expect(jobTokenAccepted(secrets, header)).toBe(false);
    }
    expect(tokenSeparation(secrets)).toBe("unset");
  });

  it("reports the two jobs Vercel invokes as shared, and says so on the route", () => {
    /*
     * NOT AN OVERSIGHT, AND THE CODE HAS TO SAY SO. Vercel sends `CRON_SECRET`
     * — that variable, that header — on the paths in `vercel.json`, with no
     * per-path mechanism, so a job-specific secret on the dispatch sweep means
     * Vercel's own nightly invocation refused, with the only evidence a
     * `cron_runs` row nobody wrote. Asserted on the source because the next
     * person to read those two routes will wonder why they were skipped.
     */
    for (const route of [
      "app/api/bookings/dispatch/route.ts",
      "app/api/payments/reconcile/route.ts",
    ]) {
      const source = readFileSync(route, "utf8");
      expect(source).toContain("THE SHARED TOKEN, AND IT CANNOT BE OTHERWISE");
      expect(source).toContain("process.env.CRON_SECRET");
    }
  });

  it("gives the two nobody schedules a token of their own", () => {
    const health = readFileSync("app/api/health/route.ts", "utf8");
    expect(health).toContain("process.env.HEALTH_SECRET");

    const retention = readFileSync("app/api/retention/sweep/route.ts", "utf8");
    expect(retention).toContain("process.env.RETENTION_SECRET");
    expect(retention).toContain("jobTokenAccepted");
  });

  it("does not hand CI the key to the money sweeps", () => {
    /*
     * THE CONCRETE GAIN, AND THE ONE WORTH PINNING. `check:drift` reads the
     * detailed health payload on every deploy, so a repository secret holds
     * that token. Before the split it would have been `CRON_SECRET` — a secret
     * for a read-only payload that also opens the sweep moving a
     * professional's money.
     */
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("HEALTH_SECRET: ${{ secrets.HEALTH_SECRET }}");
    expect(workflow).not.toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
  });
});
