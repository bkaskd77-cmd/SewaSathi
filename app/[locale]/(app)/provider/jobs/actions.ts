"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { type BookingStatus } from "@/lib/booking";
import { recordFinalAmount } from "@/lib/data/payments";
import { advanceJob, declineJob } from "@/lib/data/provider-jobs";

/**
 * The professional's actions.
 *
 * Every one re-reads the session here and hands the id down as `actorId`; the
 * data layer then re-reads the booking, checks this professional is the one
 * assigned, and judges the move. Nothing below trusts a status, an amount or
 * an ownership claim that arrived from a browser — the same rule the payment
 * actions follow, and for the same reason: this is the side of the product
 * that can charge somebody money.
 */

export async function advanceJobAction(
  bookingId: string,
  to: BookingStatus,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await advanceJob({ bookingId, to, actorId: profile.id });
  if (result.ok) {
    revalidatePath("/provider/jobs");
    revalidatePath(`/bookings/${bookingId}`);
  }
  return result;
}

export async function declineJobAction(
  bookingId: string,
  reason: string,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await declineJob({
    bookingId,
    actorId: profile.id,
    reason: reason.trim() || null,
  });
  if (result.ok) {
    revalidatePath("/provider/jobs");
    revalidatePath(`/bookings/${bookingId}`);
  }
  return result;
}

/**
 * The final amount, entered on site.
 *
 * Calls the same `recordFinalAmount` the API route does — deliberately, so the
 * professional's screen cannot skip a check by taking a different path. It
 * judges the figure against the band frozen on the booking, requires a reason
 * above it, and refuses anything past twice the quoted maximum outright.
 */
export async function recordAmountAction(
  bookingId: string,
  amount: number,
  reason: string,
): Promise<{ ok: boolean; verdict?: string; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await recordFinalAmount({
    bookingId,
    amount,
    reason: reason.trim() || null,
    actorId: profile.id,
  });

  if (result.ok) {
    revalidatePath("/provider/jobs");
    revalidatePath(`/bookings/${bookingId}`);
    return { ok: true, verdict: result.verdict };
  }
  return { ok: false, reason: result.reason };
}
