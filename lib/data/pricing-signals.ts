/**
 * Is our published band right?
 *
 * The commission floor charges the fee on `max(final_amount, quoted_min)`,
 * which removes the motive to under-report — and quietly assumes the floor is
 * a fair number. Sometimes it is not. A category where a third of settled jobs
 * come in under its published minimum is not a category full of dishonest
 * professionals; it is a price WE got wrong, and every one of those jobs was
 * overcharged in fee by us.
 *
 * So the frequency is counted per category and never per person. Read the
 * other way it would become a list of people to penalise for our own
 * mispricing, which is the exact failure mode of every automated integrity
 * system that has ever been built badly.
 *
 * What to do with a high `belowFloorPct`: move `basePriceMin` in the category
 * seed, re-run `seed:sql`, apply the migration. The band changes for future
 * bookings only — every existing booking carries its own frozen copy.
 *
 * PURE, like `ranking.ts` and `recommendations.ts`. The read that fills it is
 * `listPricingSignals` in `lib/data/payments.ts`, next to the appeal it exists
 * to balance; the judgement lives here so it can be tested without a database.
 */

export type PricingSignal = {
  categorySlug: string;
  settledJobs: number;
  belowFloorJobs: number;
  /** Percent of settled jobs that landed under the published minimum. */
  belowFloorPct: number;
  aboveBandJobs: number;
  quotedMin: number;
  quotedMax: number;
  medianFinal: number;
  p25Final: number;
  p75Final: number;
};

/**
 * The share of jobs under the floor at which the band is the suspect rather
 * than the jobs. Not a threshold anything acts on automatically — nothing here
 * changes a price by itself — it is where the admin screen shouts.
 */
export const BAND_REVIEW_THRESHOLD_PCT = 20;

/** True when this category's floor should be looked at by a person. */
export function needsBandReview(signal: PricingSignal): boolean {
  // Below a handful of settled jobs the percentage is noise, and acting on
  // noise is how a correct band gets "corrected" into a wrong one.
  return (
    signal.settledJobs >= 10 &&
    signal.belowFloorPct >= BAND_REVIEW_THRESHOLD_PCT
  );
}

