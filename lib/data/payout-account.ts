import "server-only";

import { maskAccountRef } from "@/lib/payments";
import { isSealed, openSecret } from "@/lib/security/secret-box";

/**
 * Reading `provider_applications.payout_account`, which is sealed — mostly.
 *
 * WHY THIS TOLERATES A BARE NUMBER, AND WHY THAT IS TEMPORARY. Two rows in this
 * table were written before sealing existed, so during the conversion the column
 * holds both shapes. `openSecret` throws on a bare number by design — it must
 * never hand back its input — so a reader that assumed an envelope would break
 * the admin review screen for exactly the two applications that matter.
 *
 * THE DAY `remainingPlaintext` IS 0 AND THE SHAPE CONSTRAINT LANDS, the legacy
 * branch becomes unreachable and should be deleted along with
 * `/api/maintenance/seal-applications`. It is written as a branch rather than a
 * silent fallback so that deletion is a visible edit and not a discovery.
 *
 * NEITHER FUNCTION THROWS. A value that will not open means the key changed
 * without a re-seal, which is a deployment fault; a draft form or a review screen
 * failing to render tells whoever is looking nothing about that, where an empty
 * field at least reads as "not available". The throw is logged by the sweep,
 * which is the one caller in a position to act on it.
 */

/** The digits, or null. For the owner's own form and for a server-side comparison. */
export function openPayoutAccount(stored: string | null): string | null {
  if (!stored) return null;
  if (!isSealed(stored)) return stored; // legacy plaintext — see above.
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
