/**
 * The side of the platform that had no defences at all.
 *
 * THE ATTACK, stated plainly: a competitor buys twenty disposable SIMs and
 * books out every plumber in Kathmandu on a Saturday morning. Nobody is at any
 * of the addresses. It costs them almost nothing and it costs us the scarcest
 * thing we have — a professional sent to two fake addresses does not come
 * back, and the supply lost that way never returns.
 *
 * Everything on the provider side is largely self-defending, because a bot
 * cannot produce a police clearance. Nothing on the customer side was.
 *
 * THREE INSTRUMENTS, AND THEY ARE NOT INTERCHANGEABLE:
 *
 *   1. MATCH KEYS, the same ones as the provider side. A banned customer
 *      coming back on a new number is the same attack as a removed provider
 *      doing it, and it gets the same answer: identity is what was expensive
 *      to change, never the phone number.
 *   2. A LADDER BUILT ON RECORDED HISTORY. No-shows and false addresses that
 *      actually happened, escalating to a DEPOSIT rather than a ban. A ban is
 *      the only tool a lazy system has and it is the wrong one: somebody with
 *      two genuine emergencies and a chaotic month is not an attacker, and a
 *      deposit lets them keep using the platform while making the attack cost
 *      money.
 *   3. A RISK SCORE THAT ONLY SURFACES. Never blocks. A brand-new account
 *      booking an emergency at two in the morning is the single most
 *      suspicious pattern available AND IT IS EXACTLY OUR CUSTOMER — somebody
 *      whose pipe has burst, who installed the app twenty minutes ago because
 *      they had to. A system that blocks that has misunderstood the business
 *      it is in.
 *
 * The line between instrument 2 and 3 is the important one: A DEPOSIT IS ONLY
 * EVER CHARGED ON RECORDED HISTORY, never on a score. History is evidence; a
 * score is a guess, and charging money on a guess is how you drive away the
 * customer who needed you most.
 *
 * Pure and isomorphic, so the booking screen can show somebody why a deposit
 * is being asked for before they reach the payment step.
 */

/* ------------------------------------------------------------------ *
 * The ladder
 * ------------------------------------------------------------------ */

export type CustomerHistory = {
  /** Jobs where the professional arrived and nobody was there. */
  noShows: number;
  /** Addresses that turned out not to exist or not to be theirs. */
  falseAddresses: number;
  /** Completed and settled jobs. The counterweight — see below. */
  completedJobs: number;
};

/**
 * What each step costs, and how it lifts.
 *
 * PUBLISHED, like the provider ladder on /providers/standards, and for the
 * same reason: deterrence nobody can read is not deterrence, it is a trap.
 */
export const CUSTOMER_LADDER = {
  /** The first one is a fact of life. Recorded, nothing said. */
  recordAt: 1,
  /** The second is told to them, plainly, with what happens next. */
  warnAt: 2,
  /** The third asks for money up front. */
  depositAt: 3,
  /**
   * Rs 500, and it is APPLIED TO THE BILL rather than kept.
   *
   * A deposit that is forfeited is a fine, and a fine needs an adjudication we
   * have no instrument for. This one is simply the money arriving earlier: a
   * genuine customer pays the same total as always and notices only the order,
   * while somebody booking twenty fake jobs has to fund twenty deposits.
   */
  depositRupees: 500,
  /**
   * Two clean completed jobs retire one no-show.
   *
   * WITHOUT THIS THE LADDER IS A RATCHET. A customer of three years with one
   * bad week would sit on the top rung for ever, which is both unjust and bad
   * business. Two-for-one because recovering should be slower than falling.
   */
  jobsToRetireOne: 2,
} as const;

export type LadderStep = "clear" | "recorded" | "warned" | "deposit" | "review";

export type LadderVerdict = {
  step: LadderStep;
  /** Effective strikes after completed jobs are credited. */
  effectiveStrikes: number;
  depositRupees: number;
  /** Said to the customer. Never a number on its own. */
  detail: string;
};

export function judgeCustomerLadder(history: CustomerHistory): LadderVerdict {
  /*
   * A false address is worse than a no-show and counts double. Not turning up
   * is careless; sending somebody to an address that was never yours is
   * deliberate, and it is the actual shape of the competitor attack.
   */
  const raw = history.noShows + history.falseAddresses * 2;
  const credit = Math.floor(
    Math.max(0, history.completedJobs) / CUSTOMER_LADDER.jobsToRetireOne,
  );
  const effectiveStrikes = Math.max(0, raw - credit);

  if (effectiveStrikes >= CUSTOMER_LADDER.depositAt + 2) {
    return {
      step: "review",
      effectiveStrikes,
      depositRupees: CUSTOMER_LADDER.depositRupees,
      detail:
        "Repeated no-shows after a deposit was already required. A person looks at this before the next booking.",
    };
  }
  if (effectiveStrikes >= CUSTOMER_LADDER.depositAt) {
    return {
      step: "deposit",
      effectiveStrikes,
      depositRupees: CUSTOMER_LADDER.depositRupees,
      detail:
        "A deposit is held on new bookings and goes towards the bill. It is not a charge and it is not kept.",
    };
  }
  if (effectiveStrikes >= CUSTOMER_LADDER.warnAt) {
    return {
      step: "warned",
      effectiveStrikes,
      depositRupees: 0,
      detail:
        "Somebody travelled to you twice and nobody was there. One more and new bookings will need a deposit.",
    };
  }
  if (effectiveStrikes >= CUSTOMER_LADDER.recordAt) {
    return {
      step: "recorded",
      effectiveStrikes,
      depositRupees: 0,
      detail: "Recorded. Nothing changes for you.",
    };
  }
  return { step: "clear", effectiveStrikes: 0, depositRupees: 0, detail: "" };
}

