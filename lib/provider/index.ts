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
  hasPublishableMinutes,
  hasPublishableSpan,
  hasRating,
  hasResponse,
  rankedRating,
  ratingEvidence,
  type DurationEvidence,
  type RatingEvidence,
  type StatEvidence,
} from "./measured";

/*
 * The decay rule itself, which the PRODUCT does not call — `refresh_provider_stats`
 * is the aggregate half and the columns are what every screen reads. It is
 * exported because the tests comparing the two halves were reaching into
 * `./recency` directly, and a module with one public entry does not have two.
 */
export {
  RATING_HALF_LIFE_DAYS,
  ageInDays,
  recencyWeight,
  recencyWeightedRating,
  type DatedRating,
  type RecencyWeighted,
} from "./recency";

export {
  REFUSAL_REASON_CODES,
  isRefusalReasonCode,
  type RefusalReasonCode,
  fitRank,
  isBookable,
  jobFit,
  showsInList,
  type Fit,
  type FitInput,
  type FitReason,
} from "./fit";

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

/*
 * The published enforcement ladder.
 *
 * THROUGH THE ENTRY LIKE EVERYTHING ELSE HERE, and the linter is what made that
 * happen rather than a resolution to remember: `lib/data/enforcement.ts` reached
 * `./enforcement` directly, `no-restricted-imports` refused it, and `npm run
 * verify` stopped before anything could be committed. Which is rule 2 working
 * exactly as written — what each step of the ladder costs is one decision, and a
 * second caller reaching past this file is a second place that can disagree
 * about whether step 4 hides a listing.
 */
export {
  ENFORCEMENT_STEPS,
  blocksDirectBooking,
  canLift,
  closesOpenPool,
  forcesDigitalSettlement,
  hidesListing,
  holdsPayout,
  isEnforcementStep,
  isRemoved,
  type Enforcement,
  type EnforcementStep,
} from "./enforcement";
