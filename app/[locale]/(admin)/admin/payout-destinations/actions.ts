"use server";

import { revalidatePath } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import { confirmFirstPayout } from "@/lib/data/payout-destinations";

/**
 * A person looked at where the first payment is going, and said yes.
 *
 * AUTHORISED HERE AND REFUSED AGAIN IN THE DATABASE. A server action is a public
 * POST endpoint — anybody who can reach the page can reach this — so
 * `adminActor()` reads the session rather than trusting an id from the form. The
 * trigger then refuses a second confirmation outright, which is what keeps the
 * first person's name on the record rather than the last one's.
 *
 * ONLY THE DESTINATION ID CROSSES THE WIRE. Who confirmed it comes from the
 * session; the amount, the account and the professional are all re-read
 * server-side. A form that posted any of them would be a browser deciding where
 * money goes.
 */
export async function confirmDestinationAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "notSignedIn" };

  const destinationId = String(formData.get("destinationId") ?? "");
  if (!destinationId) return { ok: false, reason: "notFound" };

  const result = await confirmFirstPayout({ destinationId, adminId: profile.id });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath("/[locale]/(admin)/admin/payout-destinations", "page");
  return { ok: true };
}
