import type { Provider } from "@/lib/data/providers";

/**
 * Which professional to show first.
 *
 * This is the most consequential piece of product logic in the app: the person
 * reading the list is deciding who walks into their house, and almost nobody
 * scrolls past the first three. So the order is a deliberate blend, not a sort
 * by rating — and the weights live here, named and in one place, because they
 * are a product decision we expect to argue about and tune.
 *
 * Every component returns 0-1 and the weights in one profile sum to 1, so a
 * score is comparable across categories and readable when debugging.
 */

export type RankingWeights = {
  /** Confidence-weighted rating — see `bayesianRating`. */
  rating: number;
  /** Jobs completed, log-scaled. Volume is evidence, not a leaderboard. */
  volume: number;
  /** Share of accepted jobs actually finished. */
  completion: number;
  /** Available now / today / scheduled. */
  availability: number;
  /** How fast they typically reply. */
  response: number;
  /** Do they work in the ward the customer picked. */
  proximity: number;
};

/**
 * The default blend.
 *
 * rating 0.30 — the strongest single signal, but deliberately under a third:
 *   on its own it puts a 5.0 from three friends above a 4.8 from two hundred
 *   strangers. `bayesianRating` already pulls thin ratings toward the mean;
 *   this weight is applied after that.
 * availability 0.20 — a professional who cannot come is not a result, however
 *   good they are.
 * proximity 0.18 — travel is real time and real fuel in the Valley, and a
 *   plumber two wards away turns up sooner and charges less to get there.
 * volume 0.12 — evidence behind the rating. Log-scaled: the gap between 5 and
 *   50 jobs matters, the gap between 200 and 400 does not.
 * response 0.12 — how quickly you hear back, which is most of how the wait
 *   actually feels.
 * completion 0.08 — accepting a job and not finishing it is the worst thing a
 *   provider can do to a customer, so it is here, but it is nearly always high
 *   and rarely separates anyone.
 */
export const RELEVANCE_WEIGHTS: RankingWeights = {
  rating: 0.3,
  volume: 0.12,
  completion: 0.08,
  availability: 0.2,
  response: 0.12,
  proximity: 0.18,
};

/**
 * Emergency blend.
 *
 * Someone with a burst pipe or a dead switchboard does not care about a 0.2
 * rating difference; they care who picks up. Availability and response take
 * 0.65 between them, and rating drops to 0.12 — still enough to separate two
 * people who can both come now, not enough to put a 4.9 who is booked until
 * Thursday above a 4.4 who is fifteen minutes away.
 */
export const EMERGENCY_WEIGHTS: RankingWeights = {
  rating: 0.12,
  volume: 0.05,
  completion: 0.08,
  availability: 0.4,
  response: 0.25,
  proximity: 0.1,
};

/**
 * Added on top of the weighted score, not part of the blend.
 *
 * Verification is the platform's whole promise. It is also a filter, so this
 * is small on purpose — enough to break a tie in favour of the checked person,
 * not enough to bury a good unverified provider the customer chose to see.
 */
export const VERIFIED_BONUS = 0.05;

/**
 * What a withdrawal costs, in list position.
 *
 * A professional may pull out of a job they accepted — a van breaks down, a
 * job overruns, and a product that forbids it produces people who simply never
 * turn up, which is worse for the customer than an honest early no. Allowed is
 * not free, though: somebody was left waiting on a decision they had already
 * made, and the only lever that reaches a professional who is not reading a
 * dashboard is how often they are shown.
 *
 * SUBTRACTED, NOT BLENDED IN, for the same reason `VERIFIED_BONUS` is added
 * rather than weighted: the six weights describe how well somebody does the
 * work, and this describes whether they show up for it. Mixing them would mean
 * a withdrawal could be offset by being cheap or nearby, which is exactly the
 * trade we do not want to offer. It is capped at more than twice the
 * verification bonus, so a habitual withdrawer sinks below a comparable
 * unverified professional and stays there.
 *
 * A RATE, WITH A PRIOR, NOT A COUNT. Counting raw withdrawals punishes the
 * busiest people on the platform: one withdrawal in two hundred jobs is noise,
 * one in three is a pattern. The prior stops the reverse gaming too — somebody
 * with one accepted job and one withdrawal would otherwise read as a 100%
 * failure rate on a single data point, so five phantom clean jobs sit under
 * everybody until their own record outweighs them.
 */
export const WITHDRAWAL_PENALTY_MAX = 0.12;
/** Phantom clean jobs, so a thin record cannot swing the rate. */
const WITHDRAWAL_PRIOR = 5;
/** The rate at which the full penalty applies. One job in five is a pattern. */
const WITHDRAWAL_RATE_CEILING = 0.2;

