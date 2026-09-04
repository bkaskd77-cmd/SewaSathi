import type { BookingStatus } from "./status";

/**
 * What happens to a job nobody has accepted yet.
 *
 * The customer's screen says "we are alerting professionals now". Until this
 * existed, that was not true: a booking was assigned to the one professional
 * the customer picked and then sat there. If that person never opened the app,
 * the job stayed pending for ever, the customer kept waiting for a call, and
 * nothing anywhere noticed. A promise on a screen with no mechanism behind it
 * is worse than no promise.
 *
 * THREE STAGES, and the reason for each:
 *
 *   1. FIRST REFUSAL. The professional the customer chose gets the job to
 *      themselves for a short window. Choosing a specific person is the whole
 *      point of a directory — handing their job to somebody else after thirty
 *      seconds would make the choice decorative.
 *
 *   2. OPEN. The window passes and the job becomes visible to every
 *      professional who works that category in that ward. First to accept
 *      takes it. The customer's original choice is kept on the record as
 *      `first_choice_provider_id`, so "you asked for Krishna, Sita took it"
 *      is still answerable afterwards.
 *
 *   3. GIVE UP. Nobody takes it at all, and the booking ends at
 *      `no_provider_found` rather than pending for ever. Telling somebody
 *      "we could not find anyone" is a bad answer; leaving them to work it out
 *      from silence is a worse one, and it is the one that loses a customer
 *      permanently.
 *
 * URGENCY SETS THE CLOCK. A burst pipe cannot wait fifteen minutes for one
 * professional to notice their phone; a repaint next Tuesday can. The windows
 * below are the product's promise about how fast it moves, which is why they
 * are here as named constants rather than inline in a cron job.
 */

export type Urgency = "emergency" | "soon" | "routine";

export const DISPATCH_WINDOWS: Record<
  Urgency,
  {
    /** Minutes the chosen professional has the job to themselves. */
    firstRefusalMinutes: number;
    /** Minutes from booking to giving up entirely. */
    giveUpMinutes: number;
  }
> = {
  /*
   * Somebody is standing next to a leak. Five minutes is roughly how long it
   * takes to read a notification and decide, and no longer than a person will
   * wait before ringing somebody they found elsewhere.
   */
  emergency: { firstRefusalMinutes: 5, giveUpMinutes: 45 },
  /*
   * Today, but not this minute. Long enough that a professional at another job
   * can answer between tasks.
   */
  soon: { firstRefusalMinutes: 20, giveUpMinutes: 180 },
  /*
   * A scheduled job. Nobody is inconvenienced by an hour, and widening too
   * early would trample the customer's choice for no gain.
   */
  routine: { firstRefusalMinutes: 60, giveUpMinutes: 24 * 60 },
};

export type DispatchStage = "first-refusal" | "open" | "give-up";

/**
 * Where a pending booking has got to, from its age alone.
 *
 * Pure and takes the clock as an argument, so the whole schedule can be tested
 * without waiting for real minutes to pass — and so the sweep and any screen
 * that wants to say "still looking" cannot disagree about the answer.
 */
export function dispatchStage(
  createdAt: string,
  urgency: Urgency,
  now: Date = new Date(),
): DispatchStage {
  const windows = DISPATCH_WINDOWS[urgency] ?? DISPATCH_WINDOWS.routine;
  const ageMinutes = (now.getTime() - new Date(createdAt).getTime()) / 60_000;

  if (ageMinutes >= windows.giveUpMinutes) return "give-up";
  if (ageMinutes >= windows.firstRefusalMinutes) return "open";
  return "first-refusal";
}

/**
 * Is this booking still waiting for somebody to take it?
 *
 * Only `pending` is dispatchable. A job somebody has accepted is theirs, and a
 * cancelled one is over — the sweep must never reopen either, which is the
 * mistake that would hand a customer two professionals.
 */
export function awaitingProvider(status: BookingStatus): boolean {
  return status === "pending";
}
