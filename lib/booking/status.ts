/**
 * What a booking can become, and from where.
 *
 * The rules live twice: here, because the interface has to know whether to
 * offer a cancel button, and in `booking_transition_allowed()` in
 * 20260901000001_bookings.sql, because the database is the only place a rule
 * cannot be bypassed by a bug, a script, or somebody in the SQL editor.
 *
 * Two copies of a rule is normally a defect. It is allowed here because
 * `npm run check:transitions` parses both and fails the build if they
 * disagree — the duplication is checked, not trusted.
 *
 * No React, no server-only: this is a plain table and both halves of the app
 * read it.
 */

export const BOOKING_STATUSES = [
  "pending",
  "accepted",
  "en_route",
  "in_progress",
  "completed",
  "cancelled",
  "no_provider_found",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Legal transitions. A status with an empty list is terminal.
 *
 * `pending -> no_provider_found` is the one that is easy to forget and matters
 * most: a booking nobody accepts must end somewhere honest rather than sitting
 * as "pending" forever while a customer waits.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["accepted", "cancelled", "no_provider_found"],
  accepted: ["en_route", "cancelled"],
  en_route: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_provider_found: [],
};

export function canTransition(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Nothing more will happen to this booking. */
export function isTerminal(status: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[status].length === 0;
}

/**
 * A customer may cancel while nobody is on the way. Once a professional is
 * en route they have already spent the trip, so cancelling goes through
 * support — the RLS policy enforces the same window.
 */
export function customerCanCancel(status: BookingStatus): boolean {
  return status === "pending" || status === "accepted";
}

/**
 * The steps shown on the booking's own page, in order. Cancelled and
 * no_provider_found are deliberately absent: they are ends, not stages, and
 * drawing them as a step implies the job is still travelling towards one.
 */
export const BOOKING_PROGRESS: BookingStatus[] = [
  "pending",
  "accepted",
  "en_route",
  "in_progress",
  "completed",
];

export function progressIndex(status: BookingStatus): number {
  return BOOKING_PROGRESS.indexOf(status);
}

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}
