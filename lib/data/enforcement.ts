import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { hasSupabaseConfig } from "@/lib/env";
import {
  canLift,
  isEnforcementStep,
  isRemoved,
  type EnforcementStep,
} from "@/lib/provider";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The only writer of the enforcement ladder's state, on both sides.
 *
 * SERVICE ROLE, AND THE SUBJECT IS RE-READ RATHER THAN BELIEVED. Every id here
 * arrives from a form, so nothing is written against it until the row has been
 * read back — the shape this repository records three holes against, all of them
 * an id that came from a browser with nothing asking whose it was.
 *
 * THE REASON IS NOT OPTIONAL AND THE DATABASE AGREES. `providers_enforcement_shape`
 * and `customer_risk_ban_shape` refuse a step or a ban with no words beside it,
 * so a future caller that forgets is refused rather than quietly recorded. The
 * page promises an appeal answered by a human being; a human answering needs
 * something to read.
 *
 * EVERY WRITE IS AUDITED AND THE AUDIT IS THE HISTORY. The columns hold only
 * what is true now. `security_events` is append-only for every caller including
 * this one, so "step 4 was raised on the 3rd and lifted on the 9th" lives there
 * and cannot later be tidied into something else.
 */

export type EnforcementResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "notFound"
        | "needsReason"
        | "badStep"
        /** Step 5 is published as permanent. Coming back means re-applying. */
        | "removedIsPermanent"
        | "writeFailed"
        | "unavailable";
    };

function words(reason: string, max: number): string | null {
  const text = reason.trim();
  if (text.length === 0) return null;
  return text.slice(0, max);
}

/**
 * Raise or change the step in force for one professional.
 *
 * RAISING AND LOWERING ARE ONE CALL on purpose. Step 4 after step 3 and step 3
 * after step 4 are both "a person looked again and decided this"; two functions
 * would need the caller to know which it was, and a caller that got it wrong
 * would write the wrong event kind into a log somebody argues an appeal from.
 */
export async function setEnforcement(input: {
  providerId: string;
  step: EnforcementStep;
  reason: string;
  actorId: string;
}): Promise<EnforcementResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };
  if (!isEnforcementStep(input.step)) return { ok: false, reason: "badStep" };

  const reason = words(input.reason, 2000);
  if (!reason) return { ok: false, reason: "needsReason" };

  const db = createAdminClient();

  const { data: existing, error: readError } = await db
    .from("providers")
    .select("id, enforcement_step")
    .eq("id", input.providerId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!existing) return { ok: false, reason: "notFound" };

  /*
   * ALREADY REMOVED IS THE END OF THE LADDER. Writing step 3 over step 5 would
   * put a removed listing back into the open pool, and `removed_at` would have
   * to be cleared with it — erasing the decision rather than reversing it.
   */
  if (isRemoved(existing.enforcement_step as EnforcementStep | null)) {
    return { ok: false, reason: "removedIsPermanent" };
  }

  const now = new Date().toISOString();

  const { error: writeError } = await db
    .from("providers")
    .update({
      enforcement_step: input.step,
      enforcement_reason: reason,
      enforcement_at: now,
      enforcement_by: input.actorId,
      /*
       * PAIRED HERE AND REFUSED BY THE DATABASE IF IT IS NOT.
       * `providers_removed_is_step_five` is what stops these two disagreeing —
       * four modules already read `removed_at` and none of them knows about the
       * step number.
       */
      removed_at: input.step === 5 ? now : null,
    })
    .eq("id", input.providerId);

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "provider.enforcementRaised",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "provider",
    subjectId: input.providerId,
    detail: {
      step: input.step,
      from: existing.enforcement_step ?? null,
      reason,
    },
  });

  return { ok: true };
}

/**
 * Lift the step. Reversible is the whole point of the first four.
 *
 * STEP 5 IS REFUSED, in `canLift` rather than here, so the screen and the write
 * cannot disagree about what is permanent. The page says removal is permanent
 * and says what happens instead: somebody who should come back re-applies,
 * through `provider_applications`, which records the second decision beside the
 * first. Clearing the column would erase the first one.
 */
