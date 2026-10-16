"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
import { confirmFirstPayout } from "@/lib/data/payout-destinations";

/**
 * A person looked at where the first payment is going, and said yes.
 *
 * AUTHORISED HERE AND REFUSED AGAIN IN THE DATABASE. A server action is a public
 * POST endpoint — anybody who can reach the page can reach this — so
 * `freshAdminActor()` reads the session rather than trusting an id from the form.
 * The
 * trigger then refuses a second confirmation outright, which is what keeps the
 * first person's name on the record rather than the last one's.
 *
 * ONLY THE DESTINATION ID CROSSES THE WIRE. Who confirmed it comes from the
 * session; the amount, the account and the professional are all re-read
 * server-side. A form that posted any of them would be a browser deciding where
 * money goes.
 *
 * A FRESH SECOND FACTOR, THE SAME FIFTEEN MINUTES A PAYOUT NEEDS. This is the
 * human witness in the account-takeover control: a destination change nobody
 * could be notified about waits here until a person looks at it. Somebody who
 * can confirm their own new account from a session they walked up to has
 * removed the only check in that control that is not another session.
 */
export async function confirmDestinationAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) {
    return {
      ok: false,
      reason: gate.reason === "reauthNeeded" ? "reauthNeeded" : "notSignedIn",
    };
  }
  const profile = gate.profile;

  const destinationId = String(formData.get("destinationId") ?? "");
  if (!destinationId) return { ok: false, reason: "notFound" };

  const result = await confirmFirstPayout({
    destinationId,
    adminId: profile.id,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath("/[locale]/(admin)/admin/payout-destinations", "page");
  return { ok: true };
}
