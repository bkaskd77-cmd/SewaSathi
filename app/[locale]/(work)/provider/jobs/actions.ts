"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { type BookingStatus } from "@/lib/booking";
import { openCommissionAppeal, recordFinalAmount } from "@/lib/data/payments";
import { advanceJob, claimJob, declineJob } from "@/lib/data/provider-jobs";

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

/**
 * Take a job that has been opened to everybody.
 *
 * The race is settled by the RLS policy — see `claimJob`. Two professionals
 * tapping at the same second is a normal event, not an error, and exactly one
 * of them gets the work.
 */
export async function claimJobAction(
  bookingId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await claimJob({ bookingId, actorId: profile.id });
  if (result.ok) {
    revalidatePath("/provider/jobs");
    revalidatePath(`/bookings/${bookingId}`);
  }
  return result;
}


/**
 * "This job really was smaller than the band."
 *
 * The commission floor charges the fee on the published minimum, which is what
 * makes under-reporting pointless — and occasionally lands on a job that
 * genuinely was a five-minute washer. Every check is in
 * `openCommissionAppeal`: it re-reads the booking, confirms this professional
 * did it, and refuses an appeal against a floor that was never applied. One
 * per booking, decided by a person.
 */
export async function appealCommissionAction(
  bookingId: string,
  reason: string,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const result = await openCommissionAppeal({
    bookingId,
    actorId: profile.id,
    reason,
  });
  if (result.ok) {
    revalidatePath("/provider/jobs");
    return { ok: true };
  }
  return { ok: false, reason: result.reason };
}

/**
 * "I've arrived", from somebody standing in the street.
 *
 * Deliberately forgiving about location: it is passed through when the phone
 * offered it and omitted when it did not, and a claim with no location goes to
 * a person rather than being auto-upheld. Telling somebody in the rain that
 * they cannot report what just happened because their GPS is off would be the
 * wrong trade by a very long way.
 */
export async function recordArrivalAction(input: {
  bookingId: string;
  lat?: number;
  lng?: number;
}): Promise<{ ok: boolean }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false };

  const { recordArrival } = await import("@/lib/data/customer-risk");
  const ok = await recordArrival({
    bookingId: input.bookingId,
    providerProfileId: profile.id,
    lat: input.lat,
    lng: input.lng,
  });

  return { ok };
}

/**
 * "Nobody is here."
 *
 * The waited minutes and contact attempts come from the browser, which is the
 * only place that knows them — but they are not taken on trust for the money:
 * `claimNoShow` re-reads the recorded arrival and computes the verdict from
 * what is stored. A phone that claims an hour's wait against an arrival
 * stamped two minutes ago produces evidence a person looks at, not a payment.
 */
export async function claimNoShowAction(input: {
  bookingId: string;
  waitedMinutes: number;
  contactAttempts: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const { claimNoShow } = await import("@/lib/data/customer-risk");
  const result = await claimNoShow({
    bookingId: input.bookingId,
    providerProfileId: profile.id,
    waitedMinutes: Math.max(0, Math.floor(input.waitedMinutes)),
    contactAttempts: Math.max(0, Math.floor(input.contactAttempts)),
  });

  if (!result.ok) {
    return {
      ok: false,
      reason:
        result.verdict?.outcome === "incomplete"
          ? result.verdict.missing.join(",")
          : "generic",
    };
  }

  revalidatePath("/[locale]/(work)/provider/jobs", "page");
  return { ok: true };
}