export async function liftEnforcement(input: {
  providerId: string;
  reason: string;
  actorId: string;
}): Promise<EnforcementResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const reason = words(input.reason, 2000);
  if (!reason) return { ok: false, reason: "needsReason" };

  const db = createAdminClient();

  const { data: existing, error: readError } = await db
    .from("providers")
    .select("id, enforcement_step")
    .eq("id", input.providerId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!existing) return { ok: false, reason: "notFound" };

  const step = existing.enforcement_step as EnforcementStep | null;
  if (!canLift(step)) {
    return { ok: false, reason: step === 5 ? "removedIsPermanent" : "badStep" };
  }

  const { error: writeError } = await db
    .from("providers")
    .update({
      enforcement_step: null,
      enforcement_reason: null,
      enforcement_at: null,
      enforcement_by: null,
      removed_at: null,
    })
    .eq("id", input.providerId);

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "provider.enforcementLifted",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "provider",
    subjectId: input.providerId,
    detail: { from: step, reason },
  });

  return { ok: true };
}

/**
 * Suspend a customer: reason required, reversible, audited, history kept.
 *
 * THE COLUMNS ARE OLDER THAN THIS FUNCTION BY FIVE WEEKS. `banned_at` and
 * `banned_reason` landed in 20260910000002 and nothing has ever written them —
 * and the one reader turns `banned_at` into a boolean that two admin screens
 * DISPLAY, while `createBooking` never consulted customer risk at all. So the
 * setting existed, could be set by hand, and did nothing: a false control, which
 * is worse than an absent one because somebody would have believed it.
 *
 * UPSERT, BECAUSE A CUSTOMER MAY HAVE NO RISK ROW. `customer_risk` is written
 * when something is recorded about somebody, and a customer nobody has recorded
 * anything about is exactly the one a first suspension is most likely to name.
 */
export async function suspendCustomer(input: {
  profileId: string;
  reason: string;
  actorId: string;
}): Promise<EnforcementResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const reason = words(input.reason, 1000);
  if (!reason) return { ok: false, reason: "needsReason" };

  const db = createAdminClient();

  const { data: person, error: readError } = await db
    .from("profiles")
    .select("id")
    .eq("id", input.profileId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!person) return { ok: false, reason: "notFound" };

  const { error: writeError } = await db.from("customer_risk").upsert(
    {
      profile_id: input.profileId,
      banned_at: new Date().toISOString(),
      banned_reason: reason,
      banned_by: input.actorId,
    },
    { onConflict: "profile_id" },
  );

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "customer.suspended",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "profile",
    subjectId: input.profileId,
    detail: { reason },
  });

  return { ok: true };
}

/**
 * Let them back in. A reason is required for this half too.
 *
 * SYMMETRY IS NOT THE REASON — the record is. A reinstatement with no words is a
 * decision somebody made that nobody can later ask about, and the suspension it
 * reverses is sitting in the same log with its own sentence.
 */
export async function reinstateCustomer(input: {
  profileId: string;
  reason: string;
  actorId: string;
}): Promise<EnforcementResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const reason = words(input.reason, 1000);
  if (!reason) return { ok: false, reason: "needsReason" };

  const db = createAdminClient();

  const { data: existing, error: readError } = await db
    .from("customer_risk")
    .select("profile_id, banned_at, banned_reason")
    .eq("profile_id", input.profileId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!existing || existing.banned_at === null) {
    return { ok: false, reason: "notFound" };
  }

  const { error: writeError } = await db
    .from("customer_risk")
    .update({ banned_at: null, banned_reason: null, banned_by: null })
    .eq("profile_id", input.profileId);

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "customer.reinstated",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "profile",
    subjectId: input.profileId,
    detail: { reason, was: existing.banned_reason ?? null },
  });

  return { ok: true };
}

/**
 * Is this customer stopped from booking right now?
 *
 * THE ONE READ THE BOOKING PATH ASKS, so "suspended" is decided in one place.
 * A failed read returns `null` and the caller decides — rule 6, because
 * answering "not suspended" to a question we could not ask would be the same
 * false control from the other direction.
 */
export async function customerIsSuspended(
  profileId: string,
): Promise<{ suspended: boolean; reason: string | null } | null> {
  if (!hasSupabaseConfig()) return { suspended: false, reason: null };

  const { data, error } = await createAdminClient()
    .from("customer_risk")
    .select("banned_at, banned_reason")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) return null;
  if (!data || data.banned_at === null) return { suspended: false, reason: null };
  return { suspended: true, reason: (data.banned_reason as string) ?? null };
}
