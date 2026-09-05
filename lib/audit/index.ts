import "server-only";

import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What happened, who did it, and when — written where nobody can rewrite it.
 *
 * TWO JOBS, and they pull in the same direction. In a dispute this is the
 * evidence: who typed the final amount, when the customer approved it, which
 * admin looked at whose citizenship certificate. After a breach it is the
 * forensics: what the attacker touched and in what order. Neither can be
 * reconstructed afterwards, which is why the log has to start before it is
 * needed rather than the day somebody asks for it.
 *
 * APPEND-ONLY IS ENFORCED IN THE DATABASE, not here. `security_events` has a
 * trigger that refuses UPDATE and DELETE for every caller including the
 * service role this file uses. A log the application can edit proves nothing —
 * the first thing anybody with our own key would do is tidy up after
 * themselves.
 *
 * IT NEVER THROWS, for the same reason `notify` never throws: the event has
 * already happened. A booking that rolled back because its log entry failed
 * would be a product that breaks when its safety net does. A write that fails
 * is logged to the console, which on Vercel is itself a durable record.
 *
 * WHAT MUST NOT GO IN `detail`: a token, a password, an OTP, a full document,
 * a card number. This table is read by people, and a log that holds secrets is
 * a second copy of them in a place designed to be kept for ever.
 */

export type SecurityEventKind =
  /* Authentication */
  | "auth.otpRequested"
  | "auth.signedIn"
  | "auth.signedOut"
  | "auth.otpFailed"
  /* Authorisation and roles */
  | "role.changed"
  | "access.denied"
  /* Money — the events a dispute is argued from */
  | "payment.amountRecorded"
  | "payment.amountApproved"
  | "payment.amountDisputed"
  | "payment.settled"
  | "payment.mismatch"
  | "commission.appealResolved"
  /* Identity documents — Phase 10 */
  | "document.uploaded"
  | "document.viewed"
  | "document.reviewed"
  /* Anything an admin does at all */
  | "admin.action";

export type ActorRole = "customer" | "provider" | "admin" | "system" | "anonymous";

export type SecurityEvent = {
  kind: SecurityEventKind;
  /** Null for the system itself: a cron sweep, a gateway callback. */
  actorId?: string | null;
  actorRole?: ActorRole;
  subjectType?: "booking" | "payment" | "profile" | "document" | "provider";
  subjectId?: string | null;
  /** Facts, never secrets. See the note above. */
  detail?: Record<string, unknown>;
  /** Enough to tell one session from another. Never a token. */
  requestIp?: string | null;
  userAgent?: string | null;
};

export async function recordSecurityEvent(event: SecurityEvent): Promise<void> {
  if (!hasSupabaseConfig()) return;

  try {
    const { error } = await createAdminClient()
      .from("security_events")
      .insert({
        kind: event.kind,
        actor_id: event.actorId ?? null,
        actor_role: event.actorRole ?? (event.actorId ? "customer" : "system"),
        subject_type: event.subjectType ?? null,
        subject_id: event.subjectId ?? null,
        detail: event.detail ?? {},
        request_ip: event.requestIp ?? null,
        user_agent: event.userAgent?.slice(0, 500) ?? null,
      });

    if (error) {
      console.error(`[audit] ${event.kind} not recorded — ${describeError(error)}`);
    }
  } catch (thrown) {
    // Never rethrown. The thing being logged already happened.
    console.error(`[audit] ${event.kind} threw — ${describeError(thrown)}`);
  }
}

/**
 * The one that must never be skipped: somebody's identity document was looked
 * at, and by whom.
 *
 * A separate function rather than a `kind` on the general one, because this is
 * the access nobody would otherwise ever see. A professional cannot tell that
 * an admin opened their citizenship certificate, and an admin who wanted to
 * would have no reason to mention it. Making it its own call means the code
 * that mints a signed URL cannot quietly forget to record it — the two live
 * together or the reviewer notices.
 */
export async function recordDocumentAccess(input: {
  adminId: string;
  documentId: string;
  ownerId: string;
  reason: string;
}): Promise<void> {
  await recordSecurityEvent({
    kind: "document.viewed",
    actorId: input.adminId,
    actorRole: "admin",
    subjectType: "document",
    subjectId: input.documentId,
    detail: { ownerId: input.ownerId, reason: input.reason },
  });
}
