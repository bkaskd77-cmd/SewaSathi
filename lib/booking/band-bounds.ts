/**
 * What a job is allowed to cost, and which of three answers is in force.
 *
 * THE MIRROR OF `booking_band_bounds` IN POSTGRES. Both exist because both are
 * needed: the database is the rule that actually holds when four different
 * paths write a booking, and this is what the SCREENS read — a customer has to
 * see the figure before the booking exists, and `judgeFinalAmount` has to be a
 * pure function a test can drive without a database.
 *
 * THE DEFECT THIS CLOSES. The triage card asks which product a job is and shows
 * that product's published range; the number was then lost at the first link,
 * because `/services/[slug]` rendered the category band and `createBooking`
 * froze `categories.base_price_max`. A customer who answered "AC repair" read
 * 500-1,500 and was quoted 500-12,000. The card's promise was not the booking's
 * promise, which is the opposite of what the landing page says.
 *
 * ONLY A CUSTOMER-STATED BAND NARROWS. `model` and `matcher` are both OUR
 * reading of somebody's sentence: trusting the slug over the number the same
 * model produced would make the price wrong rather than merely wide, and wide
 * is the failure we already know how to live with.
 */

/**
 * Who named the product, most trustworthy first.
 *
 * ONE DEFINITION, BECAUSE THE TWO ENDS DRIFTED. `customer` shipped into the
 * booking query string when the ask landed, and `createBooking`'s schema
 * accepted only `model` and `matcher` — so the parse failed and the booking
 * came back as a validation error on the one path the ask exists to improve.
 * Every guard around the band held; the list that decides whether the booking
 * happens at all was the one nobody widened. It is exported so the schema, the
 * card and the test all read the same array.
 */
export const BAND_SOURCES = ["model", "matcher", "customer"] as const;

export type BandSource = (typeof BAND_SOURCES)[number];

/** A sub-band's published range, as `category_price_bands` holds it. */
export type BandRange = {
  slug: string;
  low: number;
  high: number;
};

export type BandBounds = {
  low: number;
  high: number;
  /**
   * The floor the customer's own statement set.
   *
   * A correction may raise the band and may lower the max, but never this. The
   * fee is charged on `max(final_amount, quoted_min)`, which is the whole
   * answer to under-reporting — a correction that could lower it would let a
   * professional name a cheaper PRODUCT instead of a smaller number.
   */
  statedLow: number;
  /** Which of the three answers this is, for a screen that wants to say so. */
  source: "category" | "stated" | "corrected";
};

export function bandBounds(input: {
  /** The trade's whole range. Always the fallback, never nothing. */
  category: { low: number; high: number };
  /** The product the customer named, if they named one. */
  stated?: BandRange | null;
  statedSource?: BandSource | null;
  /** The product the professional says it is, and whether the customer agreed. */
  corrected?: BandRange | null;
  correctionApproved?: boolean;
}): BandBounds {
  const stated =
    input.statedSource === "customer" && input.stated ? input.stated : null;
  const corrected = input.correctionApproved ? (input.corrected ?? null) : null;

  const statedLow = stated?.low ?? input.category.low;
  const inForce = corrected ?? stated;

  return {
    low: inForce?.low ?? input.category.low,
    high: inForce?.high ?? input.category.high,
    statedLow,
    source: corrected ? "corrected" : stated ? "stated" : "category",
  };
}

/**
 * May this correction be recorded at all?
 *
 * A correction whose whole range sits under the stated floor would write
 * `quoted_min` above `quoted_max`, and the table's own check would refuse it
 * with a message about nothing. The database raises the real sentence; this is
 * so a screen can say it before anybody taps.
 */
export function correctionFitsFloor(
  corrected: BandRange,
  statedLow: number,
): boolean {
  return corrected.high >= statedLow;
}
