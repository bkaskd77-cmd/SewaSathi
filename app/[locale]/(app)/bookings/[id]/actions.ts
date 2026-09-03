"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { site } from "@/lib/config/site";
import { cancelBooking, getBooking } from "@/lib/data/bookings";
import { getCategory } from "@/lib/data/categories";
import {
  approveFinalAmount,
  confirmCashPayment,
  disputeAmount,
  listPaymentsForBooking,
  startPayment,
  verifyAndSettle,
  type Handoff,
} from "@/lib/data/payments";
import { isPaymentMethod } from "@/lib/payments";

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

/**
 * The payment actions.
 *
 * Every one of these re-reads the session here and passes the id down as
 * `actorId`; the data layer then re-reads the booking and decides. Nothing
 * below trusts an amount, a status or an ownership claim that arrived from the
 * browser — the amount charged is always the one already stored on the
 * booking, which is why none of these takes an amount to charge.
 */
export async function startPaymentAction(
  bookingId: string,
  method: string,
): Promise<Handoff> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };
  if (!isPaymentMethod(method)) return { ok: false, reason: "unknownMethod" };

  const booking = await getBooking(bookingId);
  if (!booking) return { ok: false, reason: "bookingNotFound" };
  const category = await getCategory(booking.categorySlug);

  const result = await startPayment({
    bookingId,
    method,
    actorId: profile.id,
    origin: site.url,
    // Shown on the gateway's own page. The reference is there so a customer
    // staring at eSewa can tell which job they are paying for.
    description: `${category?.nameEn ?? booking.categorySlug} · ${booking.reference}`,
    customer: { name: profile.fullName, phone: profile.phone },
  });

  if (result.ok) revalidatePath(`/bookings/${bookingId}`);
  return result;
}

/** The customer agreeing to a figure above the quoted band. */
export async function approveAmountAction(
  bookingId: string,
  amount: number,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await approveFinalAmount({
    bookingId,
    amount,
    actorId: profile.id,
  });
  if (result.ok) revalidatePath(`/bookings/${bookingId}`);
  return result;
}

/** The customer saying the figure is wrong. Flagged, never silently settled. */
export async function disputeAmountAction(
  bookingId: string,
  note: string,
): Promise<{ ok: boolean }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false };

  const result = await disputeAmount({
    bookingId,
    actorId: profile.id,
    note: note.trim() || "no reason given",
  });
  if (result.ok) revalidatePath(`/bookings/${bookingId}`);
  return result;
}

/**
 * Cash: the customer confirms they handed the money over.
 *
 * The customer is the only oracle for cash, so the ownership check matters
 * more here than anywhere else — it is the whole verification.
 */
export async function confirmCashAction(
  bookingId: string,
  reference: string,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await confirmCashPayment({ reference, actorId: profile.id });
  if (result.ok) revalidatePath(`/bookings/${bookingId}`);
  return { ok: result.ok, reason: result.ok ? undefined : result.reason };
}

/**
 * "Check again" on a payment that is still in flight.
 *
 * Re-verifies against the gateway rather than just re-reading our own row —
 * a refresh that only re-renders what we already believed would tell a
 * customer whose money has left their account exactly nothing new. Idempotent,
 * like every other path into `verifyAndSettle`, so tapping it repeatedly is
 * harmless.
 *
 * No amount, no status and no booking id reach the gateway from here: the
 * reference is checked against a row the caller owns first.
 */
export async function recheckPaymentAction(
  bookingId: string,
  reference: string,
): Promise<{ ok: boolean }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false };

  // Through RLS: a customer can only ever name a reference on their own
  // booking, so this is the ownership check as well as the lookup.
  const mine = await listPaymentsForBooking(bookingId);
  if (!mine.some((payment) => payment.ourReference === reference)) {
    return { ok: false };
  }

  const result = await verifyAndSettle(reference, {});
  revalidatePath(`/bookings/${bookingId}`);
  return { ok: result.ok };
}
