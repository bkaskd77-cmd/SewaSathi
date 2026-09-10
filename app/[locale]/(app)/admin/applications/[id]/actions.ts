"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
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

  const result = await decideApplication({
    applicationId: String(formData.get("applicationId") ?? ""),
    adminId: profile.id,
    decision: decision as "approved" | "rejected" | "more_info",
    reason: String(formData.get("reason") ?? ""),
    internalNote: String(formData.get("internalNote") ?? ""),
  });

  if (result.ok) {
    revalidatePath("/[locale]/(app)/admin/applications", "page");
    revalidatePath("/[locale]/(app)/admin/applications/[id]", "page");
  }

  return result;
}
