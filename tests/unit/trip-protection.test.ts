import { describe, expect, it } from "vitest";

import {
  CUSTOMER_LADDER,
  MIN_WAIT_MINUTES,
  TRIP_COMPENSATION,
  addressTrust,
  applyTripRecovery,
  confirmationPlan,
  gateBooking,
  judgeCustomerLadder,
  judgeNoShowClaim,
  requiresConfirmation,
  tripDebtFor,
  type ArrivalEvidence,
} from "@/lib/abuse";

/**
 * Protecting the trip rather than the booking.
 *
 * THE CASE THAT OUTRANKS EVERY OTHER TEST IN THIS FILE comes first, and it is
 * the hard constraint: a genuine emergency at two in the morning, from an
 * account created twenty minutes ago, at an address nobody has ever been to,
 * MUST GET THROUGH. That is simultaneously the riskiest booking the system can
 * see and the single customer this platform most exists for — somebody with
 * water coming through the ceiling who installed the app because they had to.
 *
 * Over-tightening here costs more than the fraud does, and it costs it
 * silently: the fraud shows up as a wasted trip somebody complains about, and
 * the over-tightening shows up as nothing at all.
 */

const NOWHERE: ArrivalEvidence = {
  arrivedAt: null,
  waitedMinutes: 0,
  contactAttempts: 0,
  coarseLocation: null,
};

const FULL_EVIDENCE: ArrivalEvidence = {
  arrivedAt: "2026-09-10T09:00:00Z",
  waitedMinutes: 15,
  contactAttempts: 2,
  coarseLocation: { lat: 27.68, lng: 85.31 },
};

/* ------------------------------------------------------------------ *
 * The 2am emergency
 * ------------------------------------------------------------------ */

