import type { Provider } from "@/lib/data/providers";
import {
  bayesianRating,
  fitRank,
  hasCompletion,
  hasOverbookRecord,
  hasRating,
  hasResponse,
  type Fit,
} from "@/lib/provider";

/*
 * `bayesianRating` moved to `lib/provider/measured.ts` — it is the archetype
 * every other rule in that file copied, and the cards need it too. Re-exported
 * here so the ranking's own callers and tests keep one import.
 */
export { bayesianRating } from "@/lib/provider";

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
export const WITHDRAWAL_RANKING_PENALTY_MAX = 0.12;
/*
 * NOT MONEY. This is a subtraction from a relevance score — how far down the
 * list somebody appears — and nothing anywhere converts it into rupees. It is
 * named for what it costs because "penalty" beside a number reads as a fine,
 * and a professional who believed we fined them for withdrawing would be
 * right to leave.
 */
/** Phantom clean jobs, so a thin record cannot swing the rate. */
const WITHDRAWAL_PRIOR = 5;
/** The rate at which the full penalty applies. One job in five is a pattern. */
const WITHDRAWAL_RATE_CEILING = 0.2;

/**
 * What an overbooking record costs, and why it is half a withdrawal's.
 *
 * A miss is somebody who OFFERED to fit a customer in beside a job they already
 * held and then could not reach them in the window. They turned up to work;
 * they were trying to take more of it. Scoring that as hard as accepting a job
 * and pulling out of it would teach every professional the safe move is never
 * to offer — and the offer is the only reason the second customer got a slot at
 * all. So the ceiling is 0.06, half of WITHDRAWAL_RANKING_PENALTY_MAX, and it
 * is a ranking subtraction like that one: never money, never a fine.
 */
export const OVERBOOK_RANKING_PENALTY_MAX = 0.06;
/** Phantom clean offers, so the tenth offer is not a cliff. */
const OVERBOOK_PRIOR = 5;
/** The miss rate at which the full penalty applies. */
const OVERBOOK_RATE_CEILING = 0.3;

/** Ratings below this are treated as the floor of the useful range. */
const RATING_FLOOR = 3.5;
/** Above this many jobs, more jobs stop counting. */
const VOLUME_CEILING = 300;
/** A reply slower than this scores zero, not negative. */
const RESPONSE_CEILING_MINUTES = 120;
/**
 * What a professional nobody has timed is worth on the response axis.
 *
 * Halfway, so an unmeasured listing sits between the fast and the slow rather
 * than at either end. Scoring it 1.0 would let anybody buy the top of an
 * emergency search by being new; scoring it 0 is what the product did until
 * now, and it put every real professional below every fixture.
 */
const UNMEASURED_RESPONSE = 0.5;

/**
 * What a professional nobody has given a job to is worth on completion.
 *
 * `completion_rate` DEFAULTS TO 100, so before this a listing with no record at
 * all scored 1.0 — the maximum — and outranked a real professional at 96% on
 * that axis. The default was doing the work of a measurement, in the direction
 * that flatters whoever has done the least.
 *
 * Mid-scale for the same reason as `UNMEASURED_RESPONSE`: an unknown belongs
 * between the good and the bad, not at either end.
 */
const UNMEASURED_COMPLETION = 0.5;

/*
 * WHAT EACH STATE IS WORTH, and the two new rows carry more weight than
 * anything else here: availability is 0.40 of an emergency search, the largest
 * single term in that blend, so the spread between `now` and `scheduled` moves
 * somebody further than any other number in the product.
 *
 * `on_job` SCORES LIKE `today`, NOT LIKE `scheduled`. Somebody finishing a job
 * at 3pm genuinely can come later today, and demoting them for working would
 * punish the exact behaviour the platform exists to produce. They drop out of
 * the "available now" filter and no further.
 *
 * `scheduled` SITS BETWEEN THEM, AND IT USED TO SIT ON THE FLOOR WITH `busy`.
 * Those two are not the same kind of answer. `busy` is a declared refusal —
 * "not taking work" — and belongs at the bottom. `scheduled` is the absence of
 * a claim about today: they are bookable, for a slot, in the ordinary way. A
 * professional who is perfectly willing to come on Thursday was ranking level
 * with one who had said no, which is the wrong pairing on a platform whose
 * whole job is to find somebody who will come.
 *
 * It was also the DEFAULT, which is what made it expensive. `providers
 * .availability` defaults to `scheduled` and the approval path never set it,
 * so every real professional started on the floor and stayed there until they
 * found the toggle — rule 6, a column default read as a fact, and the fact it
 * was read as was "this person barely works". Approval now writes `today`
 * explicitly and clearing both stamps now writes `scheduled` explicitly, so
 * this number only ever scores something somebody actually said.
 *
 * 0.35 rather than 0.55: raising it is not promoting it. They have not claimed
 * they come the same day, and somebody who has should still be ahead.
 *
 * `busy` costs them nothing beyond this: `/providers/standards` publishes
 * "Turning work down. You are allowed to be busy" under *What is never a
 * signal*, and no counter anywhere reads a busy window.
 */
