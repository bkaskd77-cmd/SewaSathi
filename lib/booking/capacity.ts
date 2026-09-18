import { UNESTIMATED_HOLD_MINUTES } from "./duration";
import { WORKING_HOURS } from "./schedule";

/**
 * How many jobs one professional can hold in an overlapping window.
 *
 * WHAT THIS FIXES. Nothing stopped two customers booking the same professional
 * at 2pm. The one who lost found out on the day, from somebody who did not
 * arrive. `canServeAt` deliberately left this out — it answers "are they in
 * somebody's house right now", which is a different question from "is Thursday
 * 2pm already spoken for".
 *
 * THE UNIT IS AN OVERLAPPING WINDOW, NOT A SLOT. A job at 2pm occupies
 * 14:00–16:00 and collides with anything starting before 16:00. Overlap is
 * half-open on purpose: a job ending exactly as another starts does NOT
 * overlap, or every back-to-back pair in a full day would read as a conflict.
 *
 * AND THE WHOLE MODEL IS A WORKAROUND FOR A MISSING FIELD. A job has a
 * duration and the product does not record one — see the structural item in
 * ARCHITECTURE.md. Counting two-hour windows is roughly right for booking
 * collisions and roughly meaningless as a model of anybody's week, which is why
 * painting's number below is not a considered answer about painters.
 *
 * Pure and dependency-free: it decides whether a customer may book, so it has
 * to be testable without a database.
 */

/**
 * The width of a slot the picker offers. NOT how long a job takes.
 *
 * These were the same number until duration existed, which is why this file
 * used to describe itself as a workaround. A slot is the granularity a
 * customer picks a start time at; a job's length is its own fact and now lives
 * on the booking. `UNESTIMATED_HOLD_MINUTES` — which happens to be the same
 * 120 — is what an unestimated job reserves, and it is named separately
 * because it means something different.
 */
export const SLOT_MINUTES = WORKING_HOURS.slotHours * 60;

/** Statuses that still hold a professional's time. */
const HOLDS_TIME = new Set([
  "pending",
  "accepted",
  "en_route",
  "in_progress",
]);

export type HeldJob = {
  /** The slot start, or null for an as-soon-as-possible job. */
  scheduledFor: Date | string | null;
  status: string;
  /** Distinguishes a job from itself when re-checking an existing booking. */
  id?: string;
  /**
   * How long THIS job holds, in minutes.
   *
   * EVERY JOB USED TO BE TWO HOURS, which meant a tap washer and a whole-flat
   * repaint reserved the same block — the workaround this file was built
   * around and named in `ARCHITECTURE.md`. Null keeps that behaviour for a
   * booking whose product nobody could name, via `UNESTIMATED_HOLD_MINUTES`.
   */
  workingMinutes?: number | null;
};

export type SlotWindow = { start: Date; end: Date };

function instant(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const when = value instanceof Date ? value : new Date(value);
  return Number.isNaN(when.getTime()) ? null : when;
}

/**
 * The window a job occupies.
 *
 * An as-soon-as-possible job is treated as starting now, because that is what
 * the customer asked for and what the professional will actually be doing.
 */
export function slotWindow(
  scheduledFor: Date | string | null,
  minutes: number | null | undefined,
  at: Date = new Date(),
): SlotWindow {
  const start = instant(scheduledFor) ?? at;
  // A hold, not an estimate, when nobody knows — see lib/booking/duration.ts.
  const held = minutes && minutes > 0 ? minutes : UNESTIMATED_HOLD_MINUTES;
  return { start, end: new Date(start.getTime() + held * 60_000) };
}

