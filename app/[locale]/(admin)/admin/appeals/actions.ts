"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
import { resolveCommissionAppeal } from "@/lib/data/payments";

/**
 * Uphold or refuse one commission appeal.
 *
 * Upholding sets `commission_floor_waived` and the split is recomputed against
 * the rate frozen at settlement, so a rate change since then never rewrites
 * what somebody was already told they had earned. All of that is
 * `resolveCommissionAppeal`; this establishes who is asking.
 *
 * A FRESH SECOND FACTOR, NOT THE EIGHT-HOUR ADMIN WINDOW. `freshAdminActor()`
 * is `adminActor()` plus the fifteen minutes a payout has always needed: these
 * move real rupees in one tap, and `STEP_UP_HOURS` is the window for batched
 * work rather than for an act with a price on it. The rule and the reason for
 * each of these is in `lib/config/admin-money.ts`, and a test reads these
 * sources so a new one cannot be written without it.
 */
export async function resolveAppealAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const profile = gate.profile;

  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { ok: false, reason: "reasonRequired" };

  const result = await resolveCommissionAppeal({
    appealId: String(formData.get("appealId") ?? ""),
    adminId: profile.id,
    uphold: formData.get("verdict") === "uphold",
    note,
  });

  if (result.ok) revalidatePath("/[locale]/(admin)/admin/appeals", "page");
  return result;
}
