/**
 * The provider module's public surface: what a professional controls about
 * their own listing, and the rules that bound it.
 *
 * Three things live here and they are bounded differently on purpose. A rate is
 * CLAMPED, because a figure outside the band is usually honest pricing against
 * a band we drew badly. Availability DECAYS, because a flag nobody can leave
 * on for ever is the only version that stays true. And being on a job is
 * DERIVED, because it is the one of the three we can verify.
 *
 * Isomorphic — the dashboard renders these decisions beside the controls, so
 * nothing here may import `server-only`. The reads and writes live in
 * `lib/data/`.
 */

export {
  bandForTrades,
  clampRate,
  quoteFloor,
  type RateVerdict,
} from "./rates";

export {
  OFFER_MIN_SAMPLE,
  OVERBOOK_MIN_OFFERS,
  RATING_PRIOR_COUNT,
  RATING_PRIOR_MEAN,
  bayesianRating,
  displayRating,
  hasAnsweredRecord,
  hasCompletion,
  hasOverbookRecord,
  hasPublishableDuration,
  hasRating,
  hasResponse,
  type DurationEvidence,
  type StatEvidence,
} from "./measured";

export {
  blocksBooking,
  canServeAt,
  servingWhen,
  type ServingInput,
  type ServingRefusal,
  type ServingVerdict,
} from "./serving";

export {
  BUSY_PRESETS,
  DAY_ENDS_HOUR,
  availableUntil,
  busyUntil,
  canTakeWorkNow,
  endOfWorkingDay,
  isBusyPreset,
  landsSameDay,
  minutesRemaining,
  providerState,
  type Availability,
  type BaseAvailability,
  type BusyPreset,
  type ProviderStateInput,
} from "./availability";
