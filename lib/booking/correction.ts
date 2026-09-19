/**
 * Where a price correction has got to, as one word.
 *
 * SEPARATE FROM `quoteState`, DELIBERATELY. The two have the same four shapes —
 * nothing yet, waiting on the customer, agreed, refused — and different facts
 * underneath, and `enforce_survey_quote` in Postgres keeps them apart for a
 * reason it states plainly: a banded booking that grows a survey stamp means
 * some other path has started treating it as a survey. Folding the two together
 * here would make that guard unwritable up the stack as well as down it.
 *
 * WHAT A CORRECTION IS. When the triage card could not name a product it asks
 * the customer, and their answer sets the price — which gives them a reason to
 * name a cheaper product than the one they have. A professional who arrives and
 * finds a burst pipe where "inspection only" was booked says so, with a reason,
 * and the customer answers BEFORE work starts. `enforce_price_correction`
 * refuses `in_progress` while the question is open, so this is a gate rather
 * than a notice somebody can scroll past.
 *
 * THERE IS NO `expired` STATE, and that is the one real difference from a
 * surveyed quote. A survey holds a price somebody has to answer in time because
 * the figure goes stale; a correction holds the job itself, and the clock that
 * matters is the professional standing outside. Nothing times out — the
 * customer answers, or the job does not start.
 */

export type CorrectionState =
  /** Nobody has said the product is wrong. The ordinary case. */
  | "none"
  /** The professional says it is something else, and the customer has not answered. */
  | "awaiting-answer"
  /** The customer agreed. The price has moved and work may start. */
  | "agreed"
  /** The customer said no. The job is over. */
  | "refused";

export type CorrectionFacts = {
  /** The product the professional says it actually is. */
  providerBandSlug?: string | null;
  /** When they said so. The presence of a correction, not the slug. */
  providerBandAt?: string | null;
  bandChangeApprovedAt?: string | null;
  bandChangeDeclinedAt?: string | null;
};

/**
 * `providerBandAt` IS THE EXISTENCE TEST, not the slug.
 *
 * `bookings_provider_band_slug_fkey` is `on delete set null`, so retiring a
 * product from the catalogue clears the slug and leaves the stamp. A correction
 * the customer already answered must not silently become "none" because
 * somebody tidied a price list months later — the answer they gave is the
 * record, and the money moved on it.
 */
export function correctionState(facts: CorrectionFacts): CorrectionState {
  if (!facts.providerBandAt) return "none";
  if (facts.bandChangeApprovedAt) return "agreed";
  if (facts.bandChangeDeclinedAt) return "refused";
  return "awaiting-answer";
}

/**
 * May this professional propose a correction right now?
 *
 * BEFORE WORK STARTS, WHICH IS THE WHOLE POINT. `accepted` and `en_route` are
 * the windows: they have taken the job and may have arrived. From `in_progress`
 * the floor is already up and a price correction is a support call rather than
 * a tap — the same line `lib/booking/cancellation.ts` draws, for the same
 * reason.
 *
 * ONE CORRECTION AT A TIME. A second proposal while the first is unanswered
 * would leave the customer two questions and the booking two prices. After a
 * refusal the job is ending, so there is nothing to correct either.
 */
export function canProposeCorrection(input: {
  status: string;
  state: CorrectionState;
  /** A survey job's whole price arrives after the visit; it has no band. */
  quoteModel?: string | null;
}): boolean {
  if (input.quoteModel === "survey") return false;
  if (input.status !== "accepted" && input.status !== "en_route") return false;
  return input.state === "none";
}
