/**
 * Paying a professional for a trip that earned them nothing.
 *
 * THE PROBLEM THIS FIXES IS OURS, NOT THEIRS. Today a professional who rides
 * across Kathmandu to an address that does not exist earns zero. They carry
 * the entire cost of a fraud problem they had no part in, and they are the
 * scarcest thing this platform has. Two of those and a good provider stops
 * taking our jobs — which is not a complaint we would ever receive, because
 * people do not write in to explain why they left.
 *
 * SO WE PAY, FROM OUR OWN MONEY, AND RECOVER WHERE WE CAN. In that order. The
 * professional is made whole the moment the claim is upheld, and whether the
 * customer ever pays it back is our problem rather than theirs. A trip payment
 * conditional on recovery would be no payment at all — it would just move the
 * uncertainty onto the person who can least absorb it.
 *
 * RECOVERY IS FORWARD-NETTED, exactly like the guarantee redo: it comes off a
 * LATER booking, capped, never chased as cash, and written off if they never
 * come back. We have no card on file and no instrument to collect with, and a
 * debt we cannot collect is a threat rather than a term.
 *
 * THE FIRST ONE IS ON US. Genuinely — nobody's first missed appointment is
 * fraud, it is a phone that died or a memory that slipped, and charging for it
 * would make the platform feel like a trap. Recovery starts only where the
 * ladder already says a pattern exists.
 */

/**
 * What a wasted trip is worth, and the arithmetic behind the number.
 *
 * A round trip across a couple of Kathmandu wards on a motorbike is roughly
 * 10km of petrol — call it Rs 70 — plus the better part of an hour of a
 * tradesperson's time once you count the traffic. Against published bands
 * starting around Rs 900 for a plumbing job, an hour is worth on the order of
 * Rs 300. Rs 350 covers the petrol and most of the hour.
 *
 * IT IS DELIBERATELY NOT A FULL HOUR'S EARNINGS. Making a wasted trip as
 * valuable as a real job would create a reason to prefer them, and that is a
 * far worse failure than under-paying slightly: it would put the incentive on
 * the one person in this transaction we need to trust completely.
 *
 * CALIBRATE THIS AGAINST REAL TRIPS. It is one constant so that is one edit.
 */
export const TRIP_COMPENSATION = {
  rupees: 350,
  /**
   * A customer's first upheld no-show costs them nothing and costs us Rs 350.
   * Recovery begins only at the ladder's deposit step, where a pattern exists.
   */
  firstIsOnUs: true,
  /**
   * The most of one later bill that may go to clearing a trip debt.
   *
   * A quarter, the same share as the redo recovery, and for the same reason: a
   * bill that suddenly doubles is how somebody decides never to use the
   * platform again, which loses the rest of the debt along with the customer.
   */
  recoveryCapBps: 2500,
} as const;

/* ------------------------------------------------------------------ *
 * The evidence
 * ------------------------------------------------------------------ */

/**
 * What the professional recorded when they got there.
 *
 * WITHOUT THIS A CLAIM IS ONE PERSON'S WORD and we cannot act on either side —
 * we can neither pay the professional nor put a mark against the customer, so
 * the honest outcome would be to do nothing, which is the status quo that
 * loses providers.
 *
 * `coarseLocation` is rounded to about a kilometre on purpose. It answers "was
 * this person plausibly in the right part of the city" and deliberately cannot
 * answer "where exactly was this person at 9:14". We are asking a professional
 * to be tracked to support a claim; asking for more than the claim needs would
 * be taking something we have no use for.
 */
export type ArrivalEvidence = {
  arrivedAt: string | null;
  /** Minutes between arriving and giving up. */
  waitedMinutes: number;
  /** Calls or messages to the customer from the app. */
  contactAttempts: number;
  /** Rounded to ~1km. Null when the phone would not give it. */
  coarseLocation: { lat: number; lng: number } | null;
};

/** How long somebody has to wait before it counts as nobody being there. */
export const MIN_WAIT_MINUTES = 10;

export type NoShowVerdict =
  | { outcome: "upheld"; rupees: number; reason: "evidenceComplete" }
  | { outcome: "needsPerson"; reason: NoShowReview }
  | { outcome: "incomplete"; missing: string[] };

