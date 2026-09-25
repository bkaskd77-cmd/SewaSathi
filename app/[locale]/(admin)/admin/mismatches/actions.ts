"use server";

import { revalidatePath } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import { resolveAmountMismatch } from "@/lib/data/payments";
import type { MismatchChoice } from "@/lib/payments";

/**
 * Settle one cash job whose two figures disagree.
 *
 * AUTHORISED HERE AND AGAIN IN THE DATA LAYER. A server action is a public
 * POST endpoint: anybody who can reach the page can reach this, and an
 * `adminId` handed down as an argument has proved nothing. `adminActor()`
 * reads the session; `resolveAmountMismatch` re-reads the role from
 * `profiles`. Same doubling as `resolveAppealAction`, and for the same reason.
 *
 * THE AMOUNT IS NOT TRUSTED EITHER. Only the *third* figure arrives from the
 * form; choosing the customer's or the professional's sends no number at all,
 * because those two are already on the booking and re-reading them is the
 * point. A form that posted "the customer's figure is 9,000" would be a
 * browser setting a price.
 */
export async function resolveMismatchAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "notAdmin" };

  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { ok: false, reason: "notFound" };

  const source = String(formData.get("source") ?? "");
  let choice: MismatchChoice;

  if (source === "customer" || source === "provider") {
    choice = { source };
  } else if (source === "adjudicated") {
    choice = {
      source: "adjudicated",
      // `Number("")` is 0, which would read as "too low" rather than "you did
      // not type an amount". An empty box gets NaN and the not-a-number
      // sentence, which is the one that describes what happened.
      amount: Number(String(formData.get("amount") ?? "").trim() || NaN),
      note: String(formData.get("note") ?? ""),
    };
  } else {
    return { ok: false, reason: "noChoice" };
  }

  const result = await resolveAmountMismatch({
    bookingId,
    adminId: profile.id,
    choice,
  });

  if (result.ok) {
    revalidatePath("/[locale]/(admin)/admin/mismatches", "page");
    // The customer's and the professional's views of that booking both change:
    // the panel stops saying "paused" and starts showing a receipt.
    revalidatePath(`/bookings/${bookingId}`);
  }
  return result;
}
