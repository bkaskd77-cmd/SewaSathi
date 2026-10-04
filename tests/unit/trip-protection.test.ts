import { describe, expect, it } from "vitest";

import {
  CUSTOMER_LADDER,
  MIN_WAIT_MINUTES,
  TRIP_COMPENSATION,
  addressTrust,
  applyTripRecovery,
  confirmationPlan,
  dispatchIsHeld,
  gateBooking,
  judgeCustomerLadder,
  judgeNoShowClaim,
  requiresConfirmation,
  tripDebtFor,
  type ArrivalEvidence,
  tripDebtNotice,
  tripDebtOnBill,
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

  /*
   * THIS CASE USED TO ASSERT AN AUTOMATIC PAYMENT, and the inversion is the point.
   * While `trip_rupees_paid` was a column nothing paid, auto-upholding a complete
   * claim cost a row. Now `trip_compensation` moves Rs 350 of our money, and the
   * evidence behind "complete" is a tap, two numbers the professional types and a
   * location from their own phone — so the same branch would be a standing offer
   * to anybody willing to tap "arrived" at the end of the road.
   */
  it("sends even a complete, uncontradicted claim to a person", () => {
    const verdict = judgeNoShowClaim({ ...clean, evidence: FULL_EVIDENCE });
    expect(verdict.outcome).toBe("needsPerson");
    expect(verdict.outcome === "needsPerson" && verdict.reason).toBe(
      "evidenceComplete",
    );
  });

  /*
   * The stronger statement, and the one that cannot be satisfied by renaming an
   * outcome: no input of any shape produces a verdict that pays by itself. If an
   * auto-pay branch is ever added back, this fails whatever it is called.
   */
  it("has no outcome at all that pays without a person", () => {
    const everything = [
      { ...clean, evidence: FULL_EVIDENCE },
      { ...clean, evidence: FULL_EVIDENCE, customerConfirmed: true },
      { ...clean, evidence: FULL_EVIDENCE, addressProven: true },
      { ...clean, evidence: FULL_EVIDENCE, customerDisputed: true },
      { ...clean, evidence: { ...FULL_EVIDENCE, coarseLocation: null } },
      { ...clean, evidence: { ...FULL_EVIDENCE, contactAttempts: 0 } },
    ];
    for (const input of everything) {
      const verdict = judgeNoShowClaim(input);
      expect(["needsPerson", "incomplete"]).toContain(verdict.outcome);
      expect(verdict).not.toHaveProperty("rupees");
    }
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
      expect(verdict.outcome).toBe("needsPerson");
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

/* ------------------------------------------------------------------ *
 * The dispatcher holds
 * ------------------------------------------------------------------ */

describe("dispatch waits for an answer rather than guessing", () => {
  it("holds a booking that owes us a confirmation", () => {
    expect(
      dispatchIsHeld({ confirmation_required: true, confirmed_at: null }),
    ).toBe(true);
  });

  it("releases it the moment they answer", () => {
    expect(
      dispatchIsHeld({
        confirmation_required: true,
        confirmed_at: "2026-09-10T02:04:00Z",
      }),
    ).toBe(false);
  });

  it("never holds a booking to a proven address", () => {
    /*
     * The regression that would hurt most: a gate that accidentally applies to
     * everybody turns every booking into a prompt, and a prompt on every
     * booking is a prompt nobody reads.
     */
    expect(
      dispatchIsHeld({ confirmation_required: false, confirmed_at: null }),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * What a past debt adds to this bill
 * ------------------------------------------------------------------ */

describe("recovering a trip debt from a later bill", () => {
  const BILL = 4000;

  it("adds at most a quarter of the bill, which is what the terms promise", () => {
    const result = tripDebtOnBill({
      billRupees: BILL,
      outstanding: 3000,
      disputedAt: null,
      alreadyAdded: null,
    });

    expect(result.outcome).toBe("add");
    expect(result.outcome === "add" && result.rupees).toBe(1000);
    expect(result.outcome === "add" && result.remaining).toBe(2000);
  });

  it("never adds more than is owed", () => {
    const result = tripDebtOnBill({
      billRupees: BILL,
      outstanding: 350,
      disputedAt: null,
      alreadyAdded: null,
    });
    expect(result.outcome === "add" && result.rupees).toBe(350);
    expect(result.outcome === "add" && result.remaining).toBe(0);
  });

  /*
   * THE CASE THE IDEMPOTENCY COLUMN EXISTS FOR. A professional correcting a typed
   * figure re-enters `recordFinalAmount`; without this the debt would be recovered
   * again, from a customer who has already been charged once.
   */
  it("recovers nothing a second time, whatever the arithmetic says", () => {
    const result = tripDebtOnBill({
      billRupees: BILL,
      outstanding: 3000,
      disputedAt: null,
      alreadyAdded: 1000,
    });
    expect(result.outcome).toBe("alreadyDone");
  });

  /*
   * AND ZERO IS A DECISION, NOT AN ABSENCE. A booking judged to owe nothing records
   * 0, and a re-record must read that as "done" rather than as "not considered" —
   * which is why null and 0 are different values rather than one falsy one.
   */
  it("treats a recorded zero as done, not as nobody having looked", () => {
    const result = tripDebtOnBill({
      billRupees: BILL,
      outstanding: 3000,
      disputedAt: null,
      alreadyAdded: 0,
    });
    expect(result.outcome).toBe("alreadyDone");
    expect(result.outcome === "alreadyDone" && result.rupees).toBe(0);
  });

  /*
   * A DISPUTE HOLDS THE WHOLE DEBT OFF THE BILL, not a smaller slice of it.
   * Recovering mid-complaint means the money is gone and the argument is about
   * getting it back.
   */
  it("adds nothing at all while the customer is disputing", () => {
    const result = tripDebtOnBill({
      billRupees: BILL,
      outstanding: 3000,
      disputedAt: "2026-10-04T06:00:00.000Z",
      alreadyAdded: null,
    });
    expect(result.outcome).toBe("disputed");
  });

  it("adds nothing when nothing is owed", () => {
    expect(
      tripDebtOnBill({
        billRupees: BILL,
        outstanding: 0,
        disputedAt: null,
        alreadyAdded: null,
      }).outcome,
    ).toBe("nothingOwed");
  });

  /*
   * A quarter of a tiny bill rounds to nothing. That is `nothingOwed`, so the caller
   * writes 0 and no customer ever sees a line item for zero rupees.
   */
  it("says nothing is owed rather than adding a line for nothing", () => {
    expect(
      tripDebtOnBill({
        billRupees: 3,
        outstanding: 3000,
        disputedAt: null,
        alreadyAdded: null,
      }).outcome,
    ).toBe("nothingOwed");
  });
});

/* ------------------------------------------------------------------ *
 * What the customer is told before they confirm
 * ------------------------------------------------------------------ */

describe("telling a customer about a carried trip charge", () => {
  /*
   * THE ONE THAT MATTERS: nothing is said to somebody who owes nothing. A panel
   * reading "you owe nothing" in front of every customer would be a charge introduced
   * to people who have never been near one.
   */
  it("says nothing at all when nothing is owed", () => {
    expect(tripDebtNotice({ outstanding: 0, disputedAt: null }).show).toBe(false);
    expect(tripDebtNotice({ outstanding: -50, disputedAt: null }).show).toBe(false);
  });

  it("states the whole balance, not a slice of it", () => {
    const notice = tripDebtNotice({ outstanding: 700, disputedAt: null });
    expect(notice.show).toBe(true);
    // 700 bounds the total across however many jobs it takes; a quarter of some
    // imagined bill would bound nothing and would read as this job's charge.
    if (notice.show) expect(notice.outstanding).toBe(700);
  });

  /*
   * THE SENTENCE AND THE ARITHMETIC ARE ONE RULE, and this is the case that goes red
   * if somebody writes the percentage into the copy by hand. It asserts the share the
   * screen prints against what `applyTripRecovery` actually takes off a bill — two
   * different code paths reading one constant, rather than a constant compared with
   * itself.
   */
  it("prints the share the recovery actually takes", () => {
    const notice = tripDebtNotice({ outstanding: 100_000, disputedAt: null });
    if (!notice.show) throw new Error("expected a notice");

    const bill = 4000;
    const { recovered } = applyTripRecovery({
      billRupees: bill,
      outstanding: 100_000,
    });
    expect(recovered).toBe((bill * notice.sharePercent) / 100);
  });

  /*
   * A DISPUTED CHARGE IS STILL SHOWN. Hiding it would leave somebody who objected
   * wondering whether we heard; the flag is what changes the sentence to "nothing is
   * being taken while somebody looks".
   */
  it("keeps showing a disputed charge, and says it is disputed", () => {
    const notice = tripDebtNotice({
      outstanding: 350,
      disputedAt: "2026-10-04T05:00:00.000Z",
    });
    expect(notice.show).toBe(true);
    if (notice.show) expect(notice.disputed).toBe(true);
  });
});
