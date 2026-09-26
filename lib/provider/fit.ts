import type { Availability } from "./availability";
import {
  blocksBooking,
  canServeAt,
  type ServingRefusal,
  type ServingVerdict,
} from "./serving";

/**
 * Can this professional do THIS job — asked once, answered the same way
 * everywhere.
 *
 * WHAT WAS WRONG. `canServeAt`, `hasRoom` and `providerCapacity` all exist and
 * all run at claim time: `chooseProvider`, `book/actions.ts`, the provider job
 * list. **The catalogue never called any of them.** So `/services/plumbing`
 * could rank first somebody whose window was already promised to another
 * customer, the customer taps, and `enforce_slot_capacity` refuses the insert.
 * The list and the database disagreed about who was bookable, and the customer
 * found out at the confirm button.
 *
 * SO THIS IS A COMPOSITION, NOT A SECOND OPINION. Every branch below delegates
 * to a function that already decides this somewhere else — the point is that
 * five surfaces stop each deciding it themselves. Two implementations of an
 * eligibility rule diverge the moment one is edited, and the divergence is
 * invisible until somebody's booking is refused.
 *
 * THREE ANSWERS, NOT TWO, AND THE MIDDLE ONE IS THE IMPORTANT ONE.
 * `blocksBooking` already knows the difference between "this cannot be booked"
 * and "this can be booked but the customer should be told" — being on a job at
 * 11am says nothing about Thursday. A binary gate would have thrown that away
 * and either hidden bookable professionals or shown unbookable ones.
 *
 * `caution` IS WHY NOBODY IS SILENTLY DROPPED. A shorter list with no
 * explanation reads as a thin catalogue and hides supply that is real; the row
 * stays, carries its reason, and sorts below the people with no caveat.
 *
 * WHAT IS DELIBERATELY NOT A FIT REASON: being outside the customer's ward.
 * Proximity is a SCORE term (ward 1.0, same city 0.6, elsewhere 0.25) and
 * `recommendations.ts` already surfaces the same fact as a visible `reach`
 * tier. Making it a gate as well would count it twice and shrink the list for
 * the customers with the fewest professionals near them — which is the
 * opposite of what a widening tier exists to do.
 *
 * Pure and dependency-free, like `serving.ts` and `measured.ts` beside it: it
 * decides what a customer is shown and whether a booking is offered, so it has
 * to be testable without a database.
 */

/**
 * Why this professional is not a plain yes for this job.
 *
 * `ServingRefusal` is reused rather than re-listed — `onJobNow`, `busyNow`,
 * `busyThen`, `full` already mean exactly the right things, and a parallel
 * union would be two vocabularies for one idea.
 */
export type FitReason =
  /** They do not do this trade at all. */
  | "notThisTrade"
  /** They have already turned this exact job down. */
  | "alreadyRefused"
  | ServingRefusal;

export type Fit =
  /** Bookable, nothing to say. */
  | { fit: "ok" }
  /**
   * Bookable, and the customer should be told why it is not a plain yes.
   * Shown with the reason, sorted below the plain yeses, never removed.
   */
  | { fit: "caution"; why: FitReason; freeFrom: Date | null }
  /**
   * Not bookable. The database or the policy would refuse it, so offering it
   * would spend the customer's patience on a button that cannot succeed.
   */
  | { fit: "blocked"; why: FitReason; freeFrom: Date | null };

export type FitInput = {
  provider: {
    /** Trades they are listed under. */
    categories: readonly string[];
    /** The COMPUTED state — see `providerState`, not the raw column. */
    availability: Availability;
    busyUntil?: Date | string | null;
  };
  job: {
    categorySlug: string;
    urgency?: string | null;
    /**
     * When the customer needs them: an instant, or null for as-soon-as-possible.
     *
     * NULL IS HONEST ON THE CATALOGUE, and this is the one place the two
     * moments differ. `/services/[slug]` is read before any slot is chosen, so
     * it genuinely does not know when — and `canServeAt` treats null as "now",
     * which is the right coarse question there ("could they come at all?").
     * The booking flow, dispatch and the replacement list all know the slot and
     * get the exact answer. Inventing a slot on the catalogue to get a
     * precise-looking answer would be precision about a guess.
     */
    when?: Date | string | null;
    /**
     * Is that window already at capacity?
     *
     * UNDEFINED MEANS NOBODY ASKED, which is not the same as "there is room" —
     * the same distinction `ServingInput.windowFull` draws. The catalogue does
     * not read held windows, so it passes undefined and gets an answer that
     * does not pretend to have checked.
     */
    windowFull?: boolean;
    /** Providers who have already refused this booking. */
    refusedBy?: readonly string[];
  };
  /** This professional's id, needed only for the refusal check. */
  providerId?: string;
  /** Injected for tests; defaults to now. */
  at?: Date;
};

