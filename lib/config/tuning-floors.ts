/**
 * How much evidence each tuning loop needs before anybody moves a number.
 *
 * WHY THIS EXISTS. Three loops in this product are deliberately unarmed —
 * ranking's weights, rotation among near-ties, and the triage prompt — and each
 * is unarmed for the same stated reason: nobody knows yet what the right answer
 * looks like here, and a constant chosen now would freeze a guess into the
 * codebase as a standard. `/admin/triage-accuracy` says it in those words.
 *
 * The cost of that correctness is that "when CAN we tune this?" lived nowhere.
 * It was a judgement somebody would have to make again from scratch, on a day
 * when the pressure to move a number is highest — which is how a guess gets
 * frozen in anyway, just later and with less thought. So the floors are written
 * down now, while nothing is at stake, and the screen prints the distance.
 *
 * NOTHING HERE ACTS. No floor gates a write, changes an order, or suppresses
 * anything; `MIN_DURATION_SAMPLE` is a floor that fires and this is deliberately
 * not that. These are readiness statements, and reaching one is permission to
 * START the argument rather than its conclusion.
 *
 * EVERY NUMBER IS ANCHORED TO SOMETHING THAT ALREADY EXISTS, because a floor
 * invented to justify not tuning is the same frozen guess wearing the opposite
 * sign. Each entry says what it is anchored to and what the unit of evidence
 * IS — a count with no stated denominator is the thing `claimRateWorthReading`
 * refuses.
 */

export type TuningLoop = "ranking" | "rotation" | "triage";

export type TuningFloor = {
  loop: TuningLoop;
  /** What ONE unit of evidence is. The denominator a reader needs. */
  unit: string;
  /** How many of them before the question is worth asking. */
  floor: number;
  /** What this number is anchored to. Never "it felt about right". */
  anchor: string;
};

/**
 * RANKING — 20 listings carrying evidence, PER WEIGHT.
 *
 * `bayesianRating` uses a prior of 20 ratings on the argument that below about
 * twenty observations a mean is not worth trusting. The same argument one level
 * up: a weight's effect is a statistic over LISTINGS, so below twenty listings
 * with evidence for that term, moving its weight fits noise. `weightEvidence`
 * already reports `measured` per term; this is the number that makes it a
 * verdict rather than a count.
 *
 * A SEPARATE CONSTANT FROM THE PRIOR, not a reference to it — they are counts
 * of different things (ratings on one listing, against listings in a catalogue)
 * that happen to share a reason, and coupling them would make a change to one
 * silently move the other. `REVERT_SAMPLE_GROWTH` is kept apart from the band's
 * for the same reason.
 */
export const RANKING_EVIDENCE_FLOOR = 20;

/**
 * ROTATION — a pool of at least five, and offers enough to read a share.
 *
 * TWO NUMBERS BECAUSE THE QUESTION HAS TWO HALVES, and only one of them is
 * statistical. Below five live listings in a category there is nothing to
 * rotate: with two it is alternation, and with three or four the near-tie band
 * is usually the whole list, so "rotating" is just shuffling. Five is the
 * smallest pool where a near-tie set can be a strict subset of the list, which
 * is what rotation is actually about.
 *
 * The offer floor is DERIVED rather than chosen: concentration is a share, and
 * a share is only readable when one more offer cannot move it much. At `n`
 * listings an even split is `1/n`, so requiring that one offer moves the top
 * share by less than a tenth of that even share gives `10 × n` offers. Five
 * listings therefore needs fifty offers, and a bigger pool needs proportionally
 * more — which is correct, because a bigger pool makes each share smaller.
 */
export const ROTATION_MIN_LISTINGS = 5;
export const ROTATION_OFFERS_PER_LISTING = 10;

/** The offer floor for a pool of this size. */
export function rotationOfferFloor(listings: number): number {
  return Math.max(listings, ROTATION_MIN_LISTINGS) * ROTATION_OFFERS_PER_LISTING;
}

/**
 * TRIAGE — 30 bookings that carry the triage they came from.
 *
 * The tuning question is "did the triage agree with what the customer actually
 * booked", which is a RATE, and `bookings.triage_log_id` is its only
 * denominator. 30 is `MIN_PROPOSAL_SAMPLE`'s upper end, used here for the same
 * reason it is used there: a rate that would move published copy — and the
 * prompt is published copy — needs a sample where a ten-point difference is not
 * one booking.
 *
 * IT IS ZERO TODAY AND THAT IS NOT A BROKEN CHAIN. The join landed on
 * 2026-09-26 and the newest booking is 2026-09-20, so nothing has been booked
 * since. Unexercised, not broken — and exactly the distinction this file exists
 * to keep legible, because "0 of 14" reads like a bug.
 */
export const TRIAGE_OUTCOME_FLOOR = 30;

export const TUNING_FLOORS: Record<TuningLoop, TuningFloor> = {
  ranking: {
    loop: "ranking",
    unit: "listings with evidence for that weight",
    floor: RANKING_EVIDENCE_FLOOR,
    anchor: "bayesianRating's prior of 20, one level up: listings, not ratings",
  },
  rotation: {
    loop: "rotation",
    unit: "offers in a category with at least five live listings",
    floor: rotationOfferFloor(ROTATION_MIN_LISTINGS),
    anchor: "one offer must move the top share by under a tenth of an even split",
  },
  triage: {
    loop: "triage",
    unit: "bookings carrying the triage they came from",
    floor: TRIAGE_OUTCOME_FLOOR,
    anchor: "MIN_PROPOSAL_SAMPLE's upper end — the prompt is published copy",
  },
};

export type Readiness = {
  /** Has the floor been reached? Permission to argue, never the answer. */
  ready: boolean;
  have: number;
  floor: number;
  /** How many more. Zero once ready, never negative. */
  short: number;
};

/**
 * Distance to a floor.
 *
 * `have` IS ALLOWED TO BE NULL AND THAT IS NOT ZERO. A read that failed and a
 * loop with no evidence are different facts, and rendering the first as "0 of
 * 30" is rule 6 on the one screen built to say how much is known. The caller
 * gets null back and has to say so.
 */
export function readiness(have: number | null, floor: number): Readiness | null {
  if (have === null) return null;
  return {
    ready: have >= floor,
    have,
    floor,
    short: Math.max(0, floor - have),
  };
}
