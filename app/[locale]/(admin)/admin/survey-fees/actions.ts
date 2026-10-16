"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
import { decideSurveyVisitFee } from "@/lib/data/survey";

/**
 * Approve or refuse one survey visit fee.
 *
 * The admin check is here as well as on the page and again in the data layer.
 * A server action is a public POST endpoint, and a page guard stops somebody
 * SEEING the screen while doing nothing to stop them calling this — the same
 * reason `decideClaimAction` re-checks.
 *
 * A FRESH SECOND FACTOR, NOT THE EIGHT-HOUR ADMIN WINDOW. `freshAdminActor()`
 * is `adminActor()` plus the fifteen minutes a payout has always needed: these
 * move real rupees in one tap, and `STEP_UP_HOURS` is the window for batched
 * work rather than for an act with a price on it. The rule and the reason for
 * each of these is in `lib/config/admin-money.ts`, and a test reads these
 * sources so a new one cannot be written without it.
 */
export async function decideSurveyFeeAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const profile = gate.profile;

  const result = await decideSurveyVisitFee({
    feeId: String(formData.get("feeId") ?? ""),
    approve: formData.get("verdict") === "approve",
    note: String(formData.get("note") ?? ""),
    actorId: profile.id,
  });

  if (result.ok) revalidatePath("/[locale]/(admin)/admin/survey-fees", "page");
  return result;
}
