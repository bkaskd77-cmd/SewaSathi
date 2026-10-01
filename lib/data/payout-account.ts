import "server-only";

import { maskAccountRef } from "@/lib/payments";
import { openSecret } from "@/lib/security/secret-box";

/**
 * Reading `provider_applications.payout_account`, which is sealed.
 *
 * NOTHING ELSE CAN BE STORED THERE NOW.
 * `provider_applications_payout_account_sealed` requires an envelope, so the
 * only shapes that reach these functions are a `v1.…` value and null. There was
 * a branch here returning a bare number unchanged, for the two rows written
 * before sealing existed; the conversion sweep converted them, the constraint
 * landed, and both the branch and the sweep went in the same commit. A tolerance
 * for a shape the database refuses is dead code that reads like a hedge.
 *
 * NEITHER FUNCTION THROWS. A value that will not open means the key changed
 * without a re-seal, which is a deployment fault; a draft form or a review screen
 * failing to render tells whoever is looking nothing about that, where an empty
 * field at least reads as "not available". A bare number arriving here would also
 * read as null — it cannot be stored, so if one appears something has bypassed
 * the planner and the quiet answer is the safe one.
 */

/** The digits, or null. For the owner's own form and for a server-side comparison. */
export function openPayoutAccount(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return openSecret(stored);
  } catch {
    return null;
  }
}

/**
 * `••••4567`, for an admin.
 *
 * A reviewer is checking that the payout name matches the applicant and that the
 * method is one we support; neither needs the digits. `payoutIsSomebodyElses`
 * answers the one question the number itself would be read for, and answers it as
 * a boolean. Null when there is nothing to show, never `••••••••` — an empty
 * field and a hidden value are different facts.
 */
export function maskPayoutAccount(stored: string | null): string | null {
  const plain = openPayoutAccount(stored);
  return plain ? maskAccountRef(plain) : null;
}
