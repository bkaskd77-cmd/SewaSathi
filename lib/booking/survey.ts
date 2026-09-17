/**
 * A trade that has no price until somebody has looked.
 *
 * Movers and packers is the case and it is a FINDING, not a gap in the
 * research: no Nepali operator publishes a figure, every one quotes after a
 * survey, and inventing a range would fabricate the one number the market
 * itself refuses to state before seeing the job.
 *
 * SO THE SURVEY PRODUCES THE BAND, AND THE CUSTOMER APPROVES IT. That order is
 * the whole design. `judgeFinalAmount` measures the 2x overcharge ceiling off
 * `quoted_max`, so a booking with no band has no ceiling — precisely the
 * protection that stops a mistyped extra zero. The band has to exist, and the
 * customer has to have agreed to it, before any work can start; after that
 * every money rule in the product reads a real band and none of them changes.
 *
 * AND THE SURVEY VISIT IS A BOOKING. A real professional at a real door at a
 * real time, which is what a booking is. Keeping it as a separate record would
 * mean building dispatch, live tracking, cancellation and the no-show flow a
 * second time and reconciling the two for ever.
 *
 * Pure and dependency-free: the customer page, the professional's card and the
 * expiry sweep all ask these questions, and two of those are client code.
 */

/**
 * How long a surveyed price holds.
 *
 * FORTY-EIGHT HOURS, and the two halves of the reason pull against each other.
 * A household moving house needs an evening to talk it over, so anything
 * shorter is a product hurrying somebody through the largest decision it sells.
 * But a surveyed figure is built from that week's van and that week's labour,
 * so a price still acceptable a fortnight later is a price nobody can honour —
 * and honouring it anyway would mean the professional absorbing the difference,
 * which is how a rule ends up costing the wrong person.
 *
 * It is stamped onto the booking at survey time rather than recomputed, so
 * changing this number never moves a deadline somebody was already given.
 */
export const QUOTE_VALID_HOURS = 48;

/** How long before the deadline the customer is reminded. */
export const QUOTE_EXPIRY_WARNING_HOURS = 6;

export type QuoteModel = "band" | "survey";

/**
 * Where a survey-priced booking has got to.
 *
 * ONE FUNCTION, because three surfaces ask — the customer's booking page, the
 * professional's job card and the sweep that expires a stale quote — and three
 * answers to "has this been approved yet" is how somebody gets a confirm button
 * they should not have.
 */
export type QuoteState =
  /** Nobody has been to look yet. */
  | "awaiting-survey"
  /** Priced, and waiting on the customer. */
  | "awaiting-approval"
  /** The customer agreed. Work may start. */
  | "approved"
  /** Priced, and nobody answered in time. */
  | "expired"
  /** The customer said no. */
  | "declined";

export type QuoteFacts = {
  quoteModel: QuoteModel;
  quotedMin: number | null;
  quotedMax: number | null;
  surveyedAt?: string | null;
  quoteExpiresAt?: string | null;
  quoteApprovedAt?: string | null;
  quoteDeclinedAt?: string | null;
};

function instant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? null : when;
}

/** When a quote recorded now would stop being honourable. */
export function quoteExpiryFrom(surveyedAt: Date = new Date()): Date {
  return new Date(surveyedAt.getTime() + QUOTE_VALID_HOURS * 60 * 60_000);
}

/**
 * Read the state of a survey booking's quote.
 *
 * ORDER MATTERS AND IS DELIBERATE. An approval is final: a quote approved
 * inside its window stays approved when the window later passes, because the
 * customer already agreed and the job is going ahead. Expiry only ever catches
 * a quote nobody answered.
 */
