/**
 * The provider module's public surface: what a professional controls about
 * their own listing, and the rules that bound it.
 *
 * Two things live here and they are bounded differently on purpose. A rate is
 * CLAMPED, because a figure outside the band is usually honest pricing against
 * a band we drew badly. Availability DECAYS, because a flag nobody can leave
 * on for ever is the only version that stays true.
 *
 * Isomorphic — the dashboard renders these decisions beside the controls, so
 * nothing here may import `server-only`. The reads and writes live in
 * `lib/data/`.
 */

export {
  bandForTrades,
  clampRate,
  type RateVerdict,
} from "./rates";

export {
  DAY_ENDS_HOUR,
  availabilityNow,
  availableUntil,
  endOfWorkingDay,
  minutesRemaining,
  type Availability,
} from "./availability";