/* ------------------------------------------------------------------ *
 * Hard limits — the only things that actually stop a booking
 * ------------------------------------------------------------------ */

export const BOOKING_LIMITS = {
  /**
   * How many live jobs an account with no completed history may hold at once.
   *
   * THE ONE CONTROL THAT BLOCKS, and it is deliberately the crudest. Twenty
   * SIMs each booking two plumbers is forty; twenty SIMs each booking one is
   * twenty. It does not stop the attack, it makes it forty times more
   * expensive per SIM, and no genuine customer has ever needed three
   * simultaneous tradespeople on their first day.
   */
  unverifiedConcurrent: 2,
  /** Completed jobs after which the cap no longer applies. */
  establishedAfterJobs: 1,
} as const;

export function concurrentBookingCap(history: CustomerHistory): number | null {
  return history.completedJobs >= BOOKING_LIMITS.establishedAfterJobs
    ? null
    : BOOKING_LIMITS.unverifiedConcurrent;
}

/* ------------------------------------------------------------------ *
 * The score, which surfaces and never blocks
 * ------------------------------------------------------------------ */

export type BookingSignals = {
  /** Hours since the account was created. */
  accountAgeHours: number;
  /** Live bookings this account already holds. */
  concurrentBookings: number;
  /** Local hour, 0–23. */
  bookedAtHour: number;
  /** Times a professional has failed to find this address before. */
  addressFailures: number;
  /** The customer called it an emergency. */
  isEmergency: boolean;
};

export type BookingRiskVerdict = {
  score: number;
  /** Reasons, for a person. Never shown to the customer. */
  evidence: string[];
  /** Turnstile, for a brand-new account only. Returning customers never see it. */
  requiresChallenge: boolean;
};

const NEW_ACCOUNT_HOURS = 24;

export function judgeBookingRisk(signals: BookingSignals): BookingRiskVerdict {
  const evidence: string[] = [];
  let score = 0;

  const isNew = signals.accountAgeHours < NEW_ACCOUNT_HOURS;
  if (isNew) {
    score += 15;
    evidence.push("Account created in the last day.");
  }

  if (signals.concurrentBookings >= 2) {
    score += 20 * (signals.concurrentBookings - 1);
    evidence.push(
      `${signals.concurrentBookings} jobs already open on this account.`,
    );
  }

  if (signals.addressFailures > 0) {
    // The strongest signal available, because it already happened once.
    score += 30 * signals.addressFailures;
    evidence.push(
      `A professional has failed to find this address ${signals.addressFailures} time${signals.addressFailures === 1 ? "" : "s"} before.`,
    );
  }

  const unsocial = signals.bookedAtHour >= 23 || signals.bookedAtHour < 5;
  if (unsocial && !signals.isEmergency) {
    /*
     * ONLY WHEN IT IS NOT AN EMERGENCY, and this condition is the whole
     * argument. A new account booking an emergency at two in the morning is
     * the most suspicious pattern the system can see and it is our best
     * customer — somebody whose pipe has burst and who installed the app
     * twenty minutes ago. A routine repaint booked at 3am is a different
     * thing, and that is the only case scored here.
     */
    score += 10;
    evidence.push("Routine job booked in the middle of the night.");
  }

  return {
    score: Math.min(100, score),
    evidence,
    // New accounts only, so somebody who has booked before never meets a
    // puzzle on the screen where their pipe is leaking.
    requiresChallenge: isNew,
  };
}

/**
 * May this booking be created?
 *
 * THE ONLY BLOCKING RULE IN THIS FILE, and it reads nothing from the score on
 * purpose. Everything else surfaces to a person. A high-scoring booking still
 * goes through; a twenty-first concurrent booking from an account with no
 * history does not.
 */
export type BookingGate =
  | { allowed: true; depositRupees: number; requiresChallenge: boolean }
  | { allowed: false; reason: "concurrentCap"; cap: number };

export function gateBooking(input: {
  history: CustomerHistory;
  signals: BookingSignals;
}): BookingGate {
  const cap = concurrentBookingCap(input.history);
  if (cap !== null && input.signals.concurrentBookings >= cap) {
    return { allowed: false, reason: "concurrentCap", cap };
  }

  const ladder = judgeCustomerLadder(input.history);
  return {
    allowed: true,
    // From recorded history only. Never from the risk score.
    depositRupees: ladder.depositRupees,
    requiresChallenge: judgeBookingRisk(input.signals).requiresChallenge,
  };
}
