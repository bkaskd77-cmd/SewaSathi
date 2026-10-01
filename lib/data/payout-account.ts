import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
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
 * field at least reads as "not available".
 *
 * BUT THE SCREEN BEING QUIET IS NOT THE LOG BEING QUIET. Returning null and
 * saying nothing anywhere is how a key problem becomes invisible: every surface
 * renders an empty field, nobody is blocked, and the first signal is a
 * professional asking why their account vanished. So the silence is on the
 * screen only — `security_events` gets a row.
 */

/**
 * Whose row this was. REQUIRED, so an event can never be written that cannot
 * say what it is about.
 *
 * An optional context would degrade silently to an unattributed log line, which
 * is the shape of audit row nobody can act on — and all three callers hold an id
 * already, so there is nothing to make optional for.
 */
export type AccountContext = {
  subjectType: "profile" | "provider";
  subjectId: string;
};

/**
 * Something that cannot be opened was read.
 *
 * FIRE AND FORGET, AND THE REASON IS STATED RATHER THAN HIDDEN. These functions
 * are synchronous and are called from synchronous row mappers; making them async
 * would ripple through every caller for a branch that should never execute. So
 * the write is not awaited, which on a serverless platform means it can be lost
 * if the function returns first.
 *
 * That trade is acceptable HERE AND NOWHERE ELSE in this product, because the
 * check constraint makes this condition impossible: the event records that the
 * impossible happened. If one is lost, something far worse than a missing log
 * row is already true, and the next read writes another.
 */
function reportUnreadable(context: AccountContext): void {
  void recordSecurityEvent({
    kind: "payoutAccount.unreadable",
    actorRole: "system",
    subjectType: context.subjectType,
    subjectId: context.subjectId,
    detail: {
      // Never the value — it could not be opened, and the envelope is no more
      // loggable than the number would have been.
      note: "a stored payout account would not open; PAYOUT_ENCRYPTION_KEY may have changed without a re-seal",
    },
  });
}

/** The digits, or null. For the owner's own form and for a server-side comparison. */
export function openPayoutAccount(
  stored: string | null,
  context: AccountContext,
): string | null {
  if (!stored) return null;
  try {
    return openSecret(stored);
  } catch {
    reportUnreadable(context);
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
export function maskPayoutAccount(
  stored: string | null,
  context: AccountContext,
): string | null {
  const plain = openPayoutAccount(stored, context);
  return plain ? maskAccountRef(plain) : null;
}
