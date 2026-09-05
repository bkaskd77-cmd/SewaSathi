"use server";

import { getLocale } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import {
  createAddress,
  type AddressInput,
  type CreateAddressResult,
} from "@/lib/data/addresses";
import { uploadBookingPhoto } from "@/lib/data/booking-photos";
import {
  createBooking,
  type BookingInput,
  type CreateBookingResult,
} from "@/lib/data/bookings";
import { listProviders } from "@/lib/data/providers";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { rankProviders } from "@/lib/data/ranking";

/**
 * The flow's server half.
 *
 * Every one of these re-reads the session rather than trusting anything the
 * client sent: a server action is a public endpoint, and the customer id is
 * the one value that must never come from the browser.
 */

async function requireProfile() {
  const profile = await getSessionProfile();
  if (!profile) throw new Error("not signed in");
  return profile;
}

/** Step d. Ranked with the same weights the catalogue uses. */
export type ShortlistEntry = {
  id: string;
  displayName: string;
  photoUrl: string | null;
  yearsExperience: number;
  isVerified: boolean;
  availability: string;
  ratingAvg: number;
  ratingCount: number;
  jobsCompleted: number;
  avgResponseMinutes: number;
};

export async function shortlistAction(input: {
  category: string;
  area?: string | null;
  urgency?: string | null;
}): Promise<ShortlistEntry[]> {
  const providers = await listProviders({
    category: input.category,
    area: input.area || null,
  });

  // Same scoring as /services, so the order a customer sees inline is the
  // order they would have seen on the list page. Two different rankings for
  // the same question would be a bug nobody could see.
  const ranked = rankProviders(providers, {
    urgency: input.urgency,
    area: input.area,
  });

  return ranked.slice(0, 5).map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    photoUrl: provider.photoUrl,
    yearsExperience: provider.yearsExperience,
    isVerified: provider.isVerified,
    availability: provider.availability,
    ratingAvg: provider.stats.ratingAvg,
    ratingCount: provider.stats.ratingCount,
    jobsCompleted: provider.stats.jobsCompleted,
    avgResponseMinutes: provider.stats.avgResponseMinutes,
  }));
}

/**
 * Step a. The photo is compressed in the browser first and arrives as base64.
 *
 * Uploaded through here rather than straight from the browser so that
 * supabase-js never enters the booking bundle — the same rule that keeps it
 * out of the header.
 */
export async function uploadPhotoAction(
  base64: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const profile = await requireProfile();
  return uploadBookingPhoto(base64, profile.id);
}

/** Step b, when the customer is adding a new address rather than reusing one. */
export async function saveAddressAction(
  input: AddressInput,
): Promise<CreateAddressResult> {
  const profile = await requireProfile();
  return createAddress(input, profile.id);
}

/**
 * Step e. The one that makes the promise.
 *
 * Takes the address either as a saved id or as the fields to save, so the
 * whole booking is one round trip from the confirm button — a second request
 * between "save the address" and "make the booking" is a window where the
 * connection drops and the customer has an address but no job.
 */
export async function confirmBookingAction(input: {
  booking: Omit<BookingInput, "addressId">;
  addressId?: string | null;
  newAddress?: AddressInput | null;
}): Promise<CreateBookingResult> {
  const profile = await requireProfile();
  const locale = (await getLocale()) as Locale;

  // A real customer books one job, occasionally two. Twenty in an hour is a
  // script, and every booking dispatches to real professionals — the cost of
  // this one being abused is other people's time, not ours.
  const limit = await checkRateLimit("booking", profile.id);
  if (!limit.ok) return { ok: false, errors: { form: "tooManyRequests" } };

  let addressId = input.addressId ?? null;

  if (!addressId) {
    if (!input.newAddress) {
      return { ok: false, errors: { address: "pickAddress" } };
    }
    const saved = await createAddress(input.newAddress, profile.id);
    if (!saved.ok) {
      // The address errors belong to step b, so the flow sends them back there
      // rather than showing them under a confirm button.
      return { ok: false, errors: { address: "addressInvalid" } };
    }
    addressId = saved.id;
  }

  return createBooking(
    { ...input.booking, addressId },
    profile.id,
    locale,
  );
}
