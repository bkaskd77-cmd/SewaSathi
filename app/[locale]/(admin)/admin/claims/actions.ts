"use server";

import { revalidatePath } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import {
  resolveTripDebtDispute,
  settleNoShowClaim,
} from "@/lib/data/customer-risk";

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
  const profile = await adminActor();
  if (!profile) return { ok: false };

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

  if (ok) revalidatePath("/[locale]/(admin)/admin/claims", "page");
  return { ok };
}

/**
 * Decide one customer's objection to a carried trip charge.
 *
 * SAME GUARD AS ABOVE and for the same reason: a server action is a public POST
 * endpoint, and the page guard only stops somebody seeing the screen.
 *
 * `cancel` zeroes the balance, `stands` clears the hold so the next bill recovers.
 * Anything else is refused rather than read as one of the two — a missing or mistyped
 * value must never fall through to the outcome that moves money.
 */
export async function resolveDisputeAction(
  formData: FormData,
): Promise<{ ok: boolean }> {
  const profile = await adminActor();
  if (!profile) return { ok: false };

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return { ok: false };

  const raw = formData.get("outcome");
  if (raw !== "cancel" && raw !== "stands") return { ok: false };

  const ok = await resolveTripDebtDispute({
    customerId: String(formData.get("customerId") ?? ""),
    actorId: profile.id,
    outcome: raw,
    note: reason,
  });

  if (ok) revalidatePath("/[locale]/(admin)/admin/claims", "page");
  return { ok };
}
