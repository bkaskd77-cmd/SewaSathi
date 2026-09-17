/**
 * How long a job takes, and which of the three answers to that question wins.
 *
 * THREE NUMBERS EXIST FOR ONE BOOKING and they are deliberately not merged:
 *
 *   1. `estimated*` — ours, copied from the sub-band's researched figure and
 *      frozen at booking time like `band_min` beside it.
 *   2. `providerEstimated*` — theirs, written after they accepted and saw the
 *      job. It NEVER overwrites ours.
 *   3. `actual*` — what happened, written once at completion.
 *
 * Keeping all three is the whole point. The professional is standing in the
 * room and we are not, so their figure is the better one to schedule from —
 * but overwriting ours would destroy the only comparison that ever makes the
 * researched numbers better than a guess. Estimate against actual, per
 * sub-band, is the path from `duration_source: invented` to `researched` to
 * `observed`, and it does not exist if the columns collapse into one.
 *
 * Pure and dependency-free: the booking flow is a Client Component and the
 * scheduler is a Postgres trigger, and both have to agree with this file.
 */

/**
 * What the scheduler reserves when nothing is known.
 *
 * NAMED FOR WHAT IT IS — A HOLD, NOT AN ESTIMATE — and that distinction is the
 * whole reason a guessed duration is safe to use at all. A reservation nobody
 * reads makes no claim about anything. The moment this number reaches a screen
 * it becomes "about 2 hours", which is a default presented as a measurement,
 * and `hasPublishableDuration` is what stops that happening.
 *
 * 120 minutes, which is exactly what every booking held before duration
 * existed (`WORKING_HOURS.slotHours` is 2). So an unestimated booking behaves
 * today precisely as it behaved yesterday, and nothing regresses for the rows
 * that have no product.
 */
export const UNESTIMATED_HOLD_MINUTES = 120;

/**
 * Below this, a completion is not work.
 *
 * TEN MINUTES, and it exists because of what was actually in the database.
 * All four completed bookings in production when duration shipped had
 * `started_at` and `completed_at` between three and twenty-nine SECONDS apart
 * — they are walkthroughs by our own test accounts. Recording those as
 * durations would write numbers that look measured into the one table the
 * researched figures are eventually meant to come from, which is the same
 * mistake as 26 seeded "verified" providers nearly reaching the landing page.
 *
 * Mirrored by `floor_minutes` in `record_booking_duration()`.
 */
export const DURATION_PLAUSIBLE_MIN_MINUTES = 10;

/** Only the length. Deliberately not a whole booking row. */
export type BookingDuration = {
  /** Ours, from the sub-band. Null when no product was identified. */
  estimatedWorkingMinutes: number | null;
  estimatedElapsedDays: number | null;
  /** Theirs, after they saw it. Null until they say otherwise. */
  providerEstimatedWorkingMinutes?: number | null;
  providerEstimatedElapsedDays?: number | null;
};

/**
 * The minutes the scheduler should actually reserve.
 *
 * THE PROFESSIONAL'S FIGURE WINS, because they have seen the job. Then ours.
 * Then the hold — which is a reservation and not an answer, and callers that
 * need to know the difference ask `isEstimated` rather than comparing this
 * against 120.
 *
 * Mirrored by `public.booking_working_minutes()` in SQL, and
 * `npm run check:duration` fails if the two constants ever disagree — the
 * previous version of this rule was a hardcoded `interval '120 minutes'` in a
 * trigger with a comment asking the next reader to keep it in step by hand.
 */
export function workingMinutes(duration: BookingDuration): number {
  return (
    duration.providerEstimatedWorkingMinutes ??
    duration.estimatedWorkingMinutes ??
    UNESTIMATED_HOLD_MINUTES
  );
}

/** How many days the home is a building site. One unless somebody said more. */
export function elapsedDays(duration: BookingDuration): number {
  return (
    duration.providerEstimatedElapsedDays ?? duration.estimatedElapsedDays ?? 1
  );
}

/**
 * Does anybody actually know how long this takes?
 *
 * False means `workingMinutes` returned the hold. Every screen asks this
 * before saying anything about length — and then asks
 * `hasPublishableDuration` about the sub-band's provenance as well, because
 * "somebody wrote a number down" and "the number is worth telling a customer"
 * are different questions.
 */
export function isEstimated(duration: BookingDuration): boolean {
  return (
    duration.providerEstimatedWorkingMinutes != null ||
    duration.estimatedWorkingMinutes != null
  );
}

/** Is this a job that occupies a home past today? */
export function isMultiDay(duration: BookingDuration): boolean {
  return elapsedDays(duration) > 1;
}

/**
 * Is this completion long enough to have been work?
 *
 * Returns the minutes, or null when it is not. Null is the refusal, and the
 * caller records that refusal as a fact rather than letting a missing
 * measurement look the same as one nobody took.
 */
export function plausibleWorkedMinutes(
  startedAt: Date | string | null,
  completedAt: Date | string | null,
): number | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;

  const minutes = Math.ceil((end - start) / 60_000);
  return minutes < DURATION_PLAUSIBLE_MIN_MINUTES ? null : minutes;
}
