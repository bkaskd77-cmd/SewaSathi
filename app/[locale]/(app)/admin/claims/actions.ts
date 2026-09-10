"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { settleNoShowClaim } from "@/lib/data/customer-risk";

/**
 * Decide one wasted-trip claim.
 *
 * The admin check is here rather than only on the page: a server action is a
 * public POST endpoint, and the page guard stops somebody SEEING the screen
 * while doing nothing to stop them calling this.
 */
export async function decideClaimAction(
  formData: FormData,
): Promise<{ ok: boolean }> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") return { ok: false };

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return { ok: false };

  const seconds = Number(formData.get("secondsOnEvidence"));

  const ok = await settleNoShowClaim({
    bookingId: String(formData.get("bookingId") ?? ""),
    decidedBy: profile.id,
    uphold: formData.get("verdict") === "uphold",
    reason,
    secondsOnEvidence: Number.isFinite(seconds) ? Math.max(0, seconds) : null,
  });

  if (ok) revalidatePath("/[locale]/(app)/admin/claims", "page");
  return { ok };
}
