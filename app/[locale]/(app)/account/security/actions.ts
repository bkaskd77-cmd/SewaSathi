"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { enrollTotp, verifyTotp } from "@/lib/auth/admin-gate";

/**
 * Setting up and using a second factor.
 *
 * NOT ADMIN-ONLY, and that is deliberate. The gate applies to admins, but
 * anybody may add a second factor to their own account if they want one — and
 * more to the point, this is the screen an admin without a factor is SENT to,
 * so gating it on having passed the gate would be a locked door with its key
 * inside. Every call acts on the caller's own session and nothing else: there
 * is no id to pass, so there is no id to forge.
 */

const SECURITY = "/[locale]/(app)/account/security";

export async function startEnrollmentAction(): Promise<
  { ok: true; factorId: string; qr: string; secret: string } | { ok: false; reason: string }
> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "signedOut" };

  return enrollTotp(profile.fullName?.trim() || "SajiloKaam");
}

/**
 * Confirm a code — the last step of enrolment, and the re-challenge.
 *
 * One action for both, because Supabase treats them identically and two would
 * be two chances to pass the wrong factor id.
 */
export async function confirmCodeAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "signedOut" };

  const factorId = String(formData.get("factorId") ?? "").trim();
  const result = await verifyTotp({
    factorId: factorId || undefined,
    code: String(formData.get("code") ?? ""),
  });

  if (result.ok) revalidatePath(SECURITY, "page");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