/** Ratings below this are treated as the floor of the useful range. */
const RATING_FLOOR = 3.5;
/** Prior strength: a provider needs ~20 ratings before their own average wins. */
const RATING_PRIOR_COUNT = 20;
/** The mean a thin rating is pulled toward. */
const RATING_PRIOR_MEAN = 4.5;
/** Above this many jobs, more jobs stop counting. */
const VOLUME_CEILING = 300;
/** A reply slower than this scores zero, not negative. */
const RESPONSE_CEILING_MINUTES = 120;

const AVAILABILITY_SCORE: Record<Provider["availability"], number> = {
  now: 1,
  today: 0.55,
  scheduled: 0.15,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A rating you can compare across providers with different amounts of evidence.
 *
 * Standard Bayesian average: a 5.0 from 3 jobs lands near 4.57, a 4.8 from 200
 * stays at 4.77. That single line is what stops the newest provider with three
 * reviews from their cousin sitting at the top of every list.
 */
export function bayesianRating(average: number, count: number): number {
  return (
    (count * average + RATING_PRIOR_COUNT * RATING_PRIOR_MEAN) /
    (count + RATING_PRIOR_COUNT)
  );
}

/**
 * How much this professional's record of pulling out costs them, 0 to
 * WITHDRAWAL_PENALTY_MAX. Exported so a future provider dashboard can show
 * somebody the number rather than leaving them to guess why work dried up.
 */
export function withdrawalPenalty(stats: Provider["stats"]): number {
  if (stats.withdrawals <= 0) return 0;
  const rate = stats.withdrawals / (stats.jobsAccepted + WITHDRAWAL_PRIOR);
  return WITHDRAWAL_PENALTY_MAX * clamp01(rate / WITHDRAWAL_RATE_CEILING);
}

export type ScoreParts = Record<keyof RankingWeights, number>;

export function scoreParts(
  provider: Provider,
  options: { area?: string | null } = {},
): ScoreParts {
  const { stats } = provider;

  const rating = clamp01(
    (bayesianRating(stats.ratingAvg, stats.ratingCount) - RATING_FLOOR) /
      (5 - RATING_FLOOR),
  );

  const volume = clamp01(
    Math.log10(1 + stats.jobsCompleted) / Math.log10(1 + VOLUME_CEILING),
  );

  const completion = clamp01(stats.completionRate / 100);

  const availability = AVAILABILITY_SCORE[provider.availability] ?? 0.15;

  const response = clamp01(
    1 - stats.avgResponseMinutes / RESPONSE_CEILING_MINUTES,
  );

  // With no ward chosen, proximity is neutral for everyone rather than zero —
  // otherwise the term would just add noise to a list nobody has localised.
  let proximity = 0.6;
  if (options.area) {
    if (provider.serviceAreas.includes(options.area)) {
      proximity = 1;
    } else {
      const city = options.area.split("-")[0];
      proximity = provider.serviceAreas.some((a) => a.startsWith(`${city}-`))
        ? 0.6
        : 0.25;
    }
  }

  return { rating, volume, completion, availability, response, proximity };
}

export function scoreProvider(
  provider: Provider,
  options: { urgency?: string | null; area?: string | null } = {},
): { score: number; parts: ScoreParts } {
  const weights =
    options.urgency === "emergency" ? EMERGENCY_WEIGHTS : RELEVANCE_WEIGHTS;
  const parts = scoreParts(provider, options);

  let score = 0;
  for (const key of Object.keys(weights) as Array<keyof RankingWeights>) {
    score += weights[key] * parts[key];
  }
  if (provider.isVerified) score += VERIFIED_BONUS;
  score -= withdrawalPenalty(provider.stats);

  return { score, parts };
}

/**
 * Rank a list. Stable: equal scores fall back to id, so the same query gives
 * the same order on every render and pagination cannot repeat a card.
 */
export function rankProviders(
  providers: Provider[],
  options: { urgency?: string | null; area?: string | null } = {},
): Array<Provider & { relevance: number }> {
  return providers
    .map((provider) => ({
      ...provider,
      relevance: scoreProvider(provider, options).score,
    }))
    .sort((a, b) =>
      b.relevance === a.relevance
        ? a.id.localeCompare(b.id)
        : b.relevance - a.relevance,
    );
}

export type SortOption = "relevance" | "rating" | "price" | "jobs";

/** The sorts a customer can pick instead of ours. */
export function sortProviders(
  providers: Provider[],
  sort: SortOption,
  options: { urgency?: string | null; area?: string | null } = {},
): Array<Provider & { relevance: number }> {
  const ranked = rankProviders(providers, options);

  switch (sort) {
    case "rating":
      return [...ranked].sort(
        (a, b) =>
          bayesianRating(b.stats.ratingAvg, b.stats.ratingCount) -
          bayesianRating(a.stats.ratingAvg, a.stats.ratingCount),
      );
    case "price":
      return [...ranked].sort((a, b) => a.baseRate - b.baseRate);
    case "jobs":
      return [...ranked].sort(
        (a, b) => b.stats.jobsCompleted - a.stats.jobsCompleted,
      );
    default:
      return ranked;
  }
}
