import { describe, expect, it } from "vitest";

import {
  BOOKING_LIMITS,
  CUSTOMER_LADDER,
  SMS_BUDGET,
  concurrentBookingCap,
  gateBooking,
  judgeBookingRisk,
  judgeCustomerLadder,
  judgeSmsSend,
  smsBudgetAlert,
  type BookingSignals,
} from "@/lib/abuse";

/**
 * Abuse resistance, on both sides.
 *
 * The two properties worth more than all the others here:
 *
 *   A genuine emergency at 2am from a brand-new account is NOT BLOCKED. That
 *   is the most suspicious pattern the system can see and it is exactly our
 *   customer — somebody whose pipe has burst who installed the app twenty
 *   minutes ago. Every rule below is written so that booking goes through.
 *
 *   Money is never charged on a guess. A deposit comes from recorded history
 *   and never from a risk score, because history is evidence and a score is a
 *   guess.
 */

/* ------------------------------------------------------------------ *
 * SMS toll fraud
 * ------------------------------------------------------------------ */

const QUIET = { globalLastHour: 10, globalToday: 50 };

describe("the SMS ceiling bounds what an attack can cost", () => {
  it("sends an ordinary Nepali mobile on a quiet day", () => {
    expect(judgeSmsSend({ e164: "+9779801234567", ...QUIET }).ok).toBe(true);
  });

  it("refuses anything that is not a Nepali mobile", () => {
    /*
     * The strongest of the three controls. International revenue share fraud
     * needs us to dial a number the attacker earns money on; we will not dial
     * one at all, so the entire surface is gone rather than rate-limited.
     */
    const international = judgeSmsSend({ e164: "+448001234567", ...QUIET });
    expect(international.ok).toBe(false);
    expect(!international.ok && international.reason).toBe("prefix");

    // A Kathmandu landline cannot receive SMS and is not billable either.
    const landline = judgeSmsSend({ e164: "+97714567890", ...QUIET });
    expect(!landline.ok && landline.reason).toBe("prefix");
  });

  it("stops at the platform's hourly ceiling, not one caller's", () => {
    // The distributed attack: a thousand IPs, one code each, every request
    // inside every per-number and per-IP limit we have.
    const verdict = judgeSmsSend({
      e164: "+9779801234567",
      globalLastHour: SMS_BUDGET.perHourGlobal,
      globalToday: 400,
    });
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toBe("hourCeiling");
  });

  it("stops at the daily ceiling even when the hour is quiet", () => {
    // A slow attack spread across the day, deliberately under the hourly bar.
    const verdict = judgeSmsSend({
      e164: "+9779801234567",
      globalLastHour: 5,
      globalToday: SMS_BUDGET.perDayGlobal,
    });
    expect(!verdict.ok && verdict.reason).toBe("dayCeiling");
  });

  it("checks the destination before either ceiling", () => {
    // A number we would never dial costs nothing, so it should never be the
    // thing that reports the platform as out of budget.
    const verdict = judgeSmsSend({
      e164: "+448001234567",
      globalLastHour: 99_999,
      globalToday: 99_999,
    });
    expect(!verdict.ok && verdict.reason).toBe("prefix");
  });

  it("warns before the bill rather than after it", () => {
    expect(smsBudgetAlert(QUIET)).toBeNull();

    const halfway = smsBudgetAlert({
      globalLastHour: 10,
      globalToday: SMS_BUDGET.perDayGlobal * SMS_BUDGET.alertAtDayFraction,
    });
    expect(halfway?.level).toBe("warn");
    expect(halfway?.window).toBe("day");
    // Rupees, so the alert says what it costs rather than only how many.
    expect(halfway?.estimatedRupees).toBeGreaterThan(0);
  });

  it("raises a ceiling alert louder than a warning", () => {
    const alert = smsBudgetAlert({
      globalLastHour: 10,
      globalToday: SMS_BUDGET.perDayGlobal,
    });
    expect(alert?.level).toBe("ceiling");
  });

  it("keeps the daily ceiling to a bill nobody has to escalate", () => {
    // Two thousand messages at about Rs 2 is roughly Rs 4,000 — the most a
    // sustained attack can cost before it is stopped dead.
    const worst = SMS_BUDGET.perDayGlobal * SMS_BUDGET.rupeesPerMessage;
    expect(worst).toBeLessThanOrEqual(5000);
  });
});

/* ------------------------------------------------------------------ *
 * The customer ladder
 * ------------------------------------------------------------------ */