export type NoShowReview =
  | "customerConfirmed"
  | "addressProven"
  | "noLocation"
  | "customerDisputed";

/**
 * Judge one no-show claim.
 *
 * IT NEVER AUTO-REFUSES. The two outcomes are "pay it" and "a person looks" —
 * there is no branch that quietly tells a professional they were not really
 * there. `incomplete` is not a refusal either: it is the claim not having been
 * filled in yet, and it names what is missing so the professional can finish
 * it rather than being told no.
 *
 * Auto-upheld only when the evidence is complete AND the customer never
 * confirmed AND the address was unproven — the case where nothing at all
 * suggests a real door. Everything else goes to a person, because the cost of
 * wrongly marking a real customer is a customer, and this is cheap to review
 * at the volumes involved.
 */
export function judgeNoShowClaim(input: {
  evidence: ArrivalEvidence;
  /** Did the customer actively confirm they would be there? */
  customerConfirmed: boolean;
  /** Had a job ever been completed at this address? */
  addressProven: boolean;
  /** Has the customer said it did not happen? */
  customerDisputed: boolean;
}): NoShowVerdict {
  const missing: string[] = [];
  if (!input.evidence.arrivedAt) missing.push("arrival");
  if (input.evidence.waitedMinutes < MIN_WAIT_MINUTES) missing.push("wait");
  if (input.evidence.contactAttempts < 1) missing.push("contact");
  if (missing.length > 0) return { outcome: "incomplete", missing };

  if (input.customerDisputed) {
    return { outcome: "needsPerson", reason: "customerDisputed" };
  }
  if (input.customerConfirmed) {
    // They said they would be there. That is a contradiction worth a human.
    return { outcome: "needsPerson", reason: "customerConfirmed" };
  }
  if (input.addressProven) {
    return { outcome: "needsPerson", reason: "addressProven" };
  }
  if (!input.evidence.coarseLocation) {
    return { outcome: "needsPerson", reason: "noLocation" };
  }

  return {
    outcome: "upheld",
    rupees: TRIP_COMPENSATION.rupees,
    reason: "evidenceComplete",
  };
}

/* ------------------------------------------------------------------ *
 * Recovery
 * ------------------------------------------------------------------ */

/**
 * Does this upheld no-show create a debt, or do we simply absorb it?
 *
 * `effectiveStrikes` comes from `judgeCustomerLadder`, so the first genuine
 * mistake is free and recovery begins only where the ladder already says a
 * pattern exists. The professional is paid either way — this decides only who
 * ends up carrying it.
 */
export function tripDebtFor(input: {
  effectiveStrikesBefore: number;
  depositStep: number;
}): number {
  if (TRIP_COMPENSATION.firstIsOnUs && input.effectiveStrikesBefore === 0) {
    return 0;
  }
  return input.effectiveStrikesBefore + 1 >= input.depositStep
    ? TRIP_COMPENSATION.rupees
    : 0;
}

/**
 * How much of a trip debt comes off this bill.
 *
 * Same shape and same reasoning as `applyRedoRecovery` on the provider side:
 * capped, never negative, and the remainder carried rather than chased. If
 * they never book again it is written off, and that write-off is the true cost
 * of protecting the professional — which is the right thing for it to be.
 */
export function applyTripRecovery(input: {
  billRupees: number;
  outstanding: number;
}): { charged: number; recovered: number; remaining: number } {
  if (input.billRupees <= 0 || input.outstanding <= 0) {
    return {
      charged: Math.max(0, input.billRupees),
      recovered: 0,
      remaining: Math.max(0, input.outstanding),
    };
  }

  const ceiling = Math.floor(
    (input.billRupees * TRIP_COMPENSATION.recoveryCapBps) / 10_000,
  );
  const recovered = Math.min(input.outstanding, ceiling);

  return {
    // Added to the bill: this is money owed for a trip that happened, and it
    // is the one thing on this platform a customer can be charged for beyond
    // the work itself. It is why the terms say so in plain words.
    charged: input.billRupees + recovered,
    recovered,
    remaining: input.outstanding - recovered,
  };
}
