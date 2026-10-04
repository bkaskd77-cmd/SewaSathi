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
  /**
   * The most no-show claims one professional may be paid for in a period.
   *
   * **NULL, AND UNARMED ON PURPOSE** — the `arrearsPauseRupees` shape. Null means
   * no cap: every claim a person upholds is paid, however many that professional
   * has made. It is a constant rather than a missing feature so that the day a
   * number is wanted, it is one edit with a paragraph beside it instead of a new
   * mechanism argued from scratch under pressure.
   *
   * WHY IT IS NOT A NUMBER TODAY. Nobody has the runs to choose one. There are
   * two claims in the product's whole history, so any figure would be a guess
   * frozen into the codebase as a standard — and the cost of guessing low is a
   * professional who genuinely had a bad month going unpaid for real trips, which
   * is the exact harm the trip payment exists to prevent. The claim rate is on
   * `/admin/claims` instead: a person reads it and decides, which is what we have
   * while the numbers are this small.
   *
   * A cap would also be the first rule here that refuses a professional money
   * automatically, so it needs the enforcement ladder's treatment — published,
   * with what triggers it and how it lifts — before it is switched on.
   */
  maxPaidClaimsPerPeriod: null as number | null,
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

/**
 * THERE IS NO `upheld` OUTCOME ANY MORE, and removing it is the point.
 *
 * Until the trip was actually funded, an auto-uphold cost nothing but a row: the
 * claim said `trip_rupees_paid` and no money moved. Now that `trip_compensation`
 * is a real ledger entry, the same branch pays Rs 350 out of our own money with
 * **nobody having looked**, on evidence that is almost entirely self-reported —
 * a tap, two numbers the professional types, and a location from their own phone.
 * That is a standing offer to anybody willing to tap "arrived" at the end of the
 * road.
 *
 * So every complete claim is a person's decision. The outcomes are now "a person
 * looks" and "this is not filled in yet", and `incomplete` is still not a refusal:
 * it names what is missing so the professional can finish it.
 */
export type NoShowVerdict =
  | { outcome: "needsPerson"; reason: NoShowReview }
  | { outcome: "incomplete"; missing: string[] };

export type NoShowReview =
  /**
   * Nothing contradicts the claim — and it is still a person's call.
   *
   * This used to be the auto-pay branch. It is kept as a distinct reason rather
   * than folded into the others because it tells the reviewer something true and
   * useful: there is no contradiction to resolve here, only a judgement about
   * whether the evidence is enough to pay on.
   */
  | "evidenceComplete"
  | "customerConfirmed"
  | "addressProven"
  | "noLocation"
  | "customerDisputed";

/**
 * Judge one no-show claim.
 *
 * IT NEVER AUTO-REFUSES AND IT NO LONGER AUTO-PAYS. Every complete claim goes to
 * a person; `incomplete` is not a refusal but the claim not being filled in yet,
 * and it names what is missing so the professional can finish it rather than
 * being told no. There is still no branch that quietly tells a professional they
 * were not really there.
 *
 * WHAT THE REASON IS FOR. It no longer decides anything — it tells the reviewer
 * which question they are being asked. `customerConfirmed` is a contradiction to
 * resolve, `addressProven` means a job has been done at this door before,
 * `noLocation` means the phone gave nothing, and `evidenceComplete` means nothing
 * contradicts the claim and the judgement is simply whether this is enough to pay
 * on. That last one used to pay automatically.
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

  return { outcome: "needsPerson", reason: "evidenceComplete" };
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

/**
 * What a past trip debt adds to THIS bill, and whether it may be added at all.
 *
 * WHY THIS IS A SEPARATE FUNCTION FROM `applyTripRecovery`. That one does the
 * arithmetic — a quarter of the bill, capped at what is owed. This one answers the
 * question that comes first and is easy to forget: *should anything be recovered
 * right now*. Three things can stop it, and only one of them is about the money.
 *
 * A DISPUTE HOLDS THE WHOLE DEBT OFF THE BILL. Not a smaller slice, not a pause on a
 * counter: nothing. Recovering while somebody is saying "that is not mine" is how a
 * complaint becomes a grievance — the money is already gone and the argument is now
 * about getting it back. Nothing is lost by waiting, because the debt stays on
 * `customer_risk` and the next booking recovers it if an admin upholds the claim.
 *
 * ALREADY CONSIDERED MEANS ALREADY CONSIDERED. `trip_debt_added_rupees` is null
 * until this booking has been judged and a number — including 0 — after. The caller
 * passes that through, so a re-recorded final amount recovers nothing: not because
 * the arithmetic comes out the same, but because this returns `alreadyDone`.
 */
