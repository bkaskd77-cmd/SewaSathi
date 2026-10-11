import { describe, expect, it } from "vitest";

import { spawnSync } from "node:child_process";

import {
  DRIFT_SELF_TEST,
  driftRuleProblems,
  judgeDrift,
} from "../../scripts/drift-rule.mjs";
import {
  describeDrift,
  matchesTree,
  type DriftReading,
} from "@/lib/data/schema-drift";

/**
 * Drift has to be a gate, not a line on a page.
 *
 * WHAT HAPPENED. `db.functions` on `/api/health` compared the live function
 * fingerprints against the build's from the day it shipped, and it caught
 * genuine drift: `enforce_booking_immutability` in production had been rebuilt
 * from a stale copy, so it had lost the guard that stops a signed-in customer
 * writing `billable` on their own pending booking, the reassignment ban, and
 * the `provider_serves` coverage check. With `authenticated` holding UPDATE on
 * every column of `bookings`, that trigger was the only thing in front of them.
 *
 * Nothing happened for weeks. The endpoint was already `ok:false` over the
 * ungotten SMS gateway, so the new failure could not move the verdict — one
 * unresolved failure masking the next. The acknowledgement model fixes the
 * masking; this fixes the other half, which is that a finding needs a channel
 * that stops something.
 *
 * `scripts/check-drift.mjs` runs on every successful production deployment and
 * the nightly cron fails its own run on a mismatch. Both read the same
 * comparison, in `lib/data/schema-drift.ts`.
 */

const CHECK = "db.functions";
const payload = (state: string, detail = "x") => ({
  checks: [{ name: CHECK, state, detail }],
});

describe("the deployment gate", () => {
  /*
   * THE SCRIPT'S OWN SELF-TEST, RUN HERE TOO. It checks its rule before every
   * request, and it runs in neither CI nor the sandbox on its own — so between
   * one deployment and the next, nothing else would exercise it. The same
   * arrangement `check:deployed` has, for the same reason.
   */
  it("self-tests its rule with no network", () => {
    const run = spawnSync(
      process.execPath,
      ["scripts/check-drift.mjs", "--self-test"],
      { encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("self-tested");
  });

  it("agrees with that self-test case by case", () => {
    expect(driftRuleProblems()).toEqual([]);
    expect(DRIFT_SELF_TEST.length).toBe(6);
  });

  it("passes only on a comparison that was made and found nothing", () => {
    expect(judgeDrift(payload("ok")).code).toBe(0);
  });

  it("fails on a mismatch", () => {
    expect(judgeDrift(payload("down", "1 differs (x)")).code).toBe(1);
  });

  /*
   * EXIT 2 IS "COULD NOT LOOK", never 0 and never 1 — the contract
   * `check:deployed` and `check:timing` already hold, because the agent sandbox
   * cannot reach the site at all and a blocked request must not read as a pass.
   * `unknown` on the deployment means no service-role key there, which is
   * nobody looking rather than nothing drifting.
   */
  it("separates could-not-look from both verdicts", () => {
    expect(judgeDrift(payload("unknown", "no key")).code).toBe(2);
    expect(judgeDrift({}).code).toBe(2);
    expect(judgeDrift(null).code).toBe(2);
  });

  /*
   * A DEPLOYMENT THAT DOES NOT REPORT THE CHECK IS A FAILURE. The check is
   * unconditional in the route, so its absence means an older build is serving
   * or somebody removed it — and "the drift gate is gone" is the one thing a
   * drift gate must not shrug at.
   */
  it("fails when the check is missing from the payload entirely", () => {
    expect(judgeDrift({ checks: [{ name: "db", state: "ok", detail: "" }] }).code).toBe(1);
  });

  /*
   * The 503 case, which is the one it exists for: the endpoint answers 503
   * whenever anything unacknowledged fails, and a gate that refused to parse a
   * 503 body would be blind exactly then.
   */
  it("reads a payload that arrived with a 503", () => {
    const body = {
      ok: false,
      checks: [
        { name: "auth.sms", state: "down", detail: "gateway" },
        { name: CHECK, state: "down", detail: "2 differ" },
      ],
    };
    expect(judgeDrift(body).code).toBe(1);
  });
});

describe("the reading the deployment makes", () => {
  const read = (over: Partial<Extract<DriftReading, { read: true }>> = {}) =>
    ({ read: true, drifted: [], missing: [], compared: 60, ...over }) as DriftReading;

  it("is a match only when nothing drifted and nothing is missing", () => {
    expect(matchesTree(read())).toBe(true);
    expect(matchesTree(read({ drifted: ["f"] }))).toBe(false);
    expect(matchesTree(read({ missing: ["f"] }))).toBe(false);
  });

  /*
   * A FAILED READ IS NOT A MATCH. Rule 6 in the shape it takes for a
   * comparison: `matchesTree` must never answer true for a reading nobody took,
   * because every caller treats true as "the schema is fine".
   */
  it("is never a match on a reading that could not be made", () => {
    expect(matchesTree({ read: false, why: "no key" })).toBe(false);
  });

  it("carries its own sample on a clean answer", () => {
    // A bare "all match" says nothing about how many were compared, and a
    // comparison over an empty fingerprint file would read identically.
    expect(describeDrift(read())).toContain("60");
  });

  it("names what drifted, and says where it came from", () => {
    const sentence = describeDrift(
      read({ drifted: ["enforce_booking_immutability"] }),
    );
    expect(sentence).toContain("enforce_booking_immutability");
    expect(sentence).toContain("outside supabase/migrations");
  });

  it("distinguishes missing from drifted", () => {
    const sentence = describeDrift(read({ missing: ["clear_booking_days"] }));
    expect(sentence).toContain("missing");
    expect(sentence).toContain("clear_booking_days");
  });
});
