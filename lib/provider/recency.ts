/**
 * A rating that remembers when it was earned.
 *
 * WHAT A FLAT MEAN GETS WRONG. `rating_avg` is `avg(rating)` over every
 * published review ever written, so a plumber who was excellent in 2024 and has
 * been mediocre since reads the same as one who improved — and the customer
 * deciding who walks into their house is given the average of two different
 * people. Quality is a fact about somebody NOW, and a mean over all time is a
 * fact about their history.
 *
 * IT COMPOSES WITH `bayesianRating` AND DOES NOT REPLACE IT, because the two
 * answer different complaints. The prior handles a THIN sample — a 5.0 from
 * three friends. This handles a STALE one. A 5.0 from three reviews two years
 * ago is both, and the composition is what catches it: decay produces a
 * weighted mean AND a weighted COUNT, and it is the weighted count that goes
 * into the prior. Feeding the prior the raw count would leave an old sample at
 * full confidence while its average drifted — the figure would move and the
 * certainty behind it would not, which is the worse half of the bug.
 *
 * Pure and dependency-free, like `ranking.ts` and `duration-promotion.ts`: it
 * is a product judgement about what a customer reads, and it has to be testable
 * without a database. `refresh_provider_stats` implements the same rule in SQL
 * because ranking needs it as an aggregate; one fixture in the db suite runs
 * both and compares them, which is the arrangement `materialsRead` and
 * `enforce_claim_refund` already use and the one that was missing when those
 * two last diverged.
 */

/**
 * How long until a review counts half.
 *
 * A YEAR, AND THE ANCHOR IS THE OTHER TWO WINDOWS IN THIS PRODUCT. A published
 * price band is re-proposed over `PROPOSAL_WINDOW_DAYS` (180) because "a price
 * is a fact about a market and goes stale"; a duration has NO window at all,
 * because how long it takes to clear a blockage is a fact about the work and
 * does not. A tradesperson's quality sits between the two — it changes, but
 * slowly, and more slowly than a market price.
 *
 * HALVING FASTER IS THE REAL RISK HERE, not halving too slowly. On a catalogue
 * this thin a six-month half-life would let one recent job swing somebody's
 * standing, which is the 5.0-from-three-friends problem arriving through the
 * other door — and the professional has no way to answer it except by waiting.
 * Slow decay errs toward the incumbent; fast decay errs toward noise, and noise
 * is what the prior exists to suppress.
 */
export const RATING_HALF_LIFE_DAYS = 365;

/** One review, reduced to what the rule needs. */
export type DatedRating = {
  rating: number;
  /** Days since it was written. Negative is clamped — see `recencyWeight`. */
  ageDays: number;
};

/**
 * What one review is worth today.
 *
 * EXPONENTIAL RATHER THAN A CLIFF. A cutoff at twelve months makes a review
 * worth everything on day 364 and nothing on day 366, so a professional's
 * rating lurches on a date nobody can see — the kind of threshold
 * `/providers/standards` refuses to have unpublished. Decay is continuous, so
 * no single day changes anything a person would notice.
 *
 * NOTHING IS EVER WORTH MORE THAN ONE. A clock skew or a row stamped in the
 * future would otherwise amplify a review above every other, which is a way to
 * buy a rating with a wrong timestamp.
 */
export function recencyWeight(ageDays: number): number {
  if (!Number.isFinite(ageDays)) return 0;
  const age = Math.max(0, ageDays);
  return 0.5 ** (age / RATING_HALF_LIFE_DAYS);
}

export type RecencyWeighted = {
  /** The weighted mean, or null when nothing has any weight left. */
  avg: number | null;
  /**
   * The summed weight — an EFFECTIVE count, not a row count.
   *
   * This is what goes to `bayesianRating`, and it is the whole point: twenty
   * reviews from three years ago carry about two and a half reviews' worth of
   * confidence, so the prior pulls them back toward the mean exactly as it
   * would for somebody with two and a half reviews. The certainty decays with
   * the figure instead of outliving it.
   */
  weight: number;
};

/**
 * The weighted mean and the weight behind it.
 *
 * NULL RATHER THAN A NUMBER WHEN NOTHING IS LEFT, which is rule 6 in the shape
 * it takes here: reviews so old that every weight has underflowed are not
 * evidence of a bad rating or a good one, and returning 0 would render as the
 * worst possible score. The caller asks `hasRating` and says "not rated".
 */
export function recencyWeightedRating(
  reviews: readonly DatedRating[],
): RecencyWeighted {
  let weighted = 0;
  let weight = 0;

  for (const review of reviews) {
    const w = recencyWeight(review.ageDays);
    weighted += review.rating * w;
    weight += w;
  }

  return { avg: weight > 0 ? weighted / weight : null, weight };
}

/** Days between two instants, as the rule counts them. */
export function ageInDays(writtenAt: Date | string, now: Date): number {
  const then = new Date(writtenAt).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}
