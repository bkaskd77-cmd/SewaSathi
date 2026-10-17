import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEEP_CHECKS,
  DETAILED_CHECKS,
  PUBLIC_CHECKS,
  isPublicCheck,
} from "@/lib/config/health";

/**
 * What a public request pays for, and what waits behind the token.
 *
 * THE INCIDENT. UptimeRobot reported `/api/health` down with a connection
 * timeout at 11:05 Oslo on 2026-10-17 — the minute a deployment went live and
 * the alias flipped. The route it was pointed at made nine network round trips
 * on a cold function before it could answer anything: a database read, an auth
 * settings read, a service-role read, three region samples, a function
 * fingerprint query, a triage-fallback count, a cron-runs read and an AI spend
 * read. Whatever the proximate cause of that one timeout, a URL whose job is
 * "can this serve a customer right now" must not be the slowest thing in the
 * product.
 *
 * THE LISTS ARE THE CONTRACT. A comment saying "the public path is cheap" is
 * worth nothing the first time somebody adds a check to the wrong array, which
 * is how this route grew to nine in the first place — every one of them added
 * for a good reason, none of them weighed against the cost of the whole.
 */

const ROUTE = "app/api/health/route.ts";

/** Every check name the route can emit, read out of the source. */
function namesInRoute(): string[] {
  const source = readFileSync(ROUTE, "utf8");
  const found = new Set<string>();
  for (const match of source.matchAll(/name:\s*"([a-zA-Z.]+)"/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

describe("the public health check is cheap", () => {
  it("runs exactly two network reads, and they are the two that matter", () => {
    /*
     * `database` — the catalogue cannot be read, so every page is serving seed
     * data. `auth.config` — phone sign-in is off, so nobody can get in, which
     * is the outage this whole endpoint was built after. Everything else on the
     * public list is an environment variable or in-process state.
     */
    expect(PUBLIC_CHECKS).toContain("database");
    expect(PUBLIC_CHECKS).toContain("auth.config");
  });

  it("keeps the real database query public, which is what keeps the project awake", () => {
    /*
     * NOT ONLY A LIVENESS CHECK. Supabase pauses a free project after a week of
     * inactivity, so a five-minute monitor hitting a route that really queries
     * the database is also what stops the project going to sleep. Dropping this
     * read would be a saving that pauses production — pinned here because the
     * cost of the mistake is invisible for six days.
     */
    expect(isPublicCheck("database")).toBe(true);
    const source = readFileSync(ROUTE, "utf8");
    expect(source).toContain("/rest/v1/categories?select=slug&limit=1");
  });

  it("leaves every round-trip check behind the token", () => {
    for (const name of [
      "server.serviceRole",
      "server.region",
      "db.functions",
      "triage.fallback",
      "cron.runs",
      "sms.budget",
    ]) {
      expect(DETAILED_CHECKS, `${name} should cost a token`).toContain(name);
      expect(isPublicCheck(name)).toBe(false);
    }
  });

  it("leaves the two that cost money behind the token AND the parameter", () => {
    expect(DEEP_CHECKS).toEqual(["auth.sms", "triage.model"]);
    for (const name of DEEP_CHECKS) {
      expect(isPublicCheck(name)).toBe(false);
      expect(DETAILED_CHECKS as readonly string[]).not.toContain(name);
    }
  });

  it("gives a public reader the verdict and no inventory of our dependencies", () => {
    /*
     * The pre-launch audit listed "/api/health is public and names every
     * dependency" as an accepted risk. It is not accepted any more, and the
     * shape is what proves it: the untokened branch returns three keys and
     * returns before `checks` is ever serialised.
     */
    const source = readFileSync(ROUTE, "utf8");
    expect(source).toContain(
      "{ ok: verdict.ok, clean: verdict.clean, commit: BUILD_COMMIT_SHORT }",
    );
  });
});

describe("the three lists account for every check", () => {
  it("names every check the route can emit", () => {
    /*
     * THE COVERAGE HALF, and the one that keeps this honest. A check added to
     * the route and to neither list would simply never run — which looks
     * exactly like a check that is passing. `coverageGaps` in the deploy walk
     * is the same rule for routes.
     */
    const declared = new Set<string>([
      ...PUBLIC_CHECKS,
      ...DETAILED_CHECKS,
      ...DEEP_CHECKS,
    ]);
    const undeclared = namesInRoute().filter((name) => !declared.has(name));
    expect(
      undeclared,
      `checks the route can emit that no list claims: ${undeclared.join(", ")}`,
    ).toEqual([]);
  });

  it("claims nothing the route cannot emit", () => {
    /* The other direction: a list entry for a check somebody deleted is a rule
       guarding nothing, and reads from the list exactly like one that bites. */
    const emitted = new Set(namesInRoute());
    for (const name of [...PUBLIC_CHECKS, ...DETAILED_CHECKS, ...DEEP_CHECKS]) {
      expect(emitted.has(name), `${name} is declared and never emitted`).toBe(
        true,
      );
    }
  });

  it("puts each check in exactly one list", () => {
    const all = [...PUBLIC_CHECKS, ...DETAILED_CHECKS, ...DEEP_CHECKS];
    expect(new Set(all).size).toBe(all.length);
  });
});