export type TripDebtOnBill =
  /** Add this much. Zero is never returned here — `nothingOwed` says that. */
  | { outcome: "add"; rupees: number; remaining: number }
  | { outcome: "nothingOwed" }
  | { outcome: "disputed" }
  | { outcome: "alreadyDone"; rupees: number };

export function tripDebtOnBill(input: {
  billRupees: number;
  /** What the customer still owes for past trips. */
  outstanding: number;
  /** Set while the customer is disputing the debt. */
  disputedAt: string | null;
  /** `bookings.trip_debt_added_rupees` — null until this booking was judged. */
  alreadyAdded: number | null;
}): TripDebtOnBill {
  if (input.alreadyAdded !== null) {
    return { outcome: "alreadyDone", rupees: input.alreadyAdded };
  }
  if (input.disputedAt !== null) return { outcome: "disputed" };
  if (input.outstanding <= 0 || input.billRupees <= 0) {
    return { outcome: "nothingOwed" };
  }

  const applied = applyTripRecovery({
    billRupees: input.billRupees,
    outstanding: input.outstanding,
  });

  /*
   * A quarter of a very small bill rounds to nothing. That is `nothingOwed` rather
   * than an `add` of 0, so the caller writes 0 — considered, nothing added — and
   * never shows a customer a line item for zero rupees.
   */
  if (applied.recovered <= 0) return { outcome: "nothingOwed" };

  return {
    outcome: "add",
    rupees: applied.recovered,
    remaining: applied.remaining,
  };
}

/**
 * What to tell a customer about a carried trip debt BEFORE they confirm a booking.
 *
 * WHY THIS EXISTS AT ALL. The recovery happens at settlement, which is the right
 * moment to take it — it comes off work they chose to book rather than being demanded
 * from them cold. But a charge that first appears on the final bill is a charge added
 * unseen, and the one thing on this platform a customer can be billed for beyond the
 * work itself must not arrive as a surprise. So the review screen says it before the
 * confirm button, and this is the rule it reads.
 *
 * IT STATES THE BALANCE AND THE RULE, AND DELIBERATELY NOT A FIGURE FOR THIS JOB.
 * The obvious version — a quarter of the quoted maximum — looks more helpful and is
 * not a ceiling: the final amount is agreed on site and may legitimately exceed the
 * band (up to 2×, which `lib/payments/pricing.ts` allows on an approved overrun), so
 * a quarter of it can be more than a quarter of the quote. Printing a confident
 * number that the bill can then exceed is worse than printing none, because it reads
 * as a promise. What IS true and worth saying is the two facts this returns: the
 * whole balance, which bounds the total however many jobs it takes, and the share of
 * any one bill, which the copy carries from `recoveryCapBps`.
 *
 * A DISPUTED DEBT IS STILL SHOWN, with `disputed` set. Hiding it would be worse than
 * showing it: somebody who has disputed a charge wants to see that we know, and the
 * line is what tells them nothing is being taken while a person looks.
 */
export type TripDebtNotice =
  | { show: false }
  | {
      show: true;
      /** The whole balance carried. It bounds the total, across however many jobs. */
      outstanding: number;
      /** The share of any one bill, as a percentage, straight off the constant. */
      sharePercent: number;
      disputed: boolean;
    };

export function tripDebtNotice(input: {
  outstanding: number;
  disputedAt: string | null;
}): TripDebtNotice {
  if (input.outstanding <= 0) return { show: false };

  return {
    show: true,
    outstanding: input.outstanding,
    // From the constant the recovery itself uses, so the sentence and the arithmetic
    // cannot drift — the duplication this repository keeps paying for.
    sharePercent: TRIP_COMPENSATION.recoveryCapBps / 100,
    disputed: input.disputedAt !== null,
  };
}
