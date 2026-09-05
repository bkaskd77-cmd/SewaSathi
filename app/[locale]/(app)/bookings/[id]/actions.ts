"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { checkDispatchNow } from "@/lib/data/dispatch";
import { site } from "@/lib/config/site";
import { cancelBooking, chooseProvider, getBooking } from "@/lib/data/bookings";
import { getCategory } from "@/lib/data/categories";
import {
  abandonPayment,
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
  /**
   * What the customer says they handed over, typed without being shown the
   * professional's figure. Undefined only where there is nothing to be blind
   * about — an over-band amount they have already seen and approved.
   */
  amountPaid?: number,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  if (amountPaid !== undefined && !Number.isInteger(amountPaid)) {
    return { ok: false, reason: "invalidAmount" };
  }

  const result = await confirmCashPayment({
    reference,
    actorId: profile.id,
    amountPaid,
  });
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

/**
 * "Pay a different way" on an attempt that never came back.
 *
 * Not a cancel: the gateway is asked first, and a payment it reports as
 * completed settles instead of being thrown away. See `abandonPayment`.
 */
export async function abandonPaymentAction(
  bookingId: string,
  reference: string,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await abandonPayment({ reference, actorId: profile.id });
  revalidatePath(`/bookings/${bookingId}`);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

/**
 * "Check now" on a booking still waiting for a professional.
 *
 * Runs the same age-based rule the cron runs — see `lib/data/dispatch.ts`. It
 * cannot widen anything early: the stage comes from timestamps, so an
 * impatient tap on a two-minute-old emergency reports that the chosen
 * professional still has it and moves nothing.
 *
 * It exists because the sweep runs daily on this Vercel plan, and a
 * five-minute emergency window that only advances once a day is not a
 * five-minute window. Nobody waiting by a leak should have to wait for
 * tomorrow's cron.
 */
export async function checkForProviderAction(
  bookingId: string,
): Promise<{ ok: boolean; changed: boolean }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, changed: false };

  const outcome = await checkDispatchNow({ bookingId, actorId: profile.id });
  if (outcome.stage === "notYours") return { ok: false, changed: false };

  revalidatePath(`/bookings/${bookingId}`);
  return { ok: true, changed: outcome.changed };
}


/**
 * The customer picking a replacement after somebody refused.
 *
 * One tap, and it is the whole point of the suggestions: everything else about
 * the job is unchanged, so sending the customer back through the booking flow
 * to re-enter their own address would be asking them to pay twice for one
 * decision. The session is re-read here and every other check is in
 * `chooseProvider` and, under it, in the database — a professional who does
 * not cover the job, or who has already turned it down, is refused by the
 * trigger whatever this action believes.
 */
export async function chooseProviderAction(
  bookingId: string,
  providerId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await chooseProvider({
    bookingId,
    providerId,
    actorId: profile.id,
  });
  if (result.ok) {
    revalidatePath(`/bookings/${bookingId}`);
    revalidatePath("/bookings");
    return { ok: true };
  }
  return { ok: false, reason: result.reason };
}
