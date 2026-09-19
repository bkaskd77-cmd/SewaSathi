"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { decideSurveyVisitFee } from "@/lib/data/survey";

/**
 * Approve or refuse one survey visit fee.
 *
 * The admin check is here as well as on the page and again in the data layer.
 * A server action is a public POST endpoint, and a page guard stops somebody
 * SEEING the screen while doing nothing to stop them calling this — the same
 * reason `decideClaimAction` re-checks.
 */
export async function decideSurveyFeeAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { ok: false, reason: "notAdmin" };
  }

  const result = await decideSurveyVisitFee({
    feeId: String(formData.get("feeId") ?? ""),
    approve: formData.get("verdict") === "approve",
    note: String(formData.get("note") ?? ""),
    actorId: profile.id,
  });

  if (result.ok) revalidatePath("/[locale]/(app)/admin/survey-fees", "page");
  return result;
}
