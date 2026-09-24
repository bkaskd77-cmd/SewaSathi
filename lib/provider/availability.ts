/**
 * What a professional's listing says about whether they can come, and which
 * of those facts the product is allowed to take their word for.
 *
 * THREE THINGS DECIDE IT AND ONLY TWO ARE THEIRS TO SET:
 *
 *   1. `onJobSince` — the system's own fact, written by a trigger when a
 *      booking of theirs goes `en_route`. Not settable, not overridable.
 *   2. `busyUntil` — their declaration, carrying an end time.
 *   3. `availableUntil` — their declaration, expiring at the end of the day.
 *
 * THE PRECEDENCE IS THE WHOLE DESIGN. The verified fact beats both
 * declarations: nobody is listed "available now" while they are on the way to
 * somebody's house, however the switch was left. Before this, they could be —
 * and `EMERGENCY_WEIGHTS` puts 0.40 on availability, the largest single term in
 * that blend, so the person least able to come ranked as the most able. The
 * customer who paid for that was the one with a burst pipe at 2am.
 *
 * `busy` beats `available` because it is the more recent deliberate statement.
 *
 * DECAY, NOT A CRON, for both stamps. A background job that turns flags off is
 * a background job that stops running one night, and nobody notices until a
 * customer does. Every read compares against the clock instead, so there is no
 * sweep to fail and nothing is stale between runs.
 *
 * BEING BUSY COSTS NOTHING BEYOND NOT BEING SHOWN AS FREE. `/providers/standards`
 * publishes, in both languages, "Turning work down. You are allowed to be
 * busy." under *What is never a signal*. Nothing here is counted, ranked or
 * remembered against anybody, and a future reader looking for the place to add
 * that should read that page first.
 *
 * That promise is kept on the published page and no longer repeated beside the
 * control. The screen's job is to get somebody to the right state in one tap;
 * a reassurance about a penalty that does not exist raises the idea of one,
 * and it sat directly under the button we most want pressed.
 *
 * Pure and dependency-free: it decides what a customer is told about whether
 * somebody will come, so it has to be testable without a database.
 */

/**
 * What the directory shows and the ranking sorts on.
 *
 * `on_job` and `busy` are new and both mean "not now, but not gone". They are
 * deliberately distinct: a customer reading "On a job" learns something good
 * about a professional, and "Back by 5pm" tells them whether to wait. "Busy"
 * alone would tell them neither.
 */
export type Availability = "now" | "on_job" | "busy" | "today" | "scheduled";

/** The states a professional can be in when no stamp of theirs is live. */
export type BaseAvailability = Extract<Availability, "now" | "today" | "scheduled">;

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

/* ------------------------------------------------------------------ *
 * Busy, with an end on it
 * ------------------------------------------------------------------ */

/**
 * How long "busy" lasts, offered as a few taps rather than a time picker.
 *
 * A FREE TIMESTAMP FROM THE BROWSER IS NOT ACCEPTED, and the reason is the
 * same one that keeps `availableUntil` out of the action's parameters: a
 * professional who could name their own expiry could name one in 2035, and
 * "busy" would quietly become the flag that never decays. Presets also match
 * how somebody actually thinks between two jobs — "a couple of hours", "the
 * rest of today" — rather than making them do arithmetic on a phone.
 */
export const BUSY_PRESETS = ["twoHours", "restOfDay", "tomorrow"] as const;

export type BusyPreset = (typeof BUSY_PRESETS)[number];

export function isBusyPreset(value: string): value is BusyPreset {
  return (BUSY_PRESETS as readonly string[]).includes(value);
}

/**
 * The instant a busy window ends, from a preset.
 *
 * `restOfDay` past closing rolls to tomorrow evening for the same reason
 * `availableUntil` does: a window that is already over is a button that did
 * nothing.
 */
export function busyUntil(input: {
  preset: BusyPreset;
  at?: Date;
}): Date {
  const at = input.at ?? new Date();

  if (input.preset === "twoHours") {
    return new Date(at.getTime() + 2 * 60 * 60_000);
  }

  if (input.preset === "tomorrow") {
    return endOfWorkingDay(new Date(at.getTime() + 24 * 60 * 60_000));
  }

  const end = endOfWorkingDay(at);
  if (end.getTime() > at.getTime()) return end;
  return endOfWorkingDay(new Date(at.getTime() + 24 * 60 * 60_000));
}

/* ------------------------------------------------------------------ *
 * The one answer
 * ------------------------------------------------------------------ */

export type ProviderStateInput = {
  /** System-maintained. Set while a booking of theirs is en route or underway. */
  onJobSince?: Date | string | null;
  /** Self-declared, with an end. */
  busyUntil?: Date | string | null;
  /** Self-declared, expiring at the end of the working day. */
  availableUntil?: Date | string | null;
  /**
   * What the listing is when no stamp is live.
   *
   * `today` for somebody who generally works same-day, `scheduled` for
   * somebody who books ahead. The type admits `now` only because the seeded
   * demo listings carry it; for a real professional the toggle writes the
   * stamp and never the column.
   */
  base: BaseAvailability;
  at?: Date;
};

function instant(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const when = value instanceof Date ? value : new Date(value);
  return Number.isNaN(when.getTime()) ? null : when;
}

/**
 * What to show right now. One function, every surface.
 *
 * The professional's own dashboard and the customer's card call this with the
 * same row, so the two cannot disagree about whether somebody is free — which
 * they would within a week if the rule were written twice.
 */
export function providerState(input: ProviderStateInput): Availability {
  const at = input.at ?? new Date();

  // The verified fact first, and it is not overridable. Somebody is either on
  // the way to a house or they are not, and we know which.
  if (instant(input.onJobSince)) return "on_job";

  const busy = instant(input.busyUntil);
  if (busy && busy.getTime() > at.getTime()) return "busy";

  const available = instant(input.availableUntil);
  if (available && available.getTime() > at.getTime()) return "now";

  return input.base;
}

/** Can this listing be dispatched to a job starting right now? */
export function canTakeWorkNow(state: Availability): boolean {
  return state === "now";
}

/**
 * Does a live stamp end on the Nepali day it is being read on?
 *
 * The sentence beside the control read "Free until the end of today" for every
 * live stamp. But `availableUntil` rolls to tomorrow evening whenever the
 * switch is pressed after closing — so somebody tapping it at 23:40 was told
 * "the end of today — 19h 20m left", which is the end of *tomorrow*. The
 * number was right and the word was not.
 *
 * The roll-forward is deliberate and stays (an expired flag is a button that
 * did nothing), so the copy is what has to be able to say which day it landed
 * on. Null, unset and unreadable all answer false: no stamp is no claim about
 * today, and the caller has nothing to print anyway.
 */
export function landsSameDay(input: {
  until: Date | string | null | undefined;
  at?: Date;
}): boolean {
  const until = instant(input.until);
  if (!until) return false;

  const at = input.at ?? new Date();
  return nepaliDay(until) === nepaliDay(at);
}

/** The Nepali calendar day an instant falls in, as a sortable key. */
function nepaliDay(at: Date): string {
  const local = new Date(at.getTime() + NEPAL_OFFSET_MINUTES * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * How long a live stamp has left, for the sentence beside the control.
 *
 * Returns null once it has lapsed rather than a negative number: "0h 0m left"
 * on an expired flag reads as a bug, and the state has already changed anyway.
 */
export function minutesRemaining(input: {
  until: Date | string | null | undefined;
  at?: Date;
}): number | null {
  const until = instant(input.until);
  if (!until) return null;

  const at = input.at ?? new Date();
  const minutes = Math.floor((until.getTime() - at.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}
