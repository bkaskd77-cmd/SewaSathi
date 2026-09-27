import { describe, expect, it } from "vitest";

import {
  FALLBACK_FIRING_STATE,
  FALLBACK_UNREADABLE_STATE,
  servesCustomers,
  type HealthCheck,
} from "@/lib/config/health";

/**
 * The 200-or-503 rule, which had never been asserted.
 *
 * `/api/health` is the one URL that answers "can this serve a customer right
 * now" and it shipped with no test at all. That is how the contradiction below
 * survived: the rule could only be read, and reading it is exactly what its
 * author did before writing a comment that described behaviour the code did not
 * have.
 */

const check = (state: HealthCheck["state"], name = "x"): HealthCheck => ({
  name,
  state,
  detail: "",
});

describe("what takes the endpoint to 503", () => {
  it("passes on ok and skipped", () => {
    expect(servesCustomers([check("ok"), check("skipped")])).toBe(true);
  });

  /*
   * `unknown` FAILING IS THE POINT OF THE ENDPOINT. Sign-in was down for a day
   * because a dependency nobody could verify was assumed fine. A check that
   * cannot see its subject must not read as working.
   */
  it("fails on unknown, the same as down", () => {
    expect(servesCustomers([check("ok"), check("unknown")])).toBe(false);
    expect(servesCustomers([check("ok"), check("down")])).toBe(false);
  });

  /*
   * AND THAT IS PRECISELY WHY THE STATE CHOICE MATTERS. This is the assertion
   * the old code fails. `checkTriageFallback` returned `unknown` under a comment
   * saying it chose that state so a 503 "would not be a lie" — but unknown and
   * down are the same verdict here, so the 503 was served regardless.
   *
   * It fired in production: key set, 4 of 4 triages answered by the keyword
   * matcher, /api/health 503 — with all four customers answered, which is what
   * the fallback exists to do.
   */
  it("does not go down because triages fell back on a live key", () => {
    const checks = [check("ok", "database"), check(FALLBACK_FIRING_STATE, "triage.fallback")];
    expect(servesCustomers(checks)).toBe(true);
  });

  /*
   * THE DISTINCTION THAT KEEPS THE FIX HONEST. Failing to READ the log is still
   * unverifiable, so it still takes the endpoint down. "Looked and found
   * something harmless" and "could not look" are different facts and must not
   * collapse into one state — which is the same rule as null meaning "not
   * recorded" rather than "no hazard".
   */
  it("still goes down when the log cannot be read at all", () => {
    expect(
      servesCustomers([check(FALLBACK_UNREADABLE_STATE, "triage.fallback")]),
    ).toBe(false);
    expect(FALLBACK_FIRING_STATE).not.toBe(FALLBACK_UNREADABLE_STATE);
  });

  it("an empty check list serves nobody a false alarm", () => {
    expect(servesCustomers([])).toBe(true);
  });
});