describe("no-shows escalate to a deposit, never straight to a ban", () => {
  const clean = { noShows: 0, falseAddresses: 0, completedJobs: 0 };

  it("says nothing on the first one", () => {
    const verdict = judgeCustomerLadder({ ...clean, noShows: 1 });
    expect(verdict.step).toBe("recorded");
    expect(verdict.depositRupees).toBe(0);
  });

  it("tells them on the second, with what happens next", () => {
    const verdict = judgeCustomerLadder({ ...clean, noShows: 2 });
    expect(verdict.step).toBe("warned");
    expect(verdict.detail).toMatch(/deposit/i);
    expect(verdict.depositRupees).toBe(0);
  });

  it("asks for a deposit on the third, and applies it to the bill", () => {
    const verdict = judgeCustomerLadder({ ...clean, noShows: 3 });
    expect(verdict.step).toBe("deposit");
    expect(verdict.depositRupees).toBe(CUSTOMER_LADDER.depositRupees);
    // Not a fine. A fine would need an adjudication we have no instrument for.
    expect(verdict.detail).toMatch(/not kept|towards the bill/i);
  });

  it("counts a false address double, because it is deliberate", () => {
    // Not turning up is careless. Sending somebody to an address that was
    // never yours is the actual shape of the competitor attack.
    expect(
      judgeCustomerLadder({ ...clean, falseAddresses: 1 }).effectiveStrikes,
    ).toBe(2);
    expect(judgeCustomerLadder({ ...clean, falseAddresses: 2 }).step).toBe(
      "deposit",
    );
  });

  it("lets completed jobs retire strikes, so the ladder is not a ratchet", () => {
    /*
     * Without this a customer of three years with one bad week sits on the
     * top rung for ever, which is unjust and bad business.
     */
    const chaotic = { noShows: 3, falseAddresses: 0, completedJobs: 0 };
    expect(judgeCustomerLadder(chaotic).step).toBe("deposit");

    const recovered = { ...chaotic, completedJobs: 6 };
    expect(judgeCustomerLadder(recovered).step).toBe("clear");
  });

  it("makes recovering slower than falling", () => {
    const history = { noShows: 3, falseAddresses: 0, completedJobs: 2 };
    // Two clean jobs retire one strike, not three.
    expect(judgeCustomerLadder(history).effectiveStrikes).toBe(2);
  });

  it("escalates to a person only after a deposit has already failed to work", () => {
    const verdict = judgeCustomerLadder({
      ...clean,
      noShows: CUSTOMER_LADDER.depositAt + 2,
    });
    expect(verdict.step).toBe("review");
  });

  it("leaves a customer with no history entirely alone", () => {
    expect(judgeCustomerLadder(clean).step).toBe("clear");
    expect(judgeCustomerLadder(clean).detail).toBe("");
  });
});

/* ------------------------------------------------------------------ *
 * The concurrent cap — the only rule that blocks
 * ------------------------------------------------------------------ */

