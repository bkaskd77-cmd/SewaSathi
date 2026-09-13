import type { Availability } from "./availability";

/**
 * Can this professional actually do this job — and the answer depends on WHEN.
 *
 * WHY THIS IS NOT A PROPERTY OF THE PROFESSIONAL. `on_job_since` and
 * `busy_until` tell us what somebody is doing right now. That is the whole
 * answer for a customer who needs help now, and almost irrelevant to a customer
 * booking Thursday afternoon. A single "available / unavailable" flag would
 * have to be wrong for one of them.
 *
 * WHAT WENT WRONG WITHOUT IT. The state was computed, shown on the card, and
 * then read by nothing else. A customer could see "On a job", tap Book, walk
 * the whole flow and confirm, and the product never once said what it already
 * knew. A state that is displayed but never acted on is decoration.
 *
 * BLOCKING OUTRIGHT WOULD BE THE OPPOSITE MISTAKE. Somebody on a job at 11am
 * can do a job at 4pm — which is why `on_job` scores like "today" rather than
 * "scheduled" in `AVAILABILITY_SCORE`. Refusing to let the busiest people be
 * booked would take work from exactly the professionals the platform depends
 * on.
 *
 * Pure and dependency-free. It decides what a customer is told and whether a
 * booking is accepted, so it has to be readable in one screen and testable
 * without a database.
 */

export type ServingRefusal =
  /** On one of our jobs right now, and the customer wants somebody now. */
  | "onJobNow"
  /** Declared themselves unavailable, and the customer wants somebody now. */
  | "busyNow"
  /** The slot the customer picked falls inside a window they said no to. */
  | "busyThen";

export type ServingVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: ServingRefusal;
      /**
       * When they are free again, where we know it.
       *
       * Null for `onJobNow`: a job has no scheduled end and guessing one would
       * be inventing a promise. The screen says "on a job" and offers other
       * people rather than a time that might be wrong.
       */
      freeFrom: Date | null;
    };

export type ServingInput = {
  /** The computed state — see `providerState`. */
  state: Availability;
  /** Their declared window, needed because a slot can fall inside it. */
  busyUntil?: Date | string | null;
  /**
   * When the customer needs them: an instant for a chosen slot, or null for
   * as-soon-as-possible, which is also what an emergency always is.
   */
  when?: Date | string | null;
  at?: Date;
};

function instant(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const when = value instanceof Date ? value : new Date(value);
  return Number.isNaN(when.getTime()) ? null : when;
}

export function canServeAt(input: ServingInput): ServingVerdict {
  const at = input.at ?? new Date();
  const when = instant(input.when);
  const busy = instant(input.busyUntil);

  // As soon as possible. Only what is true right now matters.
  if (!when) {
    if (input.state === "on_job") {
      return { ok: false, reason: "onJobNow", freeFrom: null };
    }
    if (input.state === "busy") {
      return { ok: false, reason: "busyNow", freeFrom: busy };
    }
    return { ok: true };
  }

  /*
   * A future slot. Being on a job NOW says nothing about Thursday, so it does
   * not count against them — this is the branch most likely to be broken by a
   * careless later edit, and the one the tests pin hardest.
   */
  if (when.getTime() <= at.getTime()) {
    // A slot already past is a scheduling error, not an availability one.
    // Treated as "now" so the customer is at least told the truthful thing.
    return canServeAt({ ...input, when: null });
  }

  if (busy && busy.getTime() > when.getTime()) {
    return { ok: false, reason: "busyThen", freeFrom: busy };
  }

  return { ok: true };
}

/**
 * An emergency is always "now", whatever else the form says.
 *
 * The customer choosing emergency has already told us the answer, and that is
 * the permission to be decisive: we do not offer to hold an emergency for
 * somebody who is demonstrably in another house. Five minutes of first refusal
 * is the one window that matters at 2am.
 */
export function servingWhen(input: {
  urgency?: string | null;
  scheduledFor?: string | null;
}): string | null {
  if (input.urgency === "emergency") return null;
  return input.scheduledFor?.trim() || null;
}

/**
 * Is this refusal a hard stop, or something to say and carry on past?
 *
 * ONLY AN EMERGENCY IS A STOP. Everything else is a booking that will work,
 * just not instantly — the professional is told, and if they have not answered
 * inside the first-refusal window the customer can hand it to somebody else.
 * That second half already exists on the booking page, so this is a promise the
 * product keeps rather than one it makes.
 */
export function blocksBooking(input: {
  urgency?: string | null;
  verdict: ServingVerdict;
}): boolean {
  return input.urgency === "emergency" && !input.verdict.ok;
}