const AVAILABILITY_SCORE: Record<Provider["availability"], number> = {
  now: 1,
  on_job: 0.55,
  busy: 0.15,
  today: 0.55,
  scheduled: 0.35,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));


/**
 * How much this professional's record of pulling out costs them, 0 to
 * WITHDRAWAL_RANKING_PENALTY_MAX. Exported so a future provider dashboard can show
 * somebody the number rather than leaving them to guess why work dried up.
 */
export function withdrawalRankingPenalty(stats: Provider["stats"]): number {
  if (stats.withdrawals <= 0) return 0;
  const rate = stats.withdrawals / (stats.jobsAccepted + WITHDRAWAL_PRIOR);
  return WITHDRAWAL_RANKING_PENALTY_MAX * clamp01(rate / WITHDRAWAL_RATE_CEILING);
}

/**
 * How much a record of overbooking and then missing costs, 0 to
 * OVERBOOK_RANKING_PENALTY_MAX.
 *
 * THE FLOOR IS THE POINT. `hasOverbookRecord` gates the whole thing on
 * OVERBOOK_MIN_OFFERS, because a ratio over a handful of offers is not a
 * measurement and rule 6 does not stop at columns with numeric defaults — one
 * miss out of two offers reads as a 50% failure rate and is statistically
 * nothing. Below the floor this returns exactly 0, the same as a clean record,
 * and the two are told apart in the DATA (`overbookOffers`) rather than by
 * inventing a difference in the score.
 *
 * Above the floor it is the shape `withdrawalRankingPenalty` already uses: a
 * rate with a prior, so the qualifying edge is soft. At exactly ten offers one
 * miss is 1/15, a small subtraction rather than a cliff out of nothing.
 */
export function overbookRankingPenalty(stats: Provider["stats"]): number {
  if (!hasOverbookRecord(stats)) return 0;
  if (stats.overbookMisses <= 0) return 0;
  const rate = stats.overbookMisses / (stats.overbookOffers + OVERBOOK_PRIOR);
  return OVERBOOK_RANKING_PENALTY_MAX * clamp01(rate / OVERBOOK_RATE_CEILING);
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

  const completion = hasCompletion(stats)
    ? clamp01(stats.completionRate / 100)
    : UNMEASURED_COMPLETION;

  const availability = AVAILABILITY_SCORE[provider.availability] ?? 0.15;

  /*
   * AN UNMEASURED RESPONSE TIME SCORES NEUTRAL, NOT ZERO.
   *
   * `avg_response_minutes` defaults to 120, which is exactly
   * RESPONSE_CEILING_MINUTES — so a professional nobody has ever timed scored
   * zero on this, forever, indistinguishable from somebody measured at two
   * hours. Nothing computes the column from real bookings yet, which meant
   * every real approved professional forfeited the whole 0.25 of the emergency
   * blend while the seeded fixtures at 12 minutes kept 0.90. Real people ranked
   * below demo rows.
   *
   * The fix is the shape `bayesianRating` already uses for the same problem:
   * with no evidence, score like an unknown rather than like the worst case.
   * `UNMEASURED_RESPONSE` is deliberately mid-scale — it neither rewards nor
   * punishes a listing for being new.
   */
  const response = hasResponse(stats)
    ? clamp01(1 - stats.avgResponseMinutes / RESPONSE_CEILING_MINUTES)
    : UNMEASURED_RESPONSE;

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
  score -= withdrawalRankingPenalty(provider.stats);
  score -= overbookRankingPenalty(provider.stats);

  return { score, parts };
}

/**
 * Rank a list. Stable: equal scores fall back to id, so the same query gives
 * the same order on every render and pagination cannot repeat a card.
 */
