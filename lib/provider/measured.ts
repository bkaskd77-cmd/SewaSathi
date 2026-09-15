/**
 * Does this number have any evidence behind it?
 *
 * A DEFAULT IS NEVER A MEASUREMENT, and `provider_stats` is full of defaults
 * that read like facts: `rating_avg` 0, `avg_response_minutes` 120,
 * `completion_rate` **100**. Every one of them renders as a confident figure
 * beside figures that were actually earned, and every one has now misled either
 * a customer or the ranking:
 *
 *   * `rating_avg 0` printed "0.0" next to real ratings — the worst possible
 *     score, shown for somebody nobody had rated.
 *   * `avg_response_minutes 120` is exactly `RESPONSE_CEILING_MINUTES`, so an
 *     untimed professional scored zero on that axis for ever, while seeded
 *     fixtures at 12 minutes kept 0.90.
 *   * `completion_rate 100` is the opposite and no better: a listing nobody has
 *     measured scored a PERFECT completion rate, above a real professional at
 *     96%. Found by the audit that produced the standing rule in CLAUDE.md.
 *
 * ONE PLACE DECIDES, and that is the whole point of this file. The rule was
 * previously re-derived per surface and the surfaces disagreed — the catalogue
 * card gated the response time on `jobsCompleted > 0` while `scoreParts` gated
 * it on `responseSamples > 0`, so a screen and the ranking behind it could
 * answer differently about the same person.
 *
 * Isomorphic and dependency-free: the booking flow is a Client Component and
 * asks these questions too.
 */

/** Only the counts. Deliberately not `Provider["stats"]` — the point is the denominators. */
export type StatEvidence = {
  ratingCount: number;
  jobsCompleted: number;
  jobsAccepted: number;
  responseSamples: number;
  /**
   * Times this professional offered to fit a customer in beside a job they
   * already held. The denominator a miss rate needs, and it is small on
   * purpose — see `OVERBOOK_MIN_OFFERS`.
   */
  overbookOffers: number;
};

/** Has anybody actually rated them? */
export function hasRating(stats: Pick<StatEvidence, "ratingCount">): boolean {
  return stats.ratingCount > 0;
}

/**
 * Has anybody timed a reply from them?
 *
 * `responseSamples`, never `jobsCompleted`. Finishing work is not the same as
 * having been timed answering an offer, and nothing computes this column from
 * bookings yet — so today the honest answer is "no" for everybody, including
 * the seeded rows whose 12-minute figures are fiction.
 */
export function hasResponse(
  stats: Pick<StatEvidence, "responseSamples">,
): boolean {
  return stats.responseSamples > 0;
}

/**
 * Is there a completion rate to speak of?
 *
 * Completion is finished-over-accepted, so jobs ACCEPTED is the denominator: a
 * professional who has never been given a job has no rate, and the stored 100
 * is a placeholder rather than a clean record.
 */
export function hasCompletion(
  stats: Pick<StatEvidence, "jobsAccepted">,
): boolean {
  return stats.jobsAccepted > 0;
}

/**
 * How many offers a record needs before its miss rate means anything.
 *
 * TEN, AND THE REASON IS THAT OFFERS ARE RARE BY CONSTRUCTION. A professional
 * only generates one by choosing to fit somebody in beside a job they already
 * hold — there is no standing setting and the customer cannot ask for it — so
 * the usual 30 would mean the signal never activates at all. At ten offers a
 * 30% miss rate is three real misses and a pattern. It matches the 10-job floor
 * `needsBandReview` already uses, for the same reason.
 */
export const OVERBOOK_MIN_OFFERS = 10;

/**
 * Is there an overbooking record to speak of?
 *
 * One miss out of two offers reads as a 50% failure rate and is statistically
 * nothing. Rule 6 applies exactly as it does to ratings and response times: an
 * UNMEASURED overbooking record must not be presented, or scored, as a
 * measurement. Below the floor the dashboard says "not enough yet — 4 of 10"
 * rather than printing a percentage nobody should act on.
 */
export function hasOverbookRecord(
  stats: Pick<StatEvidence, "overbookOffers">,
): boolean {
  return stats.overbookOffers >= OVERBOOK_MIN_OFFERS;
}