describe("a first-time emergency at 2am is escalated, never blocked", () => {
  const firstTimer = {
    completedJobs: 0,
    upheldNoShows: 0,
    confirmedForThisBooking: false,
  };

  it("still lets the booking be created", () => {
    const gate = gateBooking({
      history: { noShows: 0, falseAddresses: 0, completedJobs: 0 },
      signals: {
        accountAgeHours: 0.3,
        concurrentBookings: 0,
        bookedAtHour: 2,
        addressFailures: 0,
        isEmergency: true,
      },
    });
    expect(gate.allowed).toBe(true);
    expect(gate.allowed && gate.depositRupees).toBe(0);
  });

  it("asks them to confirm rather than refusing them", () => {
    const plan = confirmationPlan({ trust: "unproven", isEmergency: true });
    expect(plan.required).toBe(true);
    // The answer to an unproven address is never "no". It is "answer this".
    expect(plan.channels).toContain("tap");
  });

  it("gives an emergency MORE ways to answer, not fewer", () => {
    const emergency = confirmationPlan({ trust: "unproven", isEmergency: true });
    const routine = confirmationPlan({ trust: "unproven", isEmergency: false });
    expect(emergency.channels.length).toBeGreaterThan(routine.channels.length);
    expect(emergency.channels).toContain("call");
    expect(emergency.callImmediately).toBe(true);
  });

  it("holds an emergency longer before giving up, not shorter", () => {
    /*
     * The instinct is to time an emergency out fast so the professional is
     * freed. That is backwards: somebody with water coming through the ceiling
     * may be moving furniture rather than watching a phone, and abandoning
     * them after ten minutes is the platform failing at the moment it matters.
     */
    const emergency = confirmationPlan({ trust: "unproven", isEmergency: true });
    const routine = confirmationPlan({ trust: "unproven", isEmergency: false });
    expect(emergency.holdMinutes).toBeGreaterThan(routine.holdMinutes);
  });

  it("dispatches the moment they tap, with nothing else in the way", () => {
    // One tap on a screen they are already holding. Confirmation costs a real
    // person a second; it costs a script that fired and walked away everything.
    const trust = addressTrust({ ...firstTimer, confirmedForThisBooking: true });
    expect(trust).toBe("confirmed");
    expect(requiresConfirmation(trust)).toBe(false);
  });

  it("never charges them a deposit for being new", () => {
    // A deposit comes from recorded history. A first-time customer has none.
    expect(
      judgeCustomerLadder({ noShows: 0, falseAddresses: 0, completedJobs: 0 })
        .depositRupees,
    ).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Address trust
 * ------------------------------------------------------------------ */

describe("trust belongs to the address, not the account", () => {
  it("proves an address by somebody having been there", () => {
    // The only honest way an address earns trust. Everything else is a promise.
    expect(
      addressTrust({
        completedJobs: 1,
        upheldNoShows: 0,
        confirmedForThisBooking: false,
      }),
    ).toBe("proven");
  });

  it("treats a brand-new address as where the risk sits", () => {
    expect(
      addressTrust({
        completedJobs: 0,
        upheldNoShows: 0,
        confirmedForThisBooking: false,
      }),
    ).toBe("unproven");
  });

  it("does not ask a regular customer to confirm their own front door", () => {
    /*
     * Asking every time teaches people to tap through prompts without reading
     * them, which loses the prompt's value everywhere else in the product.
     */
    expect(requiresConfirmation("proven")).toBe(false);
    expect(confirmationPlan({ trust: "proven", isEmergency: false }).required).toBe(
      false,
    );
  });

  it("takes proven away from an address that swallowed a trip", () => {
    // Otherwise a fake address is laundered by having one real job done there
    // first, which is exactly how somebody would do it.
    expect(
      addressTrust({
        completedJobs: 3,
        upheldNoShows: 1,
        confirmedForThisBooking: false,
      }),
    ).toBe("unproven");
  });

  it("lets that address be used again once somebody answers for it", () => {
    // Punishing the address for ever would punish whoever moves in next.
    expect(
      addressTrust({
        completedJobs: 3,
        upheldNoShows: 1,
        confirmedForThisBooking: true,
      }),
    ).toBe("confirmed");
  });
});

/* ------------------------------------------------------------------ *
 * Arrival evidence
 * ------------------------------------------------------------------ */

describe("a claim without evidence is one person's word", () => {
  const clean = {
    customerConfirmed: false,
    addressProven: false,
    customerDisputed: false,
  };

  it("names what is missing rather than refusing", () => {
    // Not a refusal — the claim has not been filled in yet, and the
    // professional can finish it.
    const verdict = judgeNoShowClaim({ ...clean, evidence: NOWHERE });
    expect(verdict.outcome).toBe("incomplete");
    expect(verdict.outcome === "incomplete" && verdict.missing).toEqual([
      "arrival",
      "wait",
      "contact",
    ]);
  });

  it("requires a real wait before nobody being there counts", () => {
    const verdict = judgeNoShowClaim({
      ...clean,
      evidence: { ...FULL_EVIDENCE, waitedMinutes: MIN_WAIT_MINUTES - 1 },
    });
    expect(verdict.outcome === "incomplete" && verdict.missing).toContain("wait");
  });

  it("requires having actually tried to reach them", () => {
    const verdict = judgeNoShowClaim({
      ...clean,
      evidence: { ...FULL_EVIDENCE, contactAttempts: 0 },
    });
    expect(verdict.outcome === "incomplete" && verdict.missing).toContain(
      "contact",
    );
  });

  it("upholds a complete claim against an unproven address", () => {
    const verdict = judgeNoShowClaim({ ...clean, evidence: FULL_EVIDENCE });
    expect(verdict.outcome).toBe("upheld");
    expect(verdict.outcome === "upheld" && verdict.rupees).toBe(
      TRIP_COMPENSATION.rupees,
    );
  });

  it("sends it to a person when the customer said they would be there", () => {
    // A contradiction, and contradictions are what humans are for.
    const verdict = judgeNoShowClaim({
      ...clean,
      evidence: FULL_EVIDENCE,
      customerConfirmed: true,
    });
    expect(verdict.outcome).toBe("needsPerson");
  });

  it("sends it to a person when the address has worked before", () => {
    const verdict = judgeNoShowClaim({
      ...clean,
      evidence: FULL_EVIDENCE,
      addressProven: true,
    });
    expect(verdict.outcome === "needsPerson" && verdict.reason).toBe(
      "addressProven",
    );
  });

  it("sends it to a person when the customer disputes it", () => {
    const verdict = judgeNoShowClaim({
      ...clean,
      evidence: FULL_EVIDENCE,
      customerDisputed: true,
    });
    expect(verdict.outcome === "needsPerson" && verdict.reason).toBe(
      "customerDisputed",
    );
  });

  it("never refuses a professional outright", () => {
    // There is no branch that quietly tells somebody they were not there.
    const cases = [
      { ...clean, evidence: FULL_EVIDENCE },
      { ...clean, evidence: FULL_EVIDENCE, customerConfirmed: true },
      { ...clean, evidence: FULL_EVIDENCE, addressProven: true },
      { ...clean, evidence: FULL_EVIDENCE, customerDisputed: true },
      {
        ...clean,
        evidence: { ...FULL_EVIDENCE, coarseLocation: null },
      },
    ];
    for (const input of cases) {
      const verdict = judgeNoShowClaim(input);
      expect(["upheld", "needsPerson"]).toContain(verdict.outcome);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Who ends up carrying it
 * ------------------------------------------------------------------ */

describe("the professional is paid; recovery is our problem", () => {
  it("costs the customer nothing on their first missed appointment", () => {
    /*
     * Nobody's first is fraud — it is a phone that died or a memory that
     * slipped. Charging for it would make the platform feel like a trap.
     */
    expect(
      tripDebtFor({
        effectiveStrikesBefore: 0,
        depositStep: CUSTOMER_LADDER.depositAt,
      }),
    ).toBe(0);
  });

  it("creates a debt only where the ladder already says a pattern exists", () => {
    expect(
      tripDebtFor({
        effectiveStrikesBefore: CUSTOMER_LADDER.depositAt - 1,
        depositStep: CUSTOMER_LADDER.depositAt,
      }),
    ).toBe(TRIP_COMPENSATION.rupees);
  });

  it("takes at most a quarter of a later bill", () => {
    const result = applyTripRecovery({ billRupees: 2000, outstanding: 700 });
    expect(result.recovered).toBe(500);
    expect(result.charged).toBe(2500);
    expect(result.remaining).toBe(200);
  });

  it("never takes more than is owed", () => {
    const result = applyTripRecovery({ billRupees: 4000, outstanding: 350 });
    expect(result.recovered).toBe(350);
    expect(result.remaining).toBe(0);
  });

  it("carries the remainder rather than chasing it", () => {
    let outstanding: number = TRIP_COMPENSATION.rupees;
    let bills = 0;
    while (outstanding > 0 && bills < 20) {
      outstanding = applyTripRecovery({ billRupees: 800, outstanding }).remaining;
      bills += 1;
    }
    expect(outstanding).toBe(0);
    expect(bills).toBeGreaterThan(1);
  });

  it("writes it off rather than charging somebody who never comes back", () => {
    // No bill, nothing recovered, and no mechanism that reaches for cash.
    const result = applyTripRecovery({ billRupees: 0, outstanding: 350 });
    expect(result.recovered).toBe(0);
    expect(result.charged).toBe(0);
    expect(result.remaining).toBe(350);
  });

  it("keeps a wasted trip worth less than a real job", () => {
    /*
     * Making a wasted trip as valuable as real work would create a reason to
     * prefer them — putting the incentive on the one person in this
     * transaction we need to trust completely. Plumbing's published band
     * starts at Rs 900.
     */
    expect(TRIP_COMPENSATION.rupees).toBeLessThan(900);
  });
});
