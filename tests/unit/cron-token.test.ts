import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bearerToken, cronTokenAccepted } from "@/lib/security/cron-token";

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

      for (const line of source.split("\n")) {
        const code = line.split("//")[0];
        if (!code.includes("secret") && !code.includes("CRON_SECRET")) continue;
        if (/[!=]==/.test(code) && !code.includes("undefined")) {
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
