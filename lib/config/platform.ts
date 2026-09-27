import { RATING_PRIOR_COUNT } from "@/lib/provider";

/**
 * How much evidence a number needs before it goes on the front page.
 *
 * IN `lib/config/` BECAUSE IT IS A PRODUCT DECISION, not a query detail — and
 * because `lib/data/platform.ts` is `server-only`, which would put these
 * constants out of reach of the tests that pin them.
 *
 * A FLOOR IS NOT WHAT MAKES A NUMBER HONEST; the rows behind it are. Reading
 * the live database found 26 of 28 "verified" professionals were seeded
 * fixtures — a floor of 25 would have passed and put "28 ID-verified
 * professionals" on the landing page. The filter comes first, the floor second.
 */
export const STAT_FLOORS = {
  /**
   * Below twenty-five, "professionals" is a list of people rather than a
   * marketplace, and a reader does the arithmetic on what the number implies.
   */
  professionals: 25,
  /**
   * Below a hundred, the count says more about our launch than about whether
   * anybody should trust us.
   */
  households: 100,
  /**
   * BORROWED, NOT INVENTED. `RATING_PRIOR_COUNT` is the point at which a
   * professional's own average outweighs the prior, and "is this evidence yet"
   * is the same question whether it is asked about one listing or about the
   * whole platform. One constant, asked twice — a second number here would
   * drift from it the first time either moved.
   */
  ratedJobs: RATING_PRIOR_COUNT,
} as const;

/**
 * How many bookings a category needs in a week before the count is worth
 * printing on its card.
 *
 * SAME RULE AS THE STRIP ABOVE, one level down. "312 booked this week" was
 * invented and is gone; the replacement is real, and a real number can still
 * mislead — "2 booked this week" on a card invites the reader to conclude
 * something about demand from a sample that supports no conclusion at all.
 *
 * Twenty, because below it the figure describes how new we are rather than how
 * busy the trade is, and a customer reads it as the second.
 *
 * BELOW THE FLOOR THE CARD SHOWS NOTHING EXTRA — not "0 booked", not "fewer
 * than 20". The price line it already carries is true at any volume, and an
 * absence is the honest shape for a number we are not ready to stand behind.
 */
export const CATEGORY_COUNT_FLOOR = 20;
