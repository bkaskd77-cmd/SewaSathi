"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { signDocumentForReview } from "@/lib/data/provider-documents";
import { decideApplication } from "@/lib/data/review";

/**
 * The decision.
 *
 * THE ADMIN CHECK IS HERE, not only on the page. A server action is a public
 * POST endpoint: the page's `role !== "admin"` guard stops somebody seeing the
 * screen and does nothing at all to stop them calling this. Re-read the
 * session, check the role, and refuse — the same rule as every other write in
 * this product, and the reason three authorization holes were all the same
 * shape.
 */
export async function decideAction(
  _previous: { ok: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { ok: false, error: "notAllowed" };
  }

  const decision = String(formData.get("decision") ?? "");
  if (!["approved", "rejected", "more_info"].includes(decision)) {
    return { ok: false, error: "generic" };
  }

  const seconds = Number(formData.get("secondsOnEvidence"));

  const result = await decideApplication({
    applicationId: String(formData.get("applicationId") ?? ""),
    adminId: profile.id,
    decision: decision as "approved" | "rejected" | "more_info",
    reason: String(formData.get("reason") ?? ""),
    internalNote: String(formData.get("internalNote") ?? ""),
    secondsOnEvidence: Number.isFinite(seconds) ? Math.max(0, seconds) : null,
  });

  if (result.ok) {
    revalidatePath("/[locale]/(app)/admin/applications", "page");
    revalidatePath("/[locale]/(app)/admin/applications/[id]", "page");
  }

  return result;
}

/**
 * A signed URL for one document, minted at the moment it is asked for.
 *
 * SEPARATE FROM THE PAGE ON PURPOSE. These URLs live two minutes, which is
 * right for a link that is used immediately and useless for one handed out
 * when a page rendered — a reviewer reading the evidence carefully clicked
 * one several minutes later and got an expired-token error.
 *
 * It also puts the audit log back in step with reality. Signing writes an
 * access record, so signing everything at render meant the log claimed the
 * admin had viewed every identity document in the queue, including the ones
 * they never opened. A log that records looks nobody took is worse than no log
 * at all on the one screen where it matters most.
 *
 * The admin check is here rather than only on the page, for the reason at the
 * top of this file: a server action is a public POST endpoint.
 */
export async function openDocumentAction(
  documentId: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") return { ok: false };

  const url = await signDocumentForReview({ documentId, adminId: profile.id });
  return url ? { ok: true, url } : { ok: false };
}