export function quoteState(facts: QuoteFacts, now: Date = new Date()): QuoteState {
  if (facts.quoteDeclinedAt) return "declined";
  if (facts.quoteApprovedAt) return "approved";

  // No band yet means nobody has been to look, whatever else is stamped.
  if (facts.quotedMin == null || facts.quotedMax == null) {
    return "awaiting-survey";
  }

  const expires = instant(facts.quoteExpiresAt);
  // A quote with no deadline is not expired — a missing stamp is a bug in the
  // write path, and treating it as lapsed would cancel somebody's move over it.
  if (expires && now.getTime() >= expires.getTime()) return "expired";

  return "awaiting-approval";
}

/** Is this booking waiting on the customer to say yes to a price? */
export function awaitingQuoteApproval(
  facts: QuoteFacts,
  now: Date = new Date(),
): boolean {
  return quoteState(facts, now) === "awaiting-approval";
}

/**
 * Is the deadline close enough to be worth a second message?
 *
 * One reminder, not a countdown. The approval is the drop-off point on the
 * highest-value trade we sell, and the difference between a customer who meant
 * to answer and one who decided not to is usually that nobody asked twice.
 */
export function quoteExpiringSoon(
  facts: QuoteFacts,
  now: Date = new Date(),
): boolean {
  if (quoteState(facts, now) !== "awaiting-approval") return false;
  const expires = instant(facts.quoteExpiresAt);
  if (!expires) return false;
  const left = expires.getTime() - now.getTime();
  return left > 0 && left <= QUOTE_EXPIRY_WARNING_HOURS * 60 * 60_000;
}

/**
 * May work begin?
 *
 * THE FIRST OF TWO INDEPENDENT GUARDS. `enforce_survey_quote` in Postgres is
 * the other, and neither is allowed to be the only one: this is the money path,
 * and a rule the application owns alone is a rule the application can forget.
 *
 * A band booking is unaffected — it has had its band since it was made.
 */
export function workMayStart(facts: QuoteFacts, now: Date = new Date()): boolean {
  if (facts.quoteModel !== "survey") return true;
  return quoteState(facts, now) === "approved";
}

/**
 * What a decline or a lapse costs, and who carries it.
 *
 * THE SURVEYOR TRAVELLED AND DID REAL WORK. When the move goes ahead the survey
 * is folded into the job they are about to be paid for, and the customer is
 * never charged for it separately. When it does not, somebody has to carry the
 * trip, and it must not be the person who made it: a professional out of pocket
 * for a customer's change of mind learns to stop taking survey jobs, and movers
 * is the one trade where every job starts with one.
 *
 * So we pay it. `SURVEY_VISIT_FEE_NPR` in `lib/payments/payout.ts` is the
 * amount and says in its own comment that it moves money between us and the
 * professional and never touches what a customer pays.
 *
 * AND A DECLINE SCORES AGAINST NOBODY. No refusal row, no decline counter, no
 * ranking effect. A customer turning down a price is not a professional
 * failing, and counting it would teach surveyors to quote low enough to be
 * accepted rather than high enough to be true — which is the same shape of
 * mistake as under-reporting a cash job, with the sign flipped.
 */
export type SurveyOutcome = {
  /** Does a visit fee fall due? */
  payVisitFee: boolean;
  /** Does anything about this touch the professional's record? Never. */
  countsAgainstProvider: false;
};

export function surveyOutcome(
  state: QuoteState,
  /**
   * Did anybody actually go?
   *
   * NO TRIP, NO FEE — the cheapest guard against farming the visit fee and the
   * one that reuses machinery already here. `booking_arrivals` is written when
   * a professional records turning up, for the wasted-trip flow. A fee is
   * reimbursement for a journey, so without a recorded journey there is nothing
   * to reimburse, and quoting high from the sofa stops being a route at all.
   * Travelling there first is most of the cost the fee exists to cover.
   *
   * Defaults to false, which errs toward NOT paying. `enforce_survey_visit_fee`
   * in Postgres refuses the row outright either way; this is the sentence.
   */
  arrived = false,
): SurveyOutcome {
  return {
    payVisitFee: arrived && (state === "declined" || state === "expired"),
    countsAgainstProvider: false,
  };
}
