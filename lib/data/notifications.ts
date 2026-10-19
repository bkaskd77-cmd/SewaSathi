import "server-only";

import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Reading the in-app channel.
 *
 * Writing is `lib/notify`'s job and goes through the service role, because RLS
 * grants nobody insert — a notification a client could write is one an
 * attacker can forge, and these say things like "your professional is on the
 * way". Reading is RLS-scoped, so a person only ever sees their own.
 *
 * WHY THIS EXISTS AT ALL, given the booking page is live: the live page only
 * helps somebody who is looking at it. The notification is for the person who
 * closed the tab, and the surface it needs is small — a mark on the bookings
 * list saying "something happened here since you last looked".
 */

export type UnreadMark = {
  bookingId: string;
  /** The most recent thing that happened, as a message key. */
  kind: string;
  count: number;
};

/**
 * Unread notifications, grouped by the booking they are about.
 *
 * READ THROUGH RLS, so it answers for whoever is asking — the policy is
 * `profile_id = auth.uid()` and there is no admin policy on this table. That
 * makes it the professional's read as much as the customer's, which is what
 * `/provider/jobs` now uses it for.
 *
 * AND "NOTHING WRITES ONE YET" IS FALSE, which is worth correcting without
 * changing what the code does. `payout.destinationChanged` is written with
 * `bookingId: null`, so the `continue` below skips it — and that is right:
 * `/provider/payouts` already carries that sentence off `payout_destinations`
 * itself, with the date the account changed and a number to ring.
 * `tests/unit/notification-copy.test.ts` pins the absent `LIST_NOTES` entry as
 * a decision rather than an omission, so nobody adds copy "for completeness"
 * and puts a professional's payout warning on a customer's booking list.
 *
 * What WAS broken is where its push landed, not whether it could be read — see
 * `notificationPath`.
 */
export async function unreadByBooking(): Promise<Map<string, UnreadMark>> {
  const marks = new Map<string, UnreadMark>();
  if (!hasSupabaseConfig()) return marks;

  try {
    const { data } = await createClient()
      .from("notifications")
      .select("booking_id, kind, created_at")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(100);

    for (const row of data ?? []) {
      const bookingId = row.booking_id as string | null;
      if (!bookingId) continue;
      const existing = marks.get(bookingId);
      if (existing) {
        existing.count += 1;
      } else {
        // Ordered newest first, so the first one seen is the latest — that is
        // the one worth naming on the list.
        marks.set(bookingId, {
          bookingId,
          kind: row.kind as string,
          count: 1,
        });
      }
    }
  } catch {
    // A notification mark is decoration on a list that is already correct.
    // Failing to load it must never take the list with it.
  }
  return marks;
}

/**
 * Mark a booking's notifications read, because the person is looking at it.
 *
 * Through the service role and scoped by `profile_id`, rather than through the
 * RLS update policy: the caller has already been identified by the page, and
 * this way the write cannot be turned into "mark somebody else's read" by an
 * id from a URL. The `is("read_at", null)` guard makes it a no-op on every
 * render after the first.
 */
export async function markBookingRead(
  profileId: string,
  bookingId: string,
): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    await createAdminClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("profile_id", profileId)
      .eq("booking_id", bookingId)
      .is("read_at", null);
  } catch {
    // Same reasoning as above: this is a read receipt, not the event.
  }
}
