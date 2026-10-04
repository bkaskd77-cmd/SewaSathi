"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { disputeTripDebt } from "@/lib/data/customer-risk";
import { setActivityOptOut } from "@/lib/data/profile-prefs";

/**
 * The one thing this screen can change until Phase 10.
 *
 * THE ACTOR COMES FROM THE SESSION. There is no id in the form, so there is no
 * id to forge: the action re-reads `getSessionProfile()` and the data layer
 * scopes the write to that id. Three holes have been found in this product from
 * the other arrangement, all the same shape — an id arrived from the browser and
 * nothing asked whose it was.
 *
 * NO `router.refresh()` ANYWHERE NEAR THIS. `revalidatePath` already returns the
 * re-rendered screen; a refresh after it is a second full round trip for the
 * page you are already being sent.
 */
export async function setActivityOptOutAction(
  formData: FormData,
): Promise<void> {
  const profile = await getSessionProfile();
  if (!profile) return;

  // The value asked for, not a flip — a stale page must not toggle somebody
  // back into a feed they have just left.
  const hidden = formData.get("hidden") === "true";

  await setActivityOptOut(profile.id, hidden);
  revalidatePath("/[locale]/(app)/account", "page");
}

/**
 * The customer disputes a trip charge they are carrying.
 *
 * SAME SHAPE AS THE OPT-OUT ABOVE and for the same reason: the actor comes from the
 * session, so there is no id on the form to forge, and the data layer writes only that
 * row. A reason is required — the button is disabled without one in the browser, and
 * `disputeTripDebt` refuses an empty note on the server, because a client-side check
 * is a convenience and never the rule.
 *
 * THE OUTCOME IS NOT REPORTED BACK, deliberately: `revalidatePath` re-renders the
 * screen, which then shows the dispute as open or still shows the charge. A toast
 * saying "submitted" over a panel that has not changed is how somebody comes to
 * believe something happened that did not.
 */
export async function disputeTripDebtAction(formData: FormData): Promise<void> {
  const profile = await getSessionProfile();
  if (!profile) return;

  const note = String(formData.get("note") ?? "");
  await disputeTripDebt({ profileId: profile.id, note });
  revalidatePath("/[locale]/(app)/account", "page");
}