/** Half-open: touching windows do not overlap. */
export function overlaps(a: SlotWindow, b: SlotWindow): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * How many jobs this listing may hold at once.
 *
 * ADMIN-SET FROM A VERIFIED CREW, NEVER SELF-SET, and that is the load-bearing
 * half.
 * A `providers` row is sometimes one person and sometimes a firm with three
 * crews — movers is where a category number breaks hardest, since one man with
 * a pickup does one move and a company with three trucks does three. So a
 * verified firm gets its own number at onboarding. A professional setting their
 * own would make every listing say ten and the cap would mean nothing.
 *
 * PROBATION ALWAYS CAPS, whatever the override says: a new listing has not yet
 * shown it can hold two jobs, let alone a firm's three.
 *
 * THE OFFER ADDS EXACTLY ONE. A professional may deliberately fit somebody in
 * beside a job they already hold, but only on that one booking and only once
 * over — otherwise offers stack until the limit is decorative.
 */
export function capacityFor(input: {
  /**
   * Their verified crew size. Null means one person.
   *
   * THE TRADE NO LONGER HAS A VOTE. This took a `categoryLimit` until
   * durations existed, and every category value above 1 was there to stop a
   * painter being blocked while the first job dried — which was never
   * concurrency, it was job length, and the scheduler models it directly now.
   * What survives is the half a trade could never express: one man with a
   * pickup does one move, a firm with three trucks does three.
   */
  crewCount?: number | null;
  probationLimit?: number | null;
  /** True when THIS booking carries an explicit offer from the professional. */
  overbookOffered?: boolean;
}): number {
  const base =
    input.crewCount != null && input.crewCount > 0 ? input.crewCount : 1;

  const capped =
    input.probationLimit != null && input.probationLimit > 0
      ? Math.min(base, input.probationLimit)
      : base;

  return Math.max(1, capped) + (input.overbookOffered ? 1 : 0);
}

/** How many of these jobs collide with the window a new one would occupy. */
export function countOverlapping(input: {
  jobs: readonly HeldJob[];
  scheduledFor: Date | string | null;
  /** How long the job being checked would hold. Null holds the default. */
  workingMinutes?: number | null;
  at?: Date;
  /** Re-checking an existing booking must not count it against itself. */
  excludeId?: string | null;
}): number {
  const at = input.at ?? new Date();
  const wanted = slotWindow(input.scheduledFor, input.workingMinutes, at);

  /*
   * EACH JOB IS MEASURED BY ITS OWN LENGTH, on both sides. A four-hour job
   * starting at ten collides with a two-hour one starting at one; the old
   * fixed window said it did not, and the second customer found out on the
   * day. The asymmetry matters too: a long held job collides with a short new
   * one that a short held job would not.
   */
  return input.jobs.filter((job) => {
    if (!HOLDS_TIME.has(job.status)) return false;
    if (input.excludeId && job.id === input.excludeId) return false;
    return overlaps(
      wanted,
      slotWindow(job.scheduledFor, job.workingMinutes, at),
    );
  }).length;
}

/** Is there room for one more? */
export function hasRoom(input: {
  jobs: readonly HeldJob[];
  scheduledFor: Date | string | null;
  workingMinutes?: number | null;
  capacity: number;
  at?: Date;
  excludeId?: string | null;
}): boolean {
  return countOverlapping(input) < input.capacity;
}

/**
 * The first offered slot this professional could actually take.
 *
 * Returned to the customer on a greyed row, so it has to come from the same
 * generator the When step renders — a "next free" the picker does not offer is
 * a button that leads nowhere. Null means nothing inside the horizon, which the
 * row says rather than showing a Book button that cannot work.
 */
export function nextFreeSlot(input: {
  /** Slots the picker would offer, in order, as ISO strings. */
  candidates: readonly string[];
  jobs: readonly HeldJob[];
  /** How long the job being placed would hold. */
  workingMinutes?: number | null;
  capacity: number;
  at?: Date;
}): string | null {
  for (const candidate of input.candidates) {
    const free = hasRoom({
      jobs: input.jobs,
      scheduledFor: candidate,
      workingMinutes: input.workingMinutes,
      capacity: input.capacity,
      at: input.at,
    });
    if (free) return candidate;
  }
  return null;
}
