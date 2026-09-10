/**
 * Where the risk actually is: the address, not the account.
 *
 * ACCOUNT AGE IS THE WRONG SIGNAL AND WE HAD BEEN LEANING ON IT. A customer of
 * three years can send a professional to an address they invented this
 * morning; somebody who installed the app twenty minutes ago because their
 * pipe burst is sending them to the flat they have lived in for a decade. The
 * thing that costs a professional a wasted trip is a DOOR NOBODY HAS EVER
 * OPENED, and that is a property of the address.
 *
 * So an address earns trust the only way it honestly can — somebody went there
 * and the job happened. Everything else is a promise.
 *
 * THREE STATES, and the middle one is the whole design:
 *
 *   proven     A job has been completed at this door. Nothing more to prove.
 *   confirmed  The customer actively answered "yes, I am here" for this
 *              booking. Cheap for a real person — they are holding the phone
 *              they just booked on — and impossible for a script that fired
 *              twenty bookings and walked away.
 *   unproven   Neither. This is where a wasted trip comes from.
 *
 * `confirmed` is what lets the platform stay open to a first-time customer at
 * two in the morning. The answer to an unproven address is never "no". It is
 * "answer this, then we send somebody" — one tap, on a screen they are already
 * looking at.
 */

export type AddressTrust = "proven" | "confirmed" | "unproven";

export type AddressHistory = {
  /** Jobs completed at this address, by anybody. */
  completedJobs: number;
  /** Times a professional arrived and found nobody, upheld. */
  upheldNoShows: number;
  /** Whether the customer has actively confirmed for THIS booking. */
  confirmedForThisBooking: boolean;
};

export function addressTrust(history: AddressHistory): AddressTrust {
  /*
   * AN UPHELD NO-SHOW UNDOES PROVEN, and it has to. An address that worked
   * once and then swallowed a trip is not a safe address any more — this is
   * exactly how somebody would launder a fake address, by having one real job
   * done there first.
   */
  if (history.upheldNoShows > 0) {
    return history.confirmedForThisBooking ? "confirmed" : "unproven";
  }
  if (history.completedJobs > 0) return "proven";
  if (history.confirmedForThisBooking) return "confirmed";
  return "unproven";
}

/**
 * Must somebody actively answer before we send a professional?
 *
 * Only for an unproven address. A proven one has already cost us nothing, and
 * asking a regular customer to confirm their own front door every time is the
 * kind of friction that teaches people to tap through prompts without reading
 * them — which is how you lose the prompt's value everywhere else.
 */
export function requiresConfirmation(trust: AddressTrust): boolean {
  return trust === "unproven";
}

/**
 * How hard we try to get that answer.
 *
 * ESCALATE, NEVER BLOCK — the hard constraint. An emergency at 2am from a
 * first-time account at a first-time address is the single riskiest booking
 * the system can see AND IT IS THE ONE WE MOST WANT. So the emergency case
 * gets MORE ways to answer, not fewer: the tap, and a phone number that
 * reaches a person immediately. It never gets a refusal and it never gets a
 * longer wait.
 *
 * A PASSIVE TIMER IS NOT AN ANSWER. "Dispatch unless they say no in five
 * minutes" protects nothing: the script that made twenty fake bookings is not
 * going to say no either. The confirmation has to be something somebody
 * actively does.
 */
export type ConfirmationPlan = {
  required: boolean;
  /** Ways the customer can answer, in the order they are offered. */
  channels: Array<"tap" | "call">;
  /**
   * Whether a person should ring them rather than waiting.
   *
   * True for an emergency, because somebody frightened at 2am should not be
   * left looking at a prompt — and because a call that gets answered is
   * stronger evidence than a tap.
   */
  callImmediately: boolean;
  /**
   * How long to hold before giving up and telling the customer nobody was
   * dispatched. Never a silent expiry: the booking screen says what happened.
   */
  holdMinutes: number;
};

export function confirmationPlan(input: {
  trust: AddressTrust;
  isEmergency: boolean;
}): ConfirmationPlan {
  if (!requiresConfirmation(input.trust)) {
    return {
      required: false,
      channels: [],
      callImmediately: false,
      holdMinutes: 0,
    };
  }

  return {
    required: true,
    // The tap is first for everybody: it is instant for somebody who has the
    // app open, which is everybody who just booked.
    channels: input.isEmergency ? ["tap", "call"] : ["tap"],
    callImmediately: input.isEmergency,
    /*
     * An emergency is held far longer before we give up, not shorter. The
     * instinct is to time it out fast so the professional is freed — that is
     * backwards. Somebody with water coming through the ceiling may be moving
     * furniture rather than watching a phone, and abandoning them after ten
     * minutes is the platform failing at the exact moment it matters.
     */
    holdMinutes: input.isEmergency ? 45 : 20,
  };
}

/**
 * May the dispatcher send somebody to this booking yet?
 *
 * Pure, and here rather than in the data layer for a reason a test found: it
 * is a predicate over two columns, and putting it beside the database reads
 * made it impossible to check without a `server-only` import dragging the
 * whole data layer into a unit test. A rule this small should be testable on
 * its own.
 *
 * Takes the row shape rather than a domain object so the dispatch sweep can
 * pass what it already selected.
 */
export function dispatchIsHeld(booking: {
  confirmation_required: boolean;
  confirmed_at: string | null;
}): boolean {
  return booking.confirmation_required && booking.confirmed_at === null;
}