export function jobFit(input: FitInput): Fit {
  const { provider, job } = input;

  /*
   * FIRST, because it is not a question of timing at all. The catalogue filters
   * by category in SQL so this can never fire there; it fires on
   * `chooseProvider`, where a provider id arrives from a browser and nothing
   * else asks whether they do this work.
   */
  if (!provider.categories.includes(job.categorySlug)) {
    return { fit: "blocked", why: "notThisTrade", freeFrom: null };
  }

  /*
   * A REFUSAL IS BLOCKING AND SILENT, and it is the one exclusion that is not
   * shown. `enforce_booking_immutability` refuses to reassign somebody who has
   * a `booking_refusals` row for this job, so offering them is a button that
   * cannot work — and telling a customer "this professional turned your job
   * down" is bruising to no purpose on a screen they are already unhappy to be
   * reading. `recommendations.ts` has dropped refusers silently since it was
   * written; this keeps that behaviour rather than changing it.
   */
  if (
    input.providerId &&
    job.refusedBy?.includes(input.providerId)
  ) {
    return { fit: "blocked", why: "alreadyRefused", freeFrom: null };
  }

  const verdict: ServingVerdict = canServeAt({
    state: provider.availability,
    busyUntil: provider.busyUntil,
    when: job.when,
    windowFull: job.windowFull,
    at: input.at,
  });

  if (verdict.ok) return { fit: "ok" };

  /*
   * `blocksBooking` DECIDES WHICH OF THE TWO IT IS, rather than this file
   * having an opinion. A full window blocks at every urgency because the
   * database refuses the insert; everything else blocks only an emergency,
   * because a non-emergency booking still works — the professional is told,
   * and the customer can hand it on if nobody answers inside the first-refusal
   * window.
   */
  const blocked = blocksBooking({ urgency: job.urgency, verdict });
  return {
    fit: blocked ? "blocked" : "caution",
    why: verdict.reason,
    freeFrom: verdict.freeFrom,
  };
}

/** Bookable at all — `ok` or `caution`, never `blocked`. */
export function isBookable(fit: Fit): boolean {
  return fit.fit !== "blocked";
}

/**
 * Should this row be rendered to the customer?
 *
 * Everything except a refusal. The gate is visible by default precisely because
 * a list that quietly got shorter reads as a catalogue with nobody in it, and
 * the customer cannot tell the difference between "nobody covers this" and
 * "everybody is busy on the day you picked" — which are completely different
 * problems with completely different next steps.
 */
export function showsInList(fit: Fit): boolean {
  return fit.fit === "ok" || fit.why !== "alreadyRefused";
}

/**
 * Sort key: plain yeses first, then cautions, and blocked last.
 *
 * ORDERING RATHER THAN FILTERING is what keeps the list honest. Within each
 * band the ordinary relevance score still decides, so this never reorders two
 * professionals who are equally bookable — it only stops somebody who cannot
 * take the job sitting above somebody who can.
 */
export function fitRank(fit: Fit): number {
  if (fit.fit === "ok") return 0;
  if (fit.fit === "caution") return 1;
  return 2;
}


/* ------------------------------------------------------------------ *
 * Why somebody turned it down
 * ------------------------------------------------------------------ */

/**
 * The closed set of refusal reasons, so refusals can be COUNTED and not only
 * read one at a time.
 *
 * WHAT ALREADY EXISTED. Both refusal paths capture free text and
 * `provider_stats.declines` already counts refusals. What was missing is that
 * prose cannot be aggregated: "this professional keeps refusing work in
 * Bhaktapur" was a sentence somebody would have to notice by reading rows one
 * at a time. The free text stays — it is where somebody says the thing this
 * list did not anticipate.
 *
 * A STATED PREFERENCE, NOT A JUDGEMENT, and that is why it is safe to act on
 * later where a rating is not. `tooFar` is somebody telling us where they will
 * not travel: checkable, theirs to change, and acting on it means not offering
 * work they have said they do not want. Nothing here is evidence about how well
 * anybody works.
 *
 * `price` IS NEVER A SIGNAL AGAINST ANYBODY. /providers/standards publishes
 * "charging under the band" and "turning work down" under *what is never a
 * signal*, and a professional saying a job is not worth the trip is telling us
 * our band may be wrong for that work — the same reading
 * `category_pricing_signals` takes. About our price, never about the person.
 */
export const REFUSAL_REASON_CODES = [
  "too_far",
  "wrong_job",
  "already_busy",
  "price",
  "other",
] as const;

export type RefusalReasonCode = (typeof REFUSAL_REASON_CODES)[number];

export function isRefusalReasonCode(
  value: unknown,
): value is RefusalReasonCode {
  return (REFUSAL_REASON_CODES as readonly string[]).includes(value as string);
}
