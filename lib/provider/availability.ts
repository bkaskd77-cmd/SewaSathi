/**
 * "Available now", and why it has to expire on its own.
 *
 * A SELF-DECLARED FLAG THAT NEVER DECAYS IS TWO BAD THINGS AT ONCE, and the
 * second one is the one that ruins the product:
 *
 *   1. It sends a customer with a burst pipe to somebody who is asleep. The
 *      person most harmed by a stale flag is the person in the worst trouble,
 *      because "available now" is exactly what an emergency search sorts on.
 *   2. It outranks honesty. Availability and response carry 0.65 between them
 *      in `EMERGENCY_WEIGHTS`, so a professional who leaves the switch on
 *      permanently beats every professional who turns it off when they are
 *      busy. A rule whose payoff is worth gaming gets gamed, and this one pays
 *      in bookings.
 *
 * SO THE SWITCH TURNS IT ON AND TIME TURNS IT OFF. It lapses at the end of the
 * working day rather than after a fixed number of hours, because that is how
 * the person actually thinks about it — a tradesperson is available "today",
 * not "for the next six hours", and a flag that dies at 3pm while they are
 * still working is its own kind of lie.
 *
 * DECAY, NOT A CRON. `availabilityNow` reads the stamp and decides, so there is
 * no sweep to fail and nothing is stale between runs. A background job that
 * turns flags off is a background job that stops running one night, and nobody
 * notices until a customer does.
 *
 * Pure and dependency-free: it decides what a customer is shown about whether
 * somebody will come, so it has to be testable without a database.
 */

/** What the directory shows, and what the ranking sorts on. */
export type Availability = "now" | "today" | "scheduled";

/**
 * When the working day ends, in Nepal time.
 *
 * Matches the working hours the booking flow offers. The flag lapsing at the
 * same moment the last slot closes is the honest boundary: after this, "now"
 * cannot mean anything a customer can act on today.
 */
export const DAY_ENDS_HOUR = 19;

/** Nepal is UTC+05:45. No daylight saving, so one constant is enough. */
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

/** The instant the working day ends, for whichever Nepali day `at` falls in. */
export function endOfWorkingDay(at: Date): Date {
  const local = new Date(at.getTime() + NEPAL_OFFSET_MINUTES * 60_000);

  const endLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    DAY_ENDS_HOUR,
    0,
    0,
    0,
  );

  return new Date(endLocal - NEPAL_OFFSET_MINUTES * 60_000);
}

/**
 * Turning the switch on. Returns the stamp to store, or null to clear it.
 *
 * Switching on after the day has already ended gives tomorrow evening rather
 * than a stamp that is already dead — somebody tapping it at 8pm means they
 * are working, and handing them an expired flag would read as the button being
 * broken.
 */
export function availableUntil(input: {
  on: boolean;
  at?: Date;
}): Date | null {
  if (!input.on) return null;

  const at = input.at ?? new Date();
  const end = endOfWorkingDay(at);
  if (end.getTime() > at.getTime()) return end;

  return endOfWorkingDay(new Date(at.getTime() + 24 * 60 * 60_000));
}

/**
 * What to show right now, given the stamp and the professional's own default.
 *
 * `base` is what they are when the flag is not lit: `today` for somebody who
 * generally works same-day, `scheduled` for somebody who books ahead. For a
 * real professional it is never `now` — the toggle writes the stamp and never
 * the column, so `now` is the flag's to grant and time's to take away.
 *
 * The type still admits `now` because the seeded demo listings carry it and
 * have since Phase 4. They are fixtures rather than people, nobody is
 * dispatched to them, and quietly demoting them here would change the
 * catalogue to hide a fact about the seed.
 */
export function availabilityNow(input: {
  availableUntil: Date | string | null | undefined;
  base: Availability;
  at?: Date;
}): Availability {
  if (!input.availableUntil) return input.base;

  const until =
    input.availableUntil instanceof Date
      ? input.availableUntil
      : new Date(input.availableUntil);

  if (Number.isNaN(until.getTime())) return input.base;

  const at = input.at ?? new Date();
  return until.getTime() > at.getTime() ? "now" : input.base;
}

/** How long the flag has left, for the sentence beside the switch. */
export function minutesRemaining(input: {
  availableUntil: Date | string | null | undefined;
  at?: Date;
}): number | null {
  if (!input.availableUntil) return null;

  const until =
    input.availableUntil instanceof Date
      ? input.availableUntil
      : new Date(input.availableUntil);
  if (Number.isNaN(until.getTime())) return null;

  const at = input.at ?? new Date();
  const minutes = Math.floor((until.getTime() - at.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}
