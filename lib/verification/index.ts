/**
 * The verification module's public surface.
 *
 * Everything outside `lib/verification/` imports from here, enforced by
 * `no-restricted-imports` — the same rule as `lib/booking` and `lib/auth`, and
 * for the same reason: a caller that reaches into `match-keys.ts` directly is
 * a second place that knows how a key is built, and the day the fold changes,
 * the keys computed in the two places stop agreeing. Match keys only work if
 * every one of them was made the same way.
 *
 * ISOMORPHIC, deliberately and entirely. The application form runs on a cheap
 * Android phone with a bad connection, and it has to be able to judge a
 * photograph and warn about an obvious duplicate without a round trip. Nothing
 * under here imports `server-only` and nothing may: the hashing of match keys
 * and every database read live in `lib/data/verification.ts`, which is where
 * the server-only boundary is.
 */

export {
  MATCH_WEIGHTS,
  accountKey,
  documentKey,
  matchKeysFor,
  nameKeys,
  normaliseDigits,
  type MatchKey,
  type MatchKeyInput,
  type MatchKeyKind,
} from "./match-keys";

export {
  CAPTURE_THRESHOLDS,
  captureQuality,
  judgeCapture,
  measureCapture,
  type CaptureMeasurement,
  type CaptureProblem,
  type CaptureVerdict,
} from "./capture";

export {
  CONSENT_POINTS,
  CONSENT_SCOPE,
  CONSENT_VERSION,
  consentCovers,
  newConsent,
  type ConsentPoint,
  type ConsentRecord,
} from "./consent";

export {
  identityAdapter,
  identityMatchingIsLive,
  manualIdentity,
  type FaceMatchInput,
  type FaceMatchResult,
  type IdentityAdapter,
  type LivenessResult,
} from "./identity";

export {
  PROBATION,
  canAcceptAnotherJob,
  eligibleForEmergencyPool,
  judgeProbation,
  type ProbationInput,
  type ProbationVerdict,
  type ProviderStanding,
} from "./probation";

export {
  competenceSatisfied,
  documentsFor,
  knownTrade,
  requiredDocumentsFor,
  tradeHasCtevt,
  type DocumentKind,
  type DocumentRequirement,
} from "./requirements";

export {
  queuePriority,
  scoreApplication,
  type PriorityInput,
  type ReferenceOutcome,
  type RiskBand,
  type RiskEvidence,
  type RiskInput,
  type RiskVerdict,
} from "./risk";
