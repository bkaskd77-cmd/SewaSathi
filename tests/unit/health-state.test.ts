import { describe, expect, it } from "vitest";

import {
  FALLBACK_FIRING_STATE,
  FALLBACK_UNREADABLE_STATE,
  PUSH_NOT_READY_STATE,
  TWA_STATE,
  pushKeyStatus,
  pushReadiness,
  SEALING_NOT_READY_STATE,
  sealingReadiness,
  SESSION_CONFIG_STATE,
  ACKNOWLEDGED_FAILURES,
  healthVerdict,
  servesCustomers,
  type HealthState,
  SMS_GATEWAY_UNSET_STATE,
  SMS_PROBE_STATE,
  smsProbeReadiness,
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

/**
 * The probe's preconditions, readable without spending an SMS.
 *
 * `SMS_HEALTH_NUMBER` was set in Vercel and nothing in the product could say
 * so — set or unset, Production or Preview-only, visible to the running build
 * or not, sendable or not. All four look identical behind
 * `sms.gateway: credentials present`, so the first line telling them apart cost
 * one SMS and a shell with a credential in it. `smsProbeReadiness` is that
 * line; these are its rules, because here the sentence IS the feature.
 */
describe("what deep=1 would do with the variable as it stands", () => {
  it("sends the reader to the variable and never to the gateway", () => {
    /*
     * The sign-in outage's lesson with the blame pointing the right way. A
     * misconfigured health variable reported as a gateway fault sends somebody
     * to Twilio for a typo in Vercel, which is the confusion this endpoint
     * exists to remove.
     */
    for (const raw of [undefined, "", "0142345678", "98412", "9779841234567"]) {
      const sentence = smsProbeReadiness(smsProbeTarget(raw));
      expect(sentence, `${raw} did not name the variable`).toContain(
        "SMS_HEALTH_NUMBER",
      );
      expect(sentence, `${raw} did not say what deep=1 would do`).toContain(
        "deep=1",
      );
    }
  });

  it("never reads as a passing gateway when the variable merely parses", () => {
    // A parseable number proves the probe COULD run. Only the send proves a
    // message arrives, which is why the gateway stays a launch blocker until
    // `deep=1` has been seen to report `ok`. A sentence that read as a pass
    // would quietly clear it.
    const sentence = smsProbeReadiness(smsProbeTarget("9779841234567"));
    expect(sentence).toContain("unproven");
    expect(sentence).toContain("will send one SMS");
  });

  it("never prints the number it was given", () => {
    /*
     * `/api/health` is public and that is a real handset belonging to a real
     * person. "It reads as a Nepali mobile" is the whole fact worth reporting,
     * and `PhoneError` is a fixed key set carrying no digits of its own.
     *
     * Asserted rather than trusted because a reworded sentence is exactly how
     * this would be lost — the same reason the activity strip's select is
     * pinned: the privacy boundary is one line of text and nothing else guards
     * it.
     */
    for (const spelling of ["9779841234567", "9841234567", "+977 984 123 4567"]) {
      const sentence = smsProbeReadiness(smsProbeTarget(spelling));
      expect(sentence, spelling).not.toContain("9841234567");
      expect(sentence, spelling).not.toContain("841234567");
    }
  });

  it("says which of unset and malformed it found", () => {
    const unset = smsProbeReadiness(smsProbeTarget(undefined));
    const landline = smsProbeReadiness(smsProbeTarget("0142345678"));

    expect(unset).toContain("not set");
    // The test-number trap belongs on the screen somebody reads while setting
    // the variable: GoTrue answers those itself and never calls the gateway,
    // which is the check faking its own pass.
    expect(unset).toContain("test number");

    expect(landline).toContain("landline");
    expect(landline).not.toBe(unset);
  });

  it("cannot 503 a working product in any of its states", () => {
    /*
     * `auth.sms.probe` is always `skipped`, and `servesCustomers` is what makes
     * that matter: everything but `ok` and `skipped` is a 503. A probe nobody
     * can run is not a customer-facing fault — nobody signing in is affected by
     * an unset health variable. Asserted through `servesCustomers` so the case
     * reads as the rule rather than as a string comparison.
     */
    for (const raw of [undefined, "0142345678", "9779841234567"]) {
      const check: HealthCheck = {
        name: "auth.sms.probe",
        state: SMS_PROBE_STATE,
        detail: smsProbeReadiness(smsProbeTarget(raw)),
      };
      expect(servesCustomers([check]), `${raw} took the endpoint down`).toBe(
        true,
      );
    }
  });
});

/**
 * The verdict this endpoint actually returned in production, pinned.
 *
 * `/api/health` answered `"ok":false` — a 503 — on `f29583f`, with every
 * customer-facing dependency green. Nobody had read its own verdict before;
 * every test here asserted one check at a time, and each of the two states
 * causing it was individually defensible.
 *
 * `session.config` is documented as permanently `unknown` **on purpose**, and
 * permanently `unknown` is permanently 503 — so this endpoint has never once
 * returned 200 in the life of the product. The monitor that would have caught
 * the sign-in outage is the one that has been crying wolf since the day it
 * shipped.
 *
 * So the fixture is the whole payload rather than a state at a time. That is the
 * activity floor's lesson: a test that re-reads the thing it is checking asserts
 * nothing, and the constraint worth pinning is the one a person would state —
 * **a working product answers 200**.
 */
const LIVE_PAYLOAD_F29583F: HealthCheck[] = [
  { name: "session.config", state: SESSION_CONFIG_STATE, detail: "" },
  { name: "auth.config", state: "ok", detail: "" },
  { name: "database", state: "ok", detail: "" },
  { name: "server.serviceRole", state: "ok", detail: "" },
  { name: "server.region", state: "ok", detail: "" },
  { name: "db.functions", state: "ok", detail: "" },
  { name: "triage", state: "ok", detail: "" },
  { name: "triage.fallback", state: "ok", detail: "" },
  { name: "cron.runs", state: "ok", detail: "" },
  { name: "sms.gateway", state: SMS_GATEWAY_UNSET_STATE, detail: "" },
  { name: "auth.sms.probe", state: SMS_PROBE_STATE, detail: "" },
  /*
   * Added after the payload above was captured. Kept in the fixture rather
   * than left out: the case asserts that the configuration this product runs
   * on answers 200, and a check added later is part of that configuration. A
   * fixture frozen at one commit would stop being the thing under test the
   * first time the endpoint grew.
   */
  { name: "payout.sealing", state: SEALING_NOT_READY_STATE, detail: "" },
  { name: "notify.push", state: PUSH_NOT_READY_STATE, detail: "" },
  { name: "twa.assetlinks", state: TWA_STATE, detail: "" },
  { name: "rateLimit", state: "ok", detail: "" },
  { name: "sms.budget", state: "ok", detail: "" },
];

describe("the verdict production actually returned", () => {
  /*
   * THE THREE STATES ARE READ, NOT SPELLED, and that is deliberate here where
   * it would normally be the blind-test smell. They are what is under test;
   * the assertion is the BEHAVIOUR they produce — a working product answers
   * 200 — which is the sentence a person would say and which no arrangement of
   * per-check cases ever stated. Put either constant back to `unknown` and this
   * goes red, which is exactly what did not happen for the life of the product.
   */
  it("answers 200 for the configuration this product runs on", () => {
    expect(servesCustomers(LIVE_PAYLOAD_F29583F)).toBe(true);
  });

  it("still goes down when a customer really is affected", () => {
    /*
     * The fix must not read as "make the checks stop complaining". A gateway
     * with missing credentials fails every code, an unreadable triage log is a
     * read that FAILED rather than one nobody attempted, and both still take
     * the endpoint to 503 beside the same thirteen checks.
     */
    for (const broken of [
      { name: "sms.gateway", state: "down" as const, detail: "credentials missing" },
      {
        name: "triage.fallback",
        state: FALLBACK_UNREADABLE_STATE,
        detail: "could not read",
      },
    ]) {
      const payload = LIVE_PAYLOAD_F29583F.map((check) =>
        check.name === broken.name ? broken : check,
      );
      expect(servesCustomers(payload), broken.name).toBe(false);
    }
  });
});

/**
 * Whether this deployment can seal an account number, readable for free.
 *
 * THE `SMS_HEALTH_NUMBER` LESSON, APPLIED BEFORE IT COST ANYTHING. A key that
 * is set but truncated looks identical to a working one from every dashboard:
 * Vercel cannot read a sensitive variable back, the build succeeds, every page
 * renders. The first signal would be a professional failing to save where they
 * are paid, with an error that looks like a bug in the form.
 */
describe("what the sealing key is", () => {
  const unset = { ok: false as const, reason: "unset", length: 0 };
  const short = { ok: false as const, reason: "badLength", length: 24 };
  const ready = { ok: true as const };

  it("gives three different sentences, because they are three different jobs", () => {
    /*
     * Nobody set it / somebody set it wrongly / it works. Collapsing the middle
     * into either neighbour is how "present" came to read as "working" on
     * `checkTriage` for months.
     */
    const sentences = [
      sealingReadiness(unset),
      sealingReadiness(short),
      sealingReadiness(ready),
    ];
    expect(new Set(sentences).size).toBe(3);
    for (const sentence of sentences) {
      expect(sentence).toContain("PAYOUT_ENCRYPTION_KEY");
    }
  });

  it("names the length when the key is the wrong size", () => {
    // The fact that identifies a truncated paste, and the one a reader can act
    // on without being able to see the value.
    expect(sealingReadiness(short)).toContain("24 bytes");
    expect(sealingReadiness(short)).toContain("must be 32");
    expect(sealingReadiness(short)).toContain("openssl rand -base64 32");
  });

  it("says a working key still proves nothing about a stored value", () => {
    // `ok` here means "we can seal", not "everything that was sealed opens".
    // Reporting the stronger claim is the mistake this endpoint keeps making.
    expect(sealingReadiness(ready)).toContain("only proved by reading one back");
  });

  it("says plainly that an unset key breaks nothing else", () => {
    expect(sealingReadiness(unset)).toContain("Nothing else is affected");
  });

  it("cannot 503 a working product when the key is missing or wrong", () => {
    /*
     * `servesCustomers` turns anything but `ok` and `skipped` into a 503, and a
     * missing sealing key stops nobody booking a plumber. It stops a
     * professional saving where they are paid — a real fault, and not the
     * question this endpoint asks.
     */
    for (const status of [unset, short]) {
      const check: HealthCheck = {
        name: "payout.sealing",
        state: SEALING_NOT_READY_STATE,
        detail: sealingReadiness(status),
      };
      expect(servesCustomers([check]), status.reason).toBe(true);
    }
  });
});

/**
 * One known failure must never mask another.
 *
 * THE INCIDENT. `auth.sms` has been `down` since the gateway was proved
 * unconfigured — Supabase's Twilio Account SID is still `AC` plus thirty-two
 * zeros — so `/api/health` answered `ok:false` every single day. When
 * `db.functions` then began reporting live schema drift, with a trigger in
 * production missing the guards that stop a signed-in customer writing
 * `billable` on their own booking, **the verdict did not move**: already red,
 * still red, for weeks. The endpoint built to catch an unnoticed dependency
 * failure had become the thing nobody could read.
 *
 * `ok` is therefore about failures NOBODY HAS SEEN, and `clean` is the other
 * half rather than the same boolean doing two jobs.
 */
const AT = new Date("2026-10-11T12:00:00Z");

const named = (name: string, state: HealthState) => ({ name, state });

describe("a known failure acknowledged, and the next one still red", () => {
  it("serves 200 with only the acknowledged failure down", () => {
    const verdict = healthVerdict(
      [named("auth.sms", "down"), named("db", "ok")],
      AT,
    );
    expect(verdict.ok).toBe(true);
    // AND NOT CLEAN. The fault is real, it is still reported, and the payload
    // says which failure was forgiven — a hidden failure and no failure must
    // not look alike.
    expect(verdict.clean).toBe(false);
    expect(verdict.acknowledged).toEqual(["auth.sms"]);
    expect(verdict.failing).toContain("auth.sms");
  });

  /*
   * THE REGRESSION, AS THE CASE THAT ACTUALLY HAPPENED. Drift arrives beside
   * the acknowledged gateway and has to move the verdict on its own.
   */
  it("goes red the moment an unacknowledged check joins it", () => {
    const verdict = healthVerdict(
      [named("auth.sms", "down"), named("db.functions", "down")],
      AT,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.unacknowledged).toEqual(["db.functions"]);
    expect(verdict.acknowledged).toEqual(["auth.sms"]);
  });

  it("names one check and never a prefix, so there is no blanket mute", () => {
    for (const ack of ACKNOWLEDGED_FAILURES) {
      expect(ack.check).not.toMatch(/[*]/);
      expect(ack.reason.length).toBeGreaterThan(40);
      expect(ack.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /*
   * An acknowledgement for `auth.sms` must not forgive `auth.sms.probe`, which
   * is a different check with a longer name — the shape a prefix match would
   * have got wrong, and the probe is `skipped` anyway so the pair is a real one.
   */
  it("does not forgive a check whose name merely starts the same", () => {
    const verdict = healthVerdict([named("auth.sms.probe", "down")], AT);
    expect(verdict.ok).toBe(false);
    expect(verdict.unacknowledged).toEqual(["auth.sms.probe"]);
  });
});

describe("the expiry is the mechanism, so it has to bite", () => {
  /*
   * AN ACKNOWLEDGEMENT WITH NO END DATE is how a known issue becomes a
   * forgotten one, which is the masking bug wearing a decision. Past the date
   * it forgives nothing: the choice is to fix the fault or to look at it again
   * and write a new date down.
   */
  it("stops forgiving the day after the date it names", () => {
    const [sms] = ACKNOWLEDGED_FAILURES;
    // One second past the end of the named day, built from the parsed instant
    // rather than written as `23:59:60` — that string is a leap second some
    // engines refuse, and an Invalid Date here would be testing the clock guard
    // instead of the expiry.
    const after = new Date(Date.parse(`${sms.until}T23:59:59Z`) + 1_000);
    const verdict = healthVerdict([named(sms.check, "down")], after);

    expect(verdict.ok).toBe(false);
    expect(verdict.expired).toEqual([sms.check]);
    // Counted as unacknowledged too — the lists are two readings of one fact,
    // and `ok` is computed from the one that pages somebody.
    expect(verdict.unacknowledged).toEqual([sms.check]);
  });

  /* The named day is forgiven to its END, not from its first instant. */
  it("still forgives on the last day it names", () => {
    const [sms] = ACKNOWLEDGED_FAILURES;
    const lastMoment = new Date(`${sms.until}T23:59:58Z`);
    expect(healthVerdict([named(sms.check, "down")], lastMoment).ok).toBe(true);
  });

  it("treats an unparseable date as expired rather than as forever", () => {
    // Not reachable through ACKNOWLEDGED_FAILURES while the shape test above
    // passes, and asserted anyway: the failure direction of a typo in this file
    // must be "nothing is forgiven", never "everything is".
    const verdict = healthVerdict([named("auth.sms", "down")], AT);
    expect(verdict.ok).toBe(true);
    const broken = healthVerdict([named("auth.sms", "down")], new Date("x"));
    expect(broken.ok).toBe(false);
  });
});

describe("an acknowledgement that outlived its fault is loud", () => {
  /*
   * NOT RED — nothing is wrong right now — AND REPORTED, because an
   * acknowledgement sitting on a healthy check silently forgives that check's
   * NEXT failure. That is the masking bug coming back through the other door,
   * and it is the one thing this file cannot catch by itself once the gateway
   * is fixed and nobody deletes the entry.
   */
  it("reports a stale acknowledgement without taking the endpoint down", () => {
    const verdict = healthVerdict([named("auth.sms", "ok")], AT);
    expect(verdict.ok).toBe(true);
    expect(verdict.clean).toBe(true);
    expect(verdict.stale).toEqual(["auth.sms"]);
  });

  /* A deep check absent from a shallow payload is not stale — it did not run. */
  it("says nothing about a check that was not performed", () => {
    const verdict = healthVerdict([named("db", "ok")], AT);
    expect(verdict.stale).toEqual([]);
  });
});

describe("the verdict agrees with the old rule where there is nothing to forgive", () => {
  /*
   * `servesCustomers` is still the primitive — "is any check failing at all" —
   * and `clean` is exactly it. Asserted as an identity over the live payload
   * and over every single-state payload, so the acknowledgement layer cannot
   * quietly change what counts as a failure.
   */
  it("matches servesCustomers on clean, for every state", () => {
    for (const state of ["ok", "skipped", "down", "unknown"] as HealthState[]) {
      const checks = [named("something.nobody.acknowledged", state)];
      expect(healthVerdict(checks, AT).clean).toBe(servesCustomers(checks));
    }
  });

  it("matches it on the live payload too", () => {
    const verdict = healthVerdict(LIVE_PAYLOAD_F29583F, AT);
    expect(verdict.clean).toBe(servesCustomers(LIVE_PAYLOAD_F29583F));
    expect(verdict.ok).toBe(true);
  });
});

describe("whether push is configured, before it costs anything", () => {
  /*
   * THE HALF-CONFIGURED DEPLOYMENT IS THE CASE THIS EXISTS FOR, and it is easy
   * to reach: the pair is a public variable and a secret, set in two places in
   * a dashboard. With only the public half everything looks healthy — browsers
   * subscribe, rows are written, the opt-in panel says notifications are on —
   * and every send throws. Nobody is pushed, and because `notConfigured`
   * deliberately does not escalate, nobody is texted either.
   */
  it("is ok only when both halves are set", () => {
    expect(pushKeyStatus({ publicKey: "pub", privateKey: "priv" }).ok).toBe(true);
    expect(pushKeyStatus({ publicKey: "pub" }).ok).toBe(false);
    expect(pushKeyStatus({ privateKey: "priv" }).ok).toBe(false);
    expect(pushKeyStatus({}).ok).toBe(false);
  });

  it("treats whitespace as unset", () => {
    // A dashboard variable saved with a stray newline is set and useless.
    expect(pushKeyStatus({ publicKey: "  ", privateKey: "priv" }).ok).toBe(false);
  });

  it("says which half is missing, because the advice differs", () => {
    const publicOnly = pushReadiness(pushKeyStatus({ publicKey: "pub" }));
    expect(publicOnly).toContain("VAPID_PRIVATE_KEY");
    expect(publicOnly).toContain("subscribe");

    const privateOnly = pushReadiness(pushKeyStatus({ privateKey: "priv" }));
    expect(privateOnly).toContain("NEXT_PUBLIC_VAPID_PUBLIC_KEY");

    expect(pushReadiness(pushKeyStatus({}))).toContain("No VAPID keys set");
  });

  it("never prints either key", () => {
    const secret = "a-very-distinctive-private-key-value";
    for (const status of [
      pushKeyStatus({ publicKey: secret, privateKey: secret }),
      pushKeyStatus({ publicKey: secret }),
      pushKeyStatus({ privateKey: secret }),
    ]) {
      expect(pushReadiness(status)).not.toContain(secret);
    }
  });

  it("cannot 503 a working product", () => {
    /*
     * A product with no push keys serves customers perfectly well: every
     * notification still writes its in-app row, and the kinds worth paying for
     * fall back to SMS. `FALLBACK_FIRING_STATE`'s lesson — `unknown` and `down`
     * are the same verdict to `servesCustomers`, so a check about a real but
     * non-customer-facing fault must be `skipped`.
     */
    expect(PUSH_NOT_READY_STATE).toBe("skipped");
    expect(
      servesCustomers([{ state: PUSH_NOT_READY_STATE }]),
    ).toBe(true);
  });
});
