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
 * TWO FLOORS NOW, AND ONLY ONE OF THEM ANSWERS THIS QUESTION. `quoted_min` used
 * to be our published floor; it is now the holding professional's own starting
 * price, so a professional starting at Rs 2,400 who does a Rs 1,500 job would
 * have read as evidence that OUR band is too high. `bandMin` is ours, frozen on
 * the booking at the moment it was made, and it is what `belowBandPct`
 * measures. `belowQuoteJobs` is the other question — the commission floor
 * biting on one person — and `commission_appeals` is what answers that.
 *
 * What to do with a high `belowBandPct`: move `basePriceMin` in the category
 * seed, set `pricingSource` to `observed` with the date and what it was derived
 * from, re-run `seed:sql`, apply the migration. The band changes for future
 * bookings only — every existing booking carries its own frozen copy, which is
 * what keeps this measurement answerable about the band that was actually
 * published rather than the one we have since moved to.
 *
 * PURE, like `ranking.ts` and `recommendations.ts`. The read that fills it is
 * `listPricingSignals` in `lib/data/payments.ts`, next to the appeal it exists
 * to balance; the judgement lives here so it can be tested without a database.
 */

export type PricingSignal = {
  categorySlug: string;
  settledJobs: number;
  /** Settled under OUR published floor. The band-review number. */
  belowBandJobs: number;
  /** Percent of settled jobs that landed under our published floor. */
  belowBandPct: number;
  /**
   * Settled under the holding professional's own starting price — the
   * commission floor biting. A different question, kept separate on purpose.
   */
  belowQuoteJobs: number;
  aboveBandJobs: number;
  /** Our published floor, as frozen onto these bookings. */
  bandMin: number;
  bandMax: number;
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
    signal.belowBandPct >= BAND_REVIEW_THRESHOLD_PCT
  );
}

