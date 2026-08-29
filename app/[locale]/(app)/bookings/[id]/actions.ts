"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { cancelBooking } from "@/lib/data/bookings";

/**
 * Cancel a booking.
 *
 * Three things have to agree for this to succeed and all three are deliberate:
 * the RLS policy limits which rows may be updated at all, the database trigger
 * rejects an illegal transition, and `customerCanCancel` decides whether the
 * button was ever on screen. This action adds the fourth: the session is
 * re-read here rather than trusted from the browser.
 */
export async function cancelBookingAction(
  id: string,
  reason: string | null,
): Promise<{ ok: boolean }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false };

  const result = await cancelBooking(id, reason);
  if (result.ok) {
    revalidatePath(`/bookings/${id}`);
    revalidatePath("/bookings");
  }
  return result;
}
