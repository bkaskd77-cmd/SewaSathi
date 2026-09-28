import { describe, expect, it } from "vitest";

import {
  FALLBACK_FIRING_STATE,
  FALLBACK_UNREADABLE_STATE,
  servesCustomers,
  smsProbeTarget,
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


/**
 * The SMS probe sends what a sign-in sends, or it sends nothing.
 *
 * `checkSmsDelivery` used to pass `SMS_HEALTH_NUMBER` to Supabase exactly as
 * typed, while every real sign-in goes through `checkNepaliMobile` and sends
 * `+977XXXXXXXXXX`. So any other spelling made the one check that exists to
 * prove the sign-in path test a path nobody takes — and a format mistake came
 * back as `auth.sms: down` carrying the provider's complaint, which reads as a
 * broken gateway when the truth is a typo in Vercel.
 */
describe("the number the SMS probe sends", () => {
  it("sends the same E.164 whatever spelling the variable is in", () => {
    // The point is not that these parse — `checkNepaliMobile` is tested for
    // that. It is that the probe ends up sending the ONE string `sendOtp`
    // sends, so what it proves is what a customer's sign-in does.
    for (const spelling of [
      "9779841234567",
      "+9779841234567",
      "9841234567",
      "+977 984 123 4567",
      "  9779841234567  ",
      "09841234567",
    ]) {
      const target = smsProbeTarget(spelling);
      expect(target.ok, `${spelling} did not parse`).toBe(true);
      if (target.ok) expect(target.e164).toBe("+9779841234567");
    }
  });

  it("cannot 503 a working product when the variable is wrong", () => {
    /*
     * THE STATE MATTERS MORE THAN THE MESSAGE. `servesCustomers` turns
     * everything but `ok` and `skipped` into a 503, and a number we cannot read
     * means we did not look — no customer is affected by that. This is the
     * mistake `checkTriageFallback` made once with the reasoning written
     * correctly beside it, so it is asserted through `servesCustomers` rather
     * than as a string comparison.
     */
    for (const bad of ["", "   ", "0142345678", "98412", "98412345678", "abc"]) {
      const target = smsProbeTarget(bad);
      expect(target.ok, `${bad} should not have parsed`).toBe(false);

      const checks = [
        { name: "auth.sms", state: "skipped" as const, detail: "not sent" },
      ];
      expect(servesCustomers(checks), `${bad} took the endpoint down`).toBe(true);
    }
  });

  it("tells an unset variable apart from a malformed one", () => {
    // Different sentences on the screen: one is "nobody configured this", the
    // other is "this is configured wrongly, and it is not the gateway".
    const unset = smsProbeTarget(undefined);
    expect(unset.ok).toBe(false);
    if (!unset.ok) expect(unset.reason).toBe("unset");

    const landline = smsProbeTarget("0142345678");
    expect(landline.ok).toBe(false);
    if (!landline.ok) expect(landline.reason).toBe("landline");
  });
});