describe("the concurrent cap holds", () => {
  const fresh = { noShows: 0, falseAddresses: 0, completedJobs: 0 };

  it("caps an account with no completed jobs", () => {
    expect(concurrentBookingCap(fresh)).toBe(
      BOOKING_LIMITS.unverifiedConcurrent,
    );
  });

  it("lifts the cap once they have completed a job with us", () => {
    expect(concurrentBookingCap({ ...fresh, completedJobs: 1 })).toBeNull();
  });

  it("refuses the booking that would cross it", () => {
    const gate = gateBooking({
      history: fresh,
      signals: {
        accountAgeHours: 1,
        concurrentBookings: BOOKING_LIMITS.unverifiedConcurrent,
        bookedAtHour: 14,
        addressFailures: 0,
        isEmergency: false,
      },
    });
    expect(gate.allowed).toBe(false);
    expect(!gate.allowed && gate.reason).toBe("concurrentCap");
  });

  it("does not cap an established customer booking several jobs", () => {
    const gate = gateBooking({
      history: { noShows: 0, falseAddresses: 0, completedJobs: 20 },
      signals: {
        accountAgeHours: 8000,
        concurrentBookings: 5,
        bookedAtHour: 14,
        addressFailures: 0,
        isEmergency: false,
      },
    });
    expect(gate.allowed).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * The 2am emergency — the case everything is written around
 * ------------------------------------------------------------------ */

const EMERGENCY_AT_2AM: BookingSignals = {
  accountAgeHours: 0.3,
  concurrentBookings: 0,
  bookedAtHour: 2,
  addressFailures: 0,
  isEmergency: true,
};

describe("a genuine emergency from a brand-new account is not blocked", () => {
  it("lets the booking through", () => {
    /*
     * Somebody whose pipe has burst at two in the morning, who installed the
     * app twenty minutes ago because they had to. A system that blocks this
     * has misunderstood the business it is in.
     */
    const gate = gateBooking({
      history: { noShows: 0, falseAddresses: 0, completedJobs: 0 },
      signals: EMERGENCY_AT_2AM,
    });
    expect(gate.allowed).toBe(true);
    expect(gate.allowed && gate.depositRupees).toBe(0);
  });

  it("does not charge the unsocial-hour signal against an emergency", () => {
    const emergency = judgeBookingRisk(EMERGENCY_AT_2AM);
    const routine = judgeBookingRisk({
      ...EMERGENCY_AT_2AM,
      isEmergency: false,
    });
    // A routine repaint booked at 3am is a different thing, and it is the
    // only case the hour is scored on.
    expect(routine.score).toBeGreaterThan(emergency.score);
    expect(emergency.evidence.join(" ")).not.toMatch(/night/i);
  });

  it("shows them a challenge but never a refusal", () => {
    // Turnstile for a new account is a second of friction. A block is the end
    // of the relationship.
    const verdict = judgeBookingRisk(EMERGENCY_AT_2AM);
    expect(verdict.requiresChallenge).toBe(true);
    expect(verdict.score).toBeLessThan(100);
  });

  it("never shows a returning customer a challenge", () => {
    const verdict = judgeBookingRisk({
      ...EMERGENCY_AT_2AM,
      accountAgeHours: 5000,
    });
    expect(verdict.requiresChallenge).toBe(false);
  });
});

describe("the risk score surfaces and does not decide", () => {
  it("treats an address that has already failed as the strongest signal", () => {
    const verdict = judgeBookingRisk({
      accountAgeHours: 5000,
      concurrentBookings: 0,
      bookedAtHour: 14,
      addressFailures: 2,
      isEmergency: false,
    });
    expect(verdict.score).toBeGreaterThan(judgeBookingRisk(EMERGENCY_AT_2AM).score);
    expect(verdict.evidence.join(" ")).toMatch(/failed to find/i);
  });

  it("still allows a booking that scores at the top of the scale", () => {
    // The score has no power to refuse. Only the concurrent cap does.
    const history = { noShows: 0, falseAddresses: 0, completedJobs: 5 };
    const gate = gateBooking({
      history,
      signals: {
        accountAgeHours: 0.1,
        concurrentBookings: 4,
        bookedAtHour: 3,
        addressFailures: 3,
        isEmergency: false,
      },
    });
    expect(gate.allowed).toBe(true);
  });

  it("charges a deposit from history and never from the score", () => {
    /*
     * The line that matters most in this file. History is evidence; a score
     * is a guess, and charging money on a guess drives away the customer who
     * needed you most.
     */
    const scoresHigh = {
      accountAgeHours: 0.1,
      concurrentBookings: 1,
      bookedAtHour: 3,
      addressFailures: 3,
      isEmergency: false,
    };
    const cleanHistory = { noShows: 0, falseAddresses: 0, completedJobs: 3 };
    expect(judgeBookingRisk(scoresHigh).score).toBeGreaterThan(50);
    const scoredHigh = gateBooking({
      history: cleanHistory,
      signals: scoresHigh,
    });
    expect(scoredHigh.allowed).toBe(true);
    expect(scoredHigh.allowed && scoredHigh.depositRupees).toBe(0);

    const badHistory = { noShows: 4, falseAddresses: 0, completedJobs: 0 };
    const calm = {
      accountAgeHours: 5000,
      concurrentBookings: 0,
      bookedAtHour: 14,
      addressFailures: 0,
      isEmergency: false,
    };
    expect(judgeBookingRisk(calm).score).toBe(0);
    const badRecord = gateBooking({ history: badHistory, signals: calm });
    expect(badRecord.allowed).toBe(true);
    expect(badRecord.allowed && badRecord.depositRupees).toBe(
      CUSTOMER_LADDER.depositRupees,
    );
  });

  it("gives a reason for every point it charges", () => {
    const verdict = judgeBookingRisk({
      accountAgeHours: 1,
      concurrentBookings: 3,
      bookedAtHour: 3,
      addressFailures: 1,
      isEmergency: false,
    });
    expect(verdict.evidence.length).toBeGreaterThanOrEqual(4);
  });
});
