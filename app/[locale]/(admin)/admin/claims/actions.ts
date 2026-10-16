"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
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
 *
 * A FRESH SECOND FACTOR, NOT THE EIGHT-HOUR ADMIN WINDOW. `freshAdminActor()`
 * is `adminActor()` plus the fifteen minutes a payout has always needed: these
 * move real rupees in one tap, and `STEP_UP_HOURS` is the window for batched
 * work rather than for an act with a price on it. The rule and the reason for
 * each of these is in `lib/config/admin-money.ts`, and a test reads these
 * sources so a new one cannot be written without it.
 */
export async function decideClaimAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const profile = gate.profile;

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
): Promise<{ ok: boolean; reason?: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const profile = gate.profile;

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
