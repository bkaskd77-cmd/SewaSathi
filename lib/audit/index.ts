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
  /** A person settled that disagreement, and which figure they settled on. */
  | "payment.mismatchResolved"
  | "commission.appealResolved"
  /* Identity documents — Phase 10 */
  | "document.uploaded"
  | "document.viewed"
  /* What a stranger recorded about a customer, and who read it */
  | "customerRisk.viewed"
  /* Somebody's phone number was put on an admin's screen */
  | "contact.viewed"
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

/**
 * Somebody looked at what professionals recorded about a customer.
 *
 * THE SAME RULE AS `recordDocumentAccess` AND FOR A SHARPER REASON. The
 * customer cannot read these flags, cannot answer them and cannot ask for them
 * to be corrected — so the only protections left are that the record decides
 * nothing on its own, that it ages out, and that every human read is on a log
 * the application cannot edit. This is the third.
 *
 * `action` is what FOLLOWED, not just that a page was opened. A log of reads
 * with no outcomes cannot answer the question worth asking — whether this is
 * quietly driving decisions — and that question is the whole point of keeping
 * it. "nothing" is a real and common answer; recording it is what makes the
 * others mean something.
 *
 * Its own function rather than a call site, so it cannot be quietly skipped.
 */
export async function recordRiskAccess(input: {
  adminId: string;
  customerId: string;
  reason: string;
  action: string;
}): Promise<void> {
  await recordSecurityEvent({
    kind: "customerRisk.viewed",
    actorId: input.adminId,
    actorRole: "admin",
    subjectType: "profile",
    subjectId: input.customerId,
    detail: { reason: input.reason, action: input.action },
  });
}

/**
 * An admin had somebody's phone number on their screen.
 *
 * THE SAME RISK AS AN IDENTITY DOCUMENT, SO THE SAME STANDARD. A phone number
 * is the one piece of personal data this product holds about everybody — it is
 * the login, so there is no account without one — and it is the piece most
 * useful to somebody who should not have it. Documents got a mandatory log the
 * day they were built; numbers did not, and the only reason is that nobody
 * asked the question about them.
 *
 * ITS OWN FUNCTION, like `recordDocumentAccess` and `recordRiskAccess`, so the
 * read and the record cannot drift apart. A `kind` on the general logger would
 * be one more thing a call site can forget.
 *
 * `count` RATHER THAN THE NUMBERS THEMSELVES. A log that holds the data it is
 * logging access to is a second copy of that data, in a table designed to be
 * kept for ever and read by people — which is the rule at the top of this
 * file, and phone numbers are exactly what it is about. The subject id says
 * whose screen it was; the numbers stay where they live.
 *
 * WHAT THIS DOES NOT COVER, and it is worth being plain about: this records
 * reads that go through our code. The policies "Admins can read every profile"
 * and "Admins read every contact" still let an admin read numbers straight
 * through PostgREST or the Supabase dashboard with no trace. Closing that
 * means narrowing those two policies, which is a schema change and a separate
 * decision.
 */
export async function recordContactAccess(input: {
  adminId: string;
  /** Whose numbers were shown — the profile the screen was about. */
  subjectId: string;
  /** How many phone numbers appeared. Never the numbers. */
  count: number;
  reason: string;
}): Promise<void> {
  await recordSecurityEvent({
    kind: "contact.viewed",
    actorId: input.adminId,
    actorRole: "admin",
    subjectType: "profile",
    subjectId: input.subjectId,
    detail: { count: input.count, reason: input.reason },
  });
}
