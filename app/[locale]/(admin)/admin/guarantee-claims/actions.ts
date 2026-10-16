"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
import {
  issueRefund,
  markRefundPaid,
  sendRefundToGateway,
} from "@/lib/data/claims";

/**
 * The three things a person can do about guarantee money.
 *
 * THE ADMIN CHECK IS HERE AS WELL AS ON THE PAGE AND AGAIN IN THE DATA LAYER,
 * the same rule `decideSurveyFeeAction` follows: a server action is a public
 * POST endpoint, and a page guard stops somebody SEEING the screen while doing
 * nothing to stop them calling this. These three move real money, so the
 * duplication is the point rather than a smell.
 *
 * APPROVING AND PAYING ARE TWO ACTIONS BECAUSE THEY ARE TWO EVENTS. eSewa has
 * no merchant-initiated refund on ePay v2 and cash comes back the way it went
 * out, so on two of our three rails a person leaves this product, sends the
 * money, and comes back to record that they did. Folding them into one button
 * would have this product assert a payment nobody made.
 *
 * A FRESH SECOND FACTOR, NOT THE EIGHT-HOUR ADMIN WINDOW. `freshAdminActor()`
 * is `adminActor()` plus the fifteen minutes a payout has always needed: these
 * move real rupees in one tap, and `STEP_UP_HOURS` is the window for batched
 * work rather than for an act with a price on it. The rule and the reason for
 * each of these is in `lib/config/admin-money.ts`, and a test reads these
 * sources so a new one cannot be written without it.
 */

const QUEUE = "/[locale]/(admin)/admin/guarantee-claims";

/** Approve money back on a claim. Writes a refund at `requested`, never sent. */
export async function issueRefundAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const profile = gate.profile;

  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount)) return { ok: false, reason: "invalid" };

  const result = await issueRefund({
    claimId: String(formData.get("claimId") ?? ""),
    amount: Math.round(amount),
    actorId: profile.id,
    note: String(formData.get("note") ?? ""),
  });

  if (result.ok) revalidatePath(QUEUE, "page");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

/** Record that somebody has actually sent it, with the reference it went under. */
export async function markRefundPaidAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const profile = gate.profile;

  const result = await markRefundPaid({
    refundId: String(formData.get("refundId") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    paidAt: String(formData.get("paidAt") ?? ""),
    actorId: profile.id,
  });

  if (result.ok) revalidatePath(QUEUE, "page");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

/** Send it through the gateway, where the rail can carry it. Khalti only. */
export async function sendRefundAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const profile = gate.profile;

  const result = await sendRefundToGateway({
    refundId: String(formData.get("refundId") ?? ""),
    actorId: profile.id,
  });

  if (result.ok) revalidatePath(QUEUE, "page");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
