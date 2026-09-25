"use server";

import { revalidatePath } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
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
 */

const QUEUE = "/[locale]/(admin)/admin/guarantee-claims";

/** Approve money back on a claim. Writes a refund at `requested`, never sent. */
export async function issueRefundAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await adminActor();
  if (!profile) {
    return { ok: false, reason: "notAdmin" };
  }

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
  const profile = await adminActor();
  if (!profile) {
    return { ok: false, reason: "notAdmin" };
  }

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
  const profile = await adminActor();
  if (!profile) {
    return { ok: false, reason: "notAdmin" };
  }

  const result = await sendRefundToGateway({
    refundId: String(formData.get("refundId") ?? ""),
    actorId: profile.id,
  });

  if (result.ok) revalidatePath(QUEUE, "page");
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