export type RankOptions = {
  urgency?: string | null;
  area?: string | null;
  /**
   * Can each of these professionals do THIS job?
   *
   * A CALLBACK RATHER THAN DATA, because deciding it needs the windows each
   * professional already holds and this module is pure — `lib/data/providers.ts`
   * reads the rows, `jobFit` composes the answer, and this only orders by it.
   *
   * Omitted means nobody asked, and every row is treated as a plain yes. That
   * is the honest default: the alternative is inventing a slot the caller does
   * not have and getting a precise-looking answer about a guess.
   */
  fit?: (provider: Provider) => Fit;
};

export type RankedProvider = Provider & {
  relevance: number;
  /**
   * Why this row is or is not a plain yes for the job in hand.
   *
   * ALWAYS PRESENT, so a card never has to decide what an absent fit means.
   * Without a `fit` callback every row is `ok`, which is what the surfaces that
   * do not know the job were already assuming silently.
   */
  fit: Fit;
};

export function rankProviders(
  providers: Provider[],
  options: RankOptions = {},
): RankedProvider[] {
  const ranked = providers
    .map((provider) => ({
      ...provider,
      relevance: scoreProvider(provider, options).score,
      fit: options.fit?.(provider) ?? ({ fit: "ok" } as Fit),
    }))
    /*
     * FIT FIRST, THEN RELEVANCE, AND NEITHER REPLACES THE OTHER.
     *
     * Somebody whose window is already sold cannot be the best match however
     * well they score — the database refuses the insert, so ranking them first
     * spends the customer's tap on a button that cannot succeed. But within a
     * band the ordinary score still decides, so this never reorders two
     * professionals who are equally bookable. It is a tiebreak above the score,
     * not a replacement for it.
     *
     * NOT A FILTER. The row stays and carries its reason; a list that quietly
     * got shorter reads as a catalogue with nobody in it, and the customer
     * cannot tell "nobody covers this" from "everybody is busy on the day you
     * picked" — different problems, different next steps.
     */
    .sort((a, b) => {
      const byFit = fitRank(a.fit) - fitRank(b.fit);
      if (byFit !== 0) return byFit;
      return b.relevance === a.relevance
        ? a.id.localeCompare(b.id)
        : b.relevance - a.relevance;
    });

  /*
   * The newcomer slot is applied HERE, after scoring and before anybody reads
   * the list, so every surface that asks "who should this customer see?" gets
   * the same answer — the catalogue, the booking shortlist and the replacement
   * list. Two different ideas of who is on the first page is the bug nobody
   * can see. `sortProviders` re-sorts for an explicit choice, which correctly
   * undoes this: a customer who asked for cheapest first asked for exactly
   * that.
   */
  return withNewcomerSlot({
    ranked,
    /*
     * A BLOCKED NEWCOMER IS NOT PROMOTED, and this is the interaction that is
     * easy to miss. The slot exists so somebody untested is SEEN; moving one
     * into third place when they cannot take the job spends the reserved
     * position on a row the customer cannot act on, and teaches them the slot
     * is where the unbookable people are.
     */
    isNew: (provider) =>
      isNewProvider(provider.stats.jobsCompleted) &&
      provider.fit.fit !== "blocked",
    emergency: options.urgency === "emergency",
  });
}

export type SortOption = "relevance" | "rating" | "price" | "jobs";

/** The sorts a customer can pick instead of ours. */
export function sortProviders(
  providers: Provider[],
  sort: SortOption,
  options: RankOptions = {},
): RankedProvider[] {
  const ranked = rankProviders(providers, options);

  /*
   * THE FIT BAND SURVIVES AN EXPLICIT SORT, and that is a deliberate difference
   * from the newcomer slot, which does not.
   *
   * The slot is OUR opinion about who deserves exposure, so a customer who asks
   * for cheapest first is entitled to have it dropped — they asked for exactly
   * that ordering. Fit is not an opinion: somebody whose window is already sold
   * cannot be booked at any price, and "cheapest first" is a request about how
   * to order the options, not a request to be shown ones that do not exist.
   * Sorting them to the top would put the least bookable row in the position
   * the customer just said they trust most.
   */
  const byFitThen = (
    within: (a: RankedProvider, b: RankedProvider) => number,
  ) =>
    [...ranked].sort((a, b) => {
      const byFit = fitRank(a.fit) - fitRank(b.fit);
      return byFit !== 0 ? byFit : within(a, b);
    });

  switch (sort) {
    case "rating":
      return byFitThen(
        (a, b) =>
          bayesianRating(b.stats.ratingAvg, b.stats.ratingCount) -
          bayesianRating(a.stats.ratingAvg, a.stats.ratingCount),
      );
    case "price":
      return byFitThen((a, b) => a.baseRate - b.baseRate);
    case "jobs":
      return byFitThen((a, b) => b.stats.jobsCompleted - a.stats.jobsCompleted);
    default:
      return ranked;
  }
}

