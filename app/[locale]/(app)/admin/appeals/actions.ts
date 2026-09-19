"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { resolveCommissionAppeal } from "@/lib/data/payments";

/**
 * Uphold or refuse one commission appeal.
 *
 * Upholding sets `commission_floor_waived` and the split is recomputed against
 * the rate frozen at settlement, so a rate change since then never rewrites
 * what somebody was already told they had earned. All of that is
 * `resolveCommissionAppeal`; this establishes who is asking.
 */
export async function resolveAppealAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { ok: false, reason: "notAdmin" };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { ok: false, reason: "reasonRequired" };

  const result = await resolveCommissionAppeal({
    appealId: String(formData.get("appealId") ?? ""),
    adminId: profile.id,
    uphold: formData.get("verdict") === "uphold",
    note,
  });

  if (result.ok) revalidatePath("/[locale]/(app)/admin/appeals", "page");
  return result;
}
