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
 * Everything the one rating figure is computed from.
 *
 * FOUR FIELDS, TWO PAIRS, AND THE SECOND PAIR IS NULLABLE BECAUSE NULL IS "NOT
 * COMPUTED". `rating_recent_avg` and `rating_recent_weight` are written by
 * `refresh_provider_stats`; every `provider_stats` row that existed before
 * `20261012000001` is silent in both, and reading that silence as "unrated"
 * would be rule 6 upside down for the one listing that does have a review.
 *
 * REQUIRED RATHER THAN OPTIONAL, deliberately. An optional pair would let a
 * caller that HAS the columns forget to pass them and silently get the flat
 * figure — which is the card-versus-ranking split this file exists to end,
 * re-opened by a missing property instead of by a second implementation. The
 * compiler asks every surface the question instead.
 */
export type RatingEvidence = Pick<StatEvidence, "ratingCount"> & {
  ratingAvg: number;
  /** The age-weighted mean. Null is "not computed", never "unrated". */
  ratingRecentAvg: number | null;
  /** The summed weight behind it — an EFFECTIVE count, not a row count. */
  ratingRecentWeight: number | null;
};

/**
 * Which pair the figure is actually computed from, and whether it is the
 * recency-weighted one.
 *
 * SEPARATE FROM `displayRating` SO A SCREEN CAN SAY WHICH IT READ. The two
 * figures differ, and a professional looking at their own record is entitled to
 * know whether the number is their whole history or their recent work; a
 * boolean here is cheaper than a second rule anywhere else.
 *
 * THE WEIGHT GOES INTO THE PRIOR, never the row count. Twenty reviews from
 * three years ago carry about two and a half reviews' worth of confidence, so
 * the prior pulls them back exactly as it would for somebody with two and a
 * half — the certainty decays with the figure instead of outliving it. Handing
 * `bayesianRating` the row count beside the decayed average is the worse half
 * of the bug and the one that is easy to write by accident.
 *
 * `weight > 0` is a guard against a nonsense row rather than a real state: at a
 * 365-day half-life every weight underflowing to zero would take about a
 * millennium, and `hasRating` has already said there is a published review. So
 * the fallback is the flat pair, which is what this product printed before the
 * columns existed.
 */
export function ratingEvidence(stats: RatingEvidence): {
  avg: number;
  weight: number;
  recent: boolean;
} {
  if (
    stats.ratingRecentAvg !== null &&
    stats.ratingRecentWeight !== null &&
    stats.ratingRecentWeight > 0
  ) {
    return {
      avg: stats.ratingRecentAvg,
      weight: stats.ratingRecentWeight,
      recent: true,
    };
  }

  return { avg: stats.ratingAvg, weight: stats.ratingCount, recent: false };
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
 * AND THE COUNT BESIDE IT IS STILL THE ROW COUNT, which is why `hasRating`
 * keeps reading `ratingCount` and nothing here touches what a screen prints in
 * brackets. The weight is confidence and the count is evidence: "4.6 (12)"
 * means twelve people wrote something, and replacing that twelve with an
 * effective 7.3 would be a number no customer could check against a page of
 * reviews.
 *
 * Null when nobody has rated them: `hasRating` is the gate, and a screen with
 * no evidence says so rather than printing a prior as though it were earned.
 */
export function displayRating(stats: RatingEvidence): number | null {
  if (!hasRating(stats)) return null;
  const { avg, weight } = ratingEvidence(stats);
  return bayesianRating(avg, weight);
}

/**
 * The same figure, for a caller that must have a number for everybody.
 *
 * RANKING CANNOT HOLD A NULL — every listing needs a comparable score — and
 * the honest score for an unrated one is the prior: like an unknown, never like
 * an extreme. `bayesianRating(anything, 0)` already collapses to exactly
 * `RATING_PRIOR_MEAN`, so this is not a second rule, it is the same rule with
 * the null named. It exists so `scoreParts` and the sort read `displayRating`
 * rather than re-deriving the composition — the divergence this file was
 * created to end, and the one the recency pair made easy to re-open, since a
 * `bayesianRating(ratingAvg, ratingCount)` call still compiles and is now
 * quietly the wrong pair.
 */
export function rankedRating(stats: RatingEvidence): number {
  return displayRating(stats) ?? RATING_PRIOR_MEAN;
}

/*
 * And the same question about a duration — WHICH IS TWO QUESTIONS, NOT ONE.
 *
 * Duration arrived with its own provenance — `duration_source` on
 * `category_price_bands` — precisely so this file could ask about it. Every
 * sub-band's duration is `invented` today, because nobody in Nepal publishes
 * how long a tap leak takes.
 *
 * AND FOR ONE PHASE THAT ONE COLUMN ANSWERED BOTH. The minutes and the span are
 * different claims with different costs, argued apart at length in
 * `lib/booking/duration.ts` and then read off the same column anyway — so
 * promoting a sub-band on minutes evidence would have switched on 2-, 4- and
 * 7-day holds with no span evidence at all. `span_source` is the second gate
 * and these are the two functions that read them.
 */

/** Only the provenance. The numbers are irrelevant to whether they may be shown. */
export type DurationEvidence = {
  /** Governs `typicalWorkingMinutes`. */
  source: "invented" | "researched" | "observed";
  /**
   * Governs `typicalElapsedDays`.
   *
   * OPTIONAL, AND THAT IS A DELIBERATE ASYMMETRY RATHER THAN AN OVERSIGHT.
   * `spansDays()` already takes its whole provenance argument as optional and
   * reads a missing one as "no evidence", because a caller that has not got the
   * provenance to hand must not accidentally be granted a span. Leaving this
   * out means the same thing one level down: no span evidence, hold one day.
   */
  spanSource?: "invented" | "researched" | "observed";
};

/**
 * May a customer be told how many MINUTES this will take?
 *
 * THE SPLIT THAT MAKES THIS WORK: a scheduler may use an invented duration and
 * a screen may not. The scheduler is reserving time — a reservation nobody
 * reads is not a claim about anything, and the alternative is reserving the
 * same two hours for a tap washer and a whole-flat repaint, which is the
 * workaround this replaced. A sentence on a screen IS a claim, and "about 4
 * hours" read off a guess is exactly the shape rule 6 names: a default
 * presented as a measurement.
 *
 * So there is no `hasDuration`. Every booking has one; the question is only
 * ever whether it is ours to publish, and the function is named for that.
 *
 * Today this returns false for all 36 sub-bands, so the whole product is
 * silent about duration while scheduling correctly with it — which is the
 * honest state and is held open by an entry in `check:blockers` rather than
 * being quietly forgotten.
 */
export function hasPublishableMinutes(duration: DurationEvidence): boolean {
  return duration.source !== "invented";
}

/**
 * May a customer be told how many DAYS their home is a building site?
 *
 * SAME SHAPE, SEPARATE EVIDENCE, AND IT IS THE STRICTER OF THE TWO — because
 * this one also decides whether the scheduler may hold more than a day, which
 * `hasPublishableMinutes` never does. A published span and a held span are the
 * same claim here: "four days" on a screen and four days taken out of a
 * painter's week are both read as measurements, and only one of them is
 * visible to the person it costs.
 *
 * A MISSING `spanSource` IS NO EVIDENCE, never inherited from `source`. Reading
 * the minutes' provenance as the span's is precisely the bug this function
 * exists to undo, and a `??` here would reintroduce it quietly.
 */
export function hasPublishableSpan(duration: DurationEvidence): boolean {
  return duration.spanSource !== undefined && duration.spanSource !== "invented";
}
