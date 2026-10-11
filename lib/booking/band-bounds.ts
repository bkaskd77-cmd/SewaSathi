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
/**
 * How we know which product a booking is.
 *
 * `inherited` IS NOT THE PARENT'S OWN SOURCE, and the distinction is the point.
 * A guarantee visit copies the band of the job it is putting right, so the
 * product is known — but nobody named it for THIS booking: the model, matcher
 * or customer that named the parent said nothing about the callback. Copying
 * their answer across would manufacture a statement nobody made.
 *
 * It is also what lets the duration loop avoid double-counting. A guarantee
 * visit is the same fault revisited, so its duration is not independent
 * evidence about that sub-band, and the filter needs a column that says so.
 *
 * `professional` IS THE ANSWER FROM THE ONE PERSON WHO ACTUALLY SAW THE JOB,
 * and it exists because the other four can all come out empty. The customer may
 * say "not sure" on purpose and the category picker asks nothing at all, so a
 * booking can reach completion with no product — and then it teaches the
 * duration loop, the per-product bands and the span nothing whatsoever. The
 * professional who just finished it knows. It is recorded as its own source
 * rather than as `customer`, because who said so is exactly what a provenance
 * column is for: an answer from somebody standing in the room after the work is
 * better evidence than a guess from somebody describing it beforehand, and
 * folding the two together would lose that for ever.
 *
 * It is NOT a price correction and must never be read as one. A correction says
 * "this is a different job from the one that was booked", moves the band and
 * needs the customer to agree before work starts. This names a job nobody ever
 * classified, after the work, and `freeze_booking_band` pins `band_min` on
 * every update so it cannot move a rupee — checked, not assumed.
 *
 * One list written twice with `bookings_band_source_check`; the db suite
 * compares them.
 */
export const BAND_SOURCES = [
  "model",
  "matcher",
  "customer",
  "inherited",
  "professional",
] as const;

/**
 * The subset a BROWSER may claim, which is not the same list.
 *
 * `inherited` is written by `lib/data/claims.ts` under the service role when a
 * guarantee visit copies the band of the job it is putting right. Nothing a
 * customer sends can legitimately be that, so `createBooking`'s schema is
 * built from this and never from `BAND_SOURCES` — the actor comes from the
 * session, never from the caller, and provenance is exactly the kind of field
 * where believing the caller costs you the column's meaning.
 *
 * FOUND BY A TEST THAT PINNED THE OTHER LIST'S EXACT CONTENTS, which is why
 * that test is written the way it is: widening `BAND_SOURCES` for the column's
 * sake would silently have widened what a browser may assert, because the two
 * had been one array. The same shape as the bug its comment already records —
 * a schema nobody widened — with the direction reversed.
 *
 * `professional` IS OUT FOR THE SAME REASON AND NOT A WEAKER ONE. The
 * professional's answer arrives through a server action that re-reads the
 * session, proves the job is theirs, and writes under the service role — the
 * `declineJob` shape. A `band_source` arriving on a fresh booking POST claiming
 * to be a professional's reading is a customer asserting the most trustworthy
 * provenance we have about their own price.
 */
export const REQUESTABLE_BAND_SOURCES = [
  "model",
  "matcher",
  "customer",
] as const satisfies readonly BandSourceName[];

type BandSourceName = (typeof BAND_SOURCES)[number];

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

/**
 * May this professional name the product on this job?
 *
 * AFTER THE WORK, AND ONLY WHEN NOBODY NAMED IT. Both halves matter:
 *
 *   * NOBODY NAMED IT. A booking that already carries a product has an answer
 *     from whoever gave it, and overwriting that would turn a provenance column
 *     into a record of who answered last. A professional who thinks the product
 *     is WRONG has `proposeBandCorrection`, which moves the band and asks the
 *     customer, because that is a question about money.
 *   * AFTER THE WORK. `in_progress` is the earliest honest moment — before it
 *     the professional is guessing from the same description the customer wrote,
 *     which is what the model already did. `completed` stays open because this
 *     is the one chance: the job is finished, nothing else will ever ask, and a
 *     classification is not a thing that goes stale.
 *
 * A SURVEY TRADE SELLS NO PRODUCTS, so there is nothing to choose between —
 * the same exclusion `bandCoverage` makes, for the same reason.
 *
 * Pure, so the screen and the server cannot disagree about when the panel
 * exists: a link on a job the server will refuse is worse than no link.
 */
export function canNameBand(input: {
  status: string;
  bandSlug: string | null;
  quoteModel?: string | null;
}): boolean {
  if (input.quoteModel === "survey") return false;
  if (input.bandSlug) return false;
  return input.status === "in_progress" || input.status === "completed";
}
