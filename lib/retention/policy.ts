/**
 * How long we keep things, and why each number is what it is.
 *
 * "Kept for the life of the account with no rule" is the sentence nobody wants
 * to say after a breach. It is also the honest description of what this
 * product did until now: every address, every photograph of somebody's
 * kitchen, every line they typed about their problem, held indefinitely
 * because nothing said otherwise.
 *
 * TWO PRINCIPLES BEHIND EVERY NUMBER BELOW:
 *
 *   1. The clock starts when the data stops being useful, not when it was
 *      created. A photo of a broken tap is needed until the job is done and
 *      the dispute window has closed; a year later it is a picture of the
 *      inside of a stranger's home with no purpose at all.
 *   2. Where a record must survive for money or law, the IDENTIFYING part is
 *      destroyed and the rest is kept. An address is redacted rather than
 *      deleted: the ward stays so the booking still reconciles and the
 *      aggregates still work, and the doorstep goes. Deleting the row would
 *      take a financial record with it, which is why "delete everything" is
 *      the wrong instrument.
 *
 * NOTHING HERE RUNS UNTIL THE NUMBERS ARE APPROVED. `RETENTION_ENABLED` gates
 * the sweep and defaults to off; without it the job reports what it *would*
 * delete and touches nothing. A deletion policy applied before somebody has
 * read the numbers is a data loss incident with a changelog entry.
 */

export type RetentionRule = {
  /** What the clock starts from. */
  from: string;
  days: number;
  /** Destroyed, or reduced to something that is no longer about a person. */
  action: "delete" | "redact";
  why: string;
};

export const RETENTION: Record<string, RetentionRule> = {
  /*
   * THE ONE THAT MATTERS MOST. A leak here is where people live.
   *
   * Redacted, not deleted: bookings reference addresses, and a booking is a
   * financial record. The ward survives so `payment_mix_signals` and every
   * other aggregate still works; the tole, the landmark and the directions —
   * the parts that get somebody to a door — do not.
   *
   * Two years from the last booking at that address, because a customer who
   * comes back within two years expects their saved address to still be there
   * and re-typing it is a real cost to them. Beyond that the convenience is
   * worth less than the risk of holding it.
   */
  addresses: {
    from: "the most recent booking at this address",
    days: 730,
    action: "redact",
    why: "The doorstep goes; the ward stays so the booking still reconciles.",
  },

  /*
   * A photograph taken inside somebody's home. The professional needs it while
   * the job is live; after that it is evidence for a dispute, and disputes
   * arrive within weeks, not years.
   */
  bookingPhotos: {
    from: "the booking completing or being cancelled",
    days: 90,
    action: "delete",
    why: "Needed during the job and the dispute window, and then not at all.",
  },

  /*
   * The free text somebody typed about their problem. It is often a sentence
   * about their home and occasionally about their health — "the geyser in the
   * baby's room". The CATEGORY, urgency and latency stay for ever, because
   * that is what tells us whether the price bands are right and it says
   * nothing about a person; the words go.
   */
  triageText: {
    from: "the triage happening",
    days: 90,
    action: "redact",
    why: "The pricing signal is in the category, not in the sentence.",
  },

  /*
   * Auth, admin actions, document reads. Two years covers a dispute and a
   * breach investigation that started late — which is how they usually start.
   */
  securityEvents: {
    from: "the event",
    days: 730,
    action: "delete",
    why: "Long enough for a dispute and for a late-noticed breach.",
  },

  /*
   * Money is different and the law says so. Five years is the conservative
   * reading of Nepali record-keeping for a business that takes commission,
   * and being wrong in this direction costs storage rather than a penalty.
   */
  paymentEvents: {
    from: "the settlement",
    days: 1825,
    action: "delete",
    why: "Financial records. Erring long here costs storage; erring short costs a penalty.",
  },

  /*
   * Citizenship certificates, PAN cards, photographs of faces. The verified
   * ones prove we did the check we claim to have done, so they outlive the
   * listing by a year. The rejected ones prove nothing and are the most
   * dangerous thing in the building.
   */
  verifiedDocuments: {
    from: "the listing closing",
    days: 365,
    action: "delete",
    why: "Proof we ran the check we advertise, for a year after they leave.",
  },
  rejectedDocuments: {
    from: "the rejection",
    days: 30,
    action: "delete",
    why: "Long enough to appeal, and then it is an identity document we have no reason to hold.",
  },

  /** Read or not, a notification is stale within a season. */
  notifications: {
    from: "the notification",
    days: 90,
    action: "delete",
    why: "Nobody reads a four-month-old status change.",
  },

  /*
   * Somebody asked to join and we never onboarded them. A year is a generous
   * hiring pipeline; after that it is a list of names and phone numbers with
   * no purpose.
   */
  providerLeads: {
    from: "the application",
    days: 365,
    action: "delete",
    why: "A pipeline, not an archive.",
  },
};

export type RetentionKey = keyof typeof RETENTION;

/** Is a record of this kind past its date? Pure, so the rules are testable. */
export function isExpired(
  key: RetentionKey,
  clockStartedAt: string | Date | null,
  now: Date = new Date(),
): boolean {
  if (!clockStartedAt) return false;
  const started = new Date(clockStartedAt).getTime();
  if (Number.isNaN(started)) return false;
  return now.getTime() - started >= RETENTION[key].days * 86_400_000;
}

/** The cutoff instant for a rule — what a query compares against. */
export function cutoffFor(key: RetentionKey, now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION[key].days * 86_400_000);
}

/**
 * Is the sweep allowed to actually delete anything?
 *
 * Off unless explicitly enabled. The job still runs and still reports; it just
 * does not touch a row. A retention policy that starts deleting the moment it
 * is merged, before anybody has read the numbers, is a data loss incident with
 * a changelog entry.
 */
export function retentionIsArmed(): boolean {
  return process.env.RETENTION_ENABLED === "true";
}
