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
  /**
   * First-choice offers made to them — the denominator for whether they answer.
   *
   * Only first-choice offers, because an open job broadcast to everybody is not
   * an offer to anybody in particular. Counting those would make a busy week
   * look like ignoring people.
   */
  offersMade: number;
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

/**
 * How many offers before an answer rate means anything.
 *
 * TEN, the same floor as overbooking and for a related reason: a first-choice
 * offer is not something a professional generates, it is something that happens
 * to them, and in a thin market it happens rarely. One unanswered offer out of
 * two is not a pattern, and a rate computed over it would take work away from
 * somebody who has barely been offered any.
 */
export const OFFER_MIN_SAMPLE = 10;

/**
 * Is there a record of whether they answer?
 *
 * The standards publish exactly one thing measured about availability: saying
 * you are free and then not answering. That only means something with a
 * denominator — and turning work DOWN counts as answering, because the same
 * page publishes turning work down as never-a-signal, and a rate that punished
 * a decline would make that a lie.
 */
export function hasAnsweredRecord(
  stats: Pick<StatEvidence, "offersMade">,
): boolean {
  return stats.offersMade >= OFFER_MIN_SAMPLE;
}

/*
 * The rating a customer should actually read.
 *
 * MOVED HERE FROM `lib/data/ranking.ts`, because this is the file that decides
 * whether a number has evidence behind it and the Bayesian average is the same
 * idea with arithmetic attached — CLAUDE.md already names it as the shape every
 * other rule in here copied. It also has to be isomorphic: the catalogue card
 * and the booking flow both render it, and one of those is a Client Component.
 */

/** Prior strength: a provider needs ~20 ratings before their own average wins. */
export const RATING_PRIOR_COUNT = 20;
/** The mean a thin rating is pulled toward. */
export const RATING_PRIOR_MEAN = 4.5;

/**
 * A rating you can compare across providers with different amounts of evidence.
 *
 * A 5.0 from 3 jobs lands near 4.57; a 4.8 from 200 stays at 4.77. That single
 * line is what stops the newest provider with three reviews from their cousin
 * sitting at the top of every list.
 */
export function bayesianRating(average: number, count: number): number {
  return (
    (count * average + RATING_PRIOR_COUNT * RATING_PRIOR_MEAN) /
    (count + RATING_PRIOR_COUNT)
  );
}

/**
 * The one figure to print, and it is the same one the ranking uses.
 *
 * WHAT WENT WRONG. Every card rendered the RAW `rating_avg` while `scoreParts`
 * ranked on the Bayesian one, so the two disagreed about the same person in
 * both directions at once: three jobs with one 1-star displayed 3.7 — which
 * reads as "avoid" — while ranking 4.4, and three perfect jobs displayed a 5.0
 * they had not earned while ranking 4.57. The prior was protecting their
 * position and not the number a customer actually reads.
 *
 * That is precisely the card-versus-ranking split this file was created to
 * end, found again in the place it started. One function now answers it, and
 * the count travels beside the figure so 4.85-from-201 never looks like
 * 4.85-from-3.
 *
 * Null when nobody has rated them: `hasRating` is the gate, and a screen with
 * no evidence says so rather than printing a prior as though it were earned.
 */
export function displayRating(
  stats: Pick<StatEvidence, "ratingCount"> & { ratingAvg: number },
): number | null {
  if (!hasRating(stats)) return null;
  return bayesianRating(stats.ratingAvg, stats.ratingCount);
}
