"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
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
