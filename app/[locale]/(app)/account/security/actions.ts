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

/**
 * The label on the factor, and it is a CONSTANT rather than the person's name.
 *
 * It used to be `profile.fullName`, which made a display name load-bearing for
 * an API call: every apostrophe, bracket and Devanagari character in the user
 * base becomes a possible enrolment failure, for that person and nobody else.
 * Enrolment IS failing for the live admin, whose name is "Bikas Khadka
 * (admin)" — spaces and parentheses — but whether the name is the cause was
 * never established, because the provider's error was being discarded. It is
 * surfaced now (`describeEnrollError`); this change stands on its own either
 * way, since a label on a factor has no business coming from a person's name.
 *
 * The friendly name labels the FACTOR, not its owner: it is what sits beside
 * "Authenticator app" in a list of devices. Supabase only needs it unique per
 * user, and a person has one of these.
 */
const FACTOR_NAME = "Authenticator";

export async function startEnrollmentAction(): Promise<
  | { ok: true; factorId: string; qr: string; secret: string }
  | { ok: false; reason: string; detail?: string }
> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "signedOut" };

  return enrollTotp(FACTOR_NAME);
}

/**
 * Confirm a code — the last step of enrolment, and the re-challenge.
 *
 * One action for both, because Supabase treats them identically and two would
 * be two chances to pass the wrong factor id.
 */
export async function confirmCodeAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string; detail?: string }> {
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