/* ------------------------------------------------------------------ *
 * The newcomer
 * ------------------------------------------------------------------ */

/**
 * A professional with no history has to be findable, or nobody ever becomes
 * the second kind.
 *
 * THE PROBLEM IS A LOOP, NOT A SCORE. A new professional ranks low because
 * they have no jobs, gets no jobs because they rank low, and leaves. Supply
 * never compounds. Meanwhile the card shows them as `0.0 (0)` directly beneath
 * somebody's 4.7 from 304, which reads as *worse than average* when the honest
 * reading is *not yet known*.
 *
 * SO THE FIX IS A RESERVED POSITION, NOT A BOOST, and the difference matters:
 *
 *   A boost inflates a number that is supposed to mean quality. It composes
 *   with six other weights, so nobody can later say why somebody ranked where
 *   they did, and it is a knob that invites turning — every turn silently
 *   moving the emergency blend too. Worst of all it scales: fifty newcomers
 *   with a boost is fifty inflated scores, and the list stops being a ranking.
 *
 *   A slot is bounded by construction. ONE newcomer appears per page, at a
 *   fixed position, however many exist. Nothing is inflated, every score still
 *   means what it meant, and the reason a professional is third is a sentence
 *   rather than an arithmetic reconstruction.
 *
 * THIRD, DELIBERATELY. Not first: the top result is what a customer trusts the
 * list for, and spending it on somebody untested spends the trust that makes
 * the list worth reading. Not tenth: nobody scrolls, so it would be exposure
 * in name only. Third is seen without displacing the two strongest matches.
 */
export const NEWCOMER_SLOT_INDEX = 2;

/**
 * Three completed jobs.
 *
 * NOT A DURATION. A professional with no jobs after sixty days is not
 * established, they are unbooked, and a clock would quietly retire them from
 * the slot at the moment they still need it most. Jobs are the thing that
 * actually ends the cold start.
 *
 * Three rather than ten because this is a different question from probation
 * (`PROBATION` in `lib/verification` — ten jobs, and about standing rather
 * than exposure). Three is where a rating begins to carry information and the
 * card has something true to show.
 */
export const NEWCOMER_MAX_JOBS = 3;

export function isNewProvider(jobsCompleted: number): boolean {
  return jobsCompleted < NEWCOMER_MAX_JOBS;
}

/**
 * Move the best newcomer into the reserved slot.
 *
 * NEVER ON AN EMERGENCY, and this is the constraint the whole design bends
 * around. Someone with a burst pipe at 2am is the worst possible person to
 * hand a first-timer to, and `EMERGENCY_WEIGHTS` already puts availability and
 * response at 0.65 precisely because that search is about who turns up rather
 * than who is best. Exposure is a thing to grant on an ordinary Tuesday.
 *
 * A newcomer who already ranks inside the slot is left alone — they earned the
 * position, and moving them DOWN to it would make the slot a ceiling. That is
 * the bug this shape most easily hides.
 *
 * Pure and generic over the row type, so it is testable without a database and
 * cannot accidentally read a field it should not.
 */
export function withNewcomerSlot<T>(input: {
  /** Already sorted, best first. */
  ranked: readonly T[];
  isNew: (item: T) => boolean;
  emergency: boolean;
}): T[] {
  const list = [...input.ranked];
  if (input.emergency) return list;
  if (list.length <= NEWCOMER_SLOT_INDEX) return list;

  const index = list.findIndex((item) => input.isNew(item));
  if (index === -1) return list;

  // Already at or above the slot: they got there on merit, leave them.
  if (index <= NEWCOMER_SLOT_INDEX) return list;

  const [newcomer] = list.splice(index, 1);
  list.splice(NEWCOMER_SLOT_INDEX, 0, newcomer);
  return list;
}


/* ------------------------------------------------------------------ *
 * Which weights are actually separating anybody
 * ------------------------------------------------------------------ */

/**
 * A weight, and how many listings have evidence behind it.
 *
 * WHY THIS IS WORTH A SCREEN. `rating` carries 0.30 — the largest single term
 * in the relevance blend — and `bayesianRating(0, 0)` returns the prior for
 * every listing nobody has rated. On the live data that is 29 of 30, so the
 * biggest weight in the product is currently a constant: it adds the same
 * number to everybody and separates nobody. `completion` and `response` sit at
 * their unmeasured sentinels for 27 of 30.
 *
 * None of that is a bug — it is what an honest degradation looks like, and it
 * is exactly what `UNMEASURED_COMPLETION` and `UNMEASURED_RESPONSE` are for.
 * What was missing is that it was invisible: the only way to know half the
 * blend was inert was to read this file and then go and count rows. Retuning
 * the weights is a product decision, and it should start from a number rather
 * than from somebody rediscovering this in six months.
 *
 * REPORTED, NEVER ACTED ON. Nothing here changes a score, and there is no
 * threshold at which a weight is "too unmeasured" — that judgement is the one
 * this exists to inform.
 */
export type WeightEvidence = {
  term: keyof RankingWeights;
  /** Its share of the relevance blend. */
  weight: number;
  /** Listings where this term is computed from something somebody measured. */
  measured: number;
  /** Listings considered, so the count above has its denominator. */
  total: number;
  /**
   * Can this term rest on a prior at all?
   *
   * FALSE FOR THE FACTS, and the distinction is the whole honesty of this
   * report. `availability` and `proximity` are facts about a stated window and
   * a ward — there is no "unmeasured" state for them, so reporting them as
   * fully measured is true rather than flattering.
   */
  canBeUnmeasured: boolean;
};

/**
 * Does this term have evidence behind it for this listing?
 *
 * ASKS `lib/provider/measured.ts`, NEVER ITS OWN TEST. `hasRating`,
 * `hasResponse` and `hasCompletion` are precisely what `scoreParts` branches
 * on, so this report cannot say "measured" about a term the scorer is
 * defaulting. That divergence has already happened once in this product — the
 * catalogue card gated the response time on `jobsCompleted` while `scoreParts`
 * gated it on `responseSamples`, and a screen and the ranking behind it
 * answered differently about the same person.
 *
 * `volume` IS ALWAYS MEASURED, AND THAT IS NOT A LOOPHOLE. Zero completed jobs
 * is a fact about somebody — they have completed none — not an absence of one.
 * `scoreParts` computes it straight from the count with no sentinel anywhere.
 * Reporting it as missing would be reading a true zero as an unknown, which is
 * rule 6 upside down.
 */
function termMeasured(
  term: keyof RankingWeights,
  stats: StatsOnly,
): boolean {
  switch (term) {
    case "rating":
      return hasRating(stats);
    case "completion":
      return hasCompletion(stats);
    case "response":
      return hasResponse(stats);
    // Facts, and a real zero. See the note above.
    case "volume":
    case "availability":
    case "proximity":
      return true;
  }
}

/** The three terms that have an unmeasured value to fall back to. */
const CAN_BE_UNMEASURED: ReadonlySet<keyof RankingWeights> = new Set<
  keyof RankingWeights
>(["rating", "completion", "response"]);

/**
 * Only the stats, because that is all this needs.
 *
 * A FULL `Provider` WOULD MEAN A FULL READ. The evidence question is about
 * `provider_stats` alone, and requiring the whole shape would force the caller
 * to fetch names, photos and service areas — or, worse, to loop `listProviders`
 * once per category, which is ten round trips to Singapore for a screen that
 * needs one.
 */
export type StatsOnly = Pick<
  Provider["stats"],
  "ratingCount" | "jobsAccepted" | "responseSamples"
>;

export function weightEvidence(
  providers: readonly { stats: StatsOnly }[],
  weights: RankingWeights = RELEVANCE_WEIGHTS,
): WeightEvidence[] {
  const terms = Object.keys(weights) as Array<keyof RankingWeights>;

  return terms
    .map((term) => ({
      term,
      weight: weights[term],
      measured: providers.filter((p) => termMeasured(term, p.stats)).length,
      total: providers.length,
      canBeUnmeasured: CAN_BE_UNMEASURED.has(term),
    }))
    // Heaviest first: the question being asked is "is the biggest weight
    // doing anything", so the biggest weight goes at the top.
    .sort((a, b) => b.weight - a.weight);
}
