import "server-only";

import {
  CUSTOMER_LADDER,
  TRIP_COMPENSATION,
  judgeCustomerLadder,
  tripDebtFor,
} from "@/lib/abuse";
import { recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { customerHistory } from "@/lib/data/customer-risk";
import { findDuplicates, type DuplicateHit } from "@/lib/data/verification";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { documentsFor, identityMatchingIsLive } from "@/lib/verification";

/**
 * Everything a reviewer needs on one screen, and what happens when they decide.
 *
 * THE REVIEW IS WHERE VERIFICATION SUCCEEDS OR FAILS. Every rule in
 * `lib/verification` is preparation for one tired person at the end of an
 * afternoon deciding whether to click approve. So this file's job is not to
 * summarise — it is to put the actual evidence in front of them: the prior
 * application beside the new one, the documents at a size a number can be read
 * at, and what is missing named rather than counted.
 *
 * NOTHING HERE RETURNS A RECOMMENDATION. There is no `suggested` field and
 * there must never be one. A screen that says "looks fine" is a screen whose
 * reviewer stops looking, and the whole point of a human in this loop is that
 * they see what a rule could not.
 */

export type ReviewDocument = {
  id: string;
  kind: string;
  required: boolean;
  /**
   * Whether a file exists. NOT a URL — that is minted on demand.
   *
   * A signed URL handed out at render is a link that has already started
   * expiring and an audit entry for a look nobody took. See the note beside
   * the query below.
   */
  hasFile: boolean;
  captureQuality: number | null;
  expiresOn: string | null;
};

export type ReviewReference = {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
  outcome: string;
};

export type ApplicationForReview = {
  id: string;
  status: string;
  fullName: string | null;
  fullNameNe: string | null;
  dateOfBirth: string | null;
  trades: string[];
  serviceAreas: string[];
  citizenshipNumber: string | null;
  panNumber: string | null;
  payoutMethod: string | null;
  payoutAccount: string | null;
  yearsExperience: number | null;
  submittedAt: string | null;
  riskScore: number;
  documents: ReviewDocument[];
  missingKinds: string[];
  references: ReviewReference[];
  assessments: Array<{
    id: string;
    categorySlug: string;
    result: string;
    notes: string;
    assessedAt: string;
  }>;
  duplicates: DuplicateHit[];
  /** False while no vendor is configured — a person compares the faces. */
  identityAutomated: boolean;
  decisions: Array<{
    decision: string;
    reason: string;
    decidedAt: string;
  }>;
};

/**
 * Load one application, minting a signed URL per document.
 *
 * EVERY URL MINTED IS LOGGED against the admin who asked, by
 * `signDocumentForReview`. An admin looking at somebody's citizenship
 * certificate is the access nobody would otherwise ever see, and admins are
 * the largest single risk in a platform holding these.
 */
export async function applicationForReview(input: {
  applicationId: string;
  adminId: string;
}): Promise<ApplicationForReview | null> {
  if (!hasSupabaseConfig()) return null;
  const db = createAdminClient();

  const { data: application, error } = await db
    .from("provider_applications")
    .select("*")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (error || !application) {
    console.error(`[review] loading — ${describeError(error)}`);
    return null;
  }

  const [documentRows, referenceRows, assessmentRows, decisionRows, duplicates] =
    await Promise.all([
      db
        .from("provider_documents")
        .select("id, kind, capture_quality, expires_on, status")
        .eq("application_id", input.applicationId)
        .neq("status", "expired"),
      db
        .from("application_references")
        .select("id, name, phone, relationship, outcome")
        .eq("application_id", input.applicationId),
      db
        .from("application_assessments")
        .select("id, category_slug, result, notes, assessed_at")
        .eq("application_id", input.applicationId),
      db
        .from("application_decisions")
        .select("decision, reason, decided_at")
        .eq("application_id", input.applicationId)
        .order("decided_at", { ascending: false }),
      findDuplicates(input.applicationId),
    ]);

  const byKind = new Map(
    (documentRows.data ?? []).map((row) => [row.kind as string, row]),
  );

  const wanted = documentsFor((application.trades as string[]) ?? []);
  const documents: ReviewDocument[] = [];
  const missingKinds: string[] = [];

  for (const requirement of wanted) {
    const row = byKind.get(requirement.kind);
    if (!row) {
      if (requirement.required) missingKinds.push(requirement.kind);
      documents.push({
        id: `missing-${requirement.kind}`,
        kind: requirement.kind,
        required: requirement.required,
        hasFile: false,
        captureQuality: null,
        expiresOn: null,
      });
      continue;
    }
    documents.push({
      id: row.id as string,
      kind: requirement.kind,
      required: requirement.required,
      /*
       * NOT SIGNED HERE, AND THAT IS A CORRECTNESS FIX AS WELL AS A BUG FIX.
       *
       * Minting a URL for every document when the page renders did two wrong
       * things. The links died: a signed URL lives two minutes, and a reviewer
       * reading the evidence properly — which is the entire point of this
       * screen — clicked one several minutes later and got an expired-token
       * error instead of a photograph.
       *
       * Worse, `signDocumentForReview` writes the access to the audit log. So
       * simply opening the queue recorded the admin as having viewed every
       * identity document on it, including the ones they never opened. That
       * makes the log useless exactly where it matters most, and it quietly
       * undercut the opened-documents gate and the time-on-evidence measure,
       * both of which exist to make real looking distinguishable from
       * clicking approve.
       *
       * The URL is now minted when the reviewer actually asks for it, so the
       * link is seconds old when it is used and the log records an opening
       * that happened.
       */
      hasFile: true,
      captureQuality: (row.capture_quality as number | null) ?? null,
      expiresOn: (row.expires_on as string | null) ?? null,
    });
  }

  return {
    id: application.id as string,
    status: application.status as string,
    fullName: (application.full_name as string | null) ?? null,
    fullNameNe: (application.full_name_ne as string | null) ?? null,
    dateOfBirth: (application.date_of_birth as string | null) ?? null,
    trades: (application.trades as string[]) ?? [],
    serviceAreas: (application.service_areas as string[]) ?? [],
    citizenshipNumber: (application.citizenship_number as string | null) ?? null,
    panNumber: (application.pan_number as string | null) ?? null,
    payoutMethod: (application.payout_method as string | null) ?? null,
    payoutAccount: (application.payout_account as string | null) ?? null,
    yearsExperience: (application.years_experience as number | null) ?? null,
    submittedAt: (application.submitted_at as string | null) ?? null,
    riskScore: (application.risk_score as number | null) ?? 0,
    documents,
    missingKinds,
    references: (referenceRows.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      phone: row.phone as string,
      relationship: (row.relationship as string | null) ?? null,
      outcome: row.outcome as string,
    })),
    assessments: (assessmentRows.data ?? []).map((row) => ({
      id: row.id as string,
      categorySlug: row.category_slug as string,
      result: row.result as string,
      notes: row.notes as string,
      assessedAt: row.assessed_at as string,
    })),
    duplicates,
    identityAutomated: identityMatchingIsLive(),
    decisions: (decisionRows.data ?? []).map((row) => ({
      decision: row.decision as string,
      reason: row.reason as string,
      decidedAt: row.decided_at as string,
    })),
  };
}

export type DecisionResult = { ok: boolean; error?: string };

/**
 * Record a decision, and carry out what it means.
 *
 * THE REASON IS NOT OPTIONAL AND IT IS SHOWN TO THE APPLICANT. "Rejected" with
 * nothing they can act on turns a fixable problem — a missing police
 * clearance — into a competitor's plumber. The database enforces a minimum
 * length; this enforces that somebody wrote something.
 *
 * APPROVAL CREATES A PROVISIONAL PROVIDER, never an established one. The
 * documents describe one moment; behaviour over time is the signal, and
 * `lib/verification/probation.ts` is what graduates them.
 */
export async function decideApplication(input: {
  applicationId: string;
  adminId: string;
  decision: "approved" | "rejected" | "more_info";
  reason: string;
  internalNote?: string;
  /**
   * Seconds between the review page opening and this being sent.
   *
   * Recorded, never enforced. Nothing here refuses a fast decision — the point
   * is that a run of two-second approvals is visible to whoever reads the
   * audit trail later, which is a smaller and more honest claim than
   * pretending the interface can make somebody look.
   */
  secondsOnEvidence?: number | null;
}): Promise<DecisionResult> {
  if (!hasSupabaseConfig()) return { ok: false, error: "unavailable" };
  if (input.reason.trim().length < 5) return { ok: false, error: "reason" };

  const db = createAdminClient();

  const { data: application } = await db
    .from("provider_applications")
    .select("id, profile_id, status, risk_score, full_name, trades, service_areas, years_experience")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!application) return { ok: false, error: "notFound" };
  if (!["submitted", "in_review"].includes(application.status as string)) {
    // Already decided. Append-only means this is not a thing to overwrite.
    return { ok: false, error: "alreadyDecided" };
  }

  const { error: decisionError } = await db
    .from("application_decisions")
    .insert({
      application_id: input.applicationId,
      decision: input.decision,
      decided_by: input.adminId,
      reason: input.reason.trim(),
      internal_note: input.internalNote?.trim() || null,
      risk_score_at_decision: (application.risk_score as number | null) ?? null,
      seconds_on_evidence: input.secondsOnEvidence ?? null,
    });

  if (decisionError) {
    console.error(`[review] decision — ${describeError(decisionError)}`);
    return { ok: false, error: "generic" };
  }

  const nextStatus =
    input.decision === "approved"
      ? "approved"
      : input.decision === "rejected"
        ? "rejected"
        : "in_review";

  await db
    .from("provider_applications")
    .update({ status: nextStatus })
    .eq("id", input.applicationId);

  if (input.decision === "approved") {
    const { error: providerError } = await db.from("providers").insert({
      profile_id: application.profile_id as string,
      application_id: input.applicationId,
      display_name: (application.full_name as string) ?? "Professional",
      service_areas: (application.service_areas as string[]) ?? [],
      years_experience: (application.years_experience as number | null) ?? 0,
      is_verified: true,
      verified_at: new Date().toISOString(),
      id_document_status: "verified",
      checks: ["id", "background"],
      // Probation. Never established on day one.
      standing: "provisional",
      approved_at: new Date().toISOString(),
      base_rate: 500,
    });

    if (providerError) {
      console.error(`[review] provider — ${describeError(providerError)}`);
    } else {
      const { data: provider } = await db
        .from("providers")
        .select("id")
        .eq("application_id", input.applicationId)
        .maybeSingle();

      if (provider) {
        await db.from("provider_categories").insert(
          ((application.trades as string[]) ?? []).map((slug) => ({
            provider_id: provider.id as string,
            category_slug: slug,
          })),
        );
      }
    }

    /*
     * EARLY DELETION, the obligation `EARLY_DELETION` names.
     *
     * The moment a later application is approved, the documents from this
     * person's REJECTED attempts go — they are only kept ninety days so
     * somebody can queue for a police clearance and come back, and they have
     * come back. Waiting out the rest of the window would be holding
     * photographs of somebody's identity for no reason at all.
     */
    const { data: priorRejected } = await db
      .from("provider_applications")
      .select("id")
      .eq("profile_id", application.profile_id as string)
      .eq("status", "rejected");

    const priorIds = (priorRejected ?? []).map((row) => row.id as string);
    if (priorIds.length > 0) {
      const { data: staleDocuments } = await db
        .from("provider_documents")
        .select("id, storage_path")
        .in("application_id", priorIds);

      const paths = (staleDocuments ?? []).map(
        (row) => row.storage_path as string,
      );
      if (paths.length > 0) {
        await db.storage.from("provider-documents").remove(paths);
        await db
          .from("provider_documents")
          .update({ status: "expired" })
          .in("application_id", priorIds);
      }

      await recordSecurityEvent({
        kind: "admin.action",
        actorRole: "admin",
        actorId: input.adminId,
        subjectType: "profile",
        subjectId: application.profile_id as string,
        detail: {
          action: "documents.deletedOnReapproval",
          applications: priorIds.length,
          files: paths.length,
        },
      });
    }
  }

  await recordSecurityEvent({
    kind: "admin.action",
    actorRole: "admin",
    actorId: input.adminId,
    subjectType: "profile",
    subjectId: input.applicationId,
    detail: {
      action: "application.decided",
      decision: input.decision,
      riskScore: (application.risk_score as number | null) ?? null,
      secondsOnEvidence: input.secondsOnEvidence ?? null,
    },
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Wasted trips
 * ------------------------------------------------------------------ */

export type OpenClaim = {
  id: string;
  bookingId: string;
  reference: string;
  providerName: string | null;
  waitedMinutes: number;
  contactAttempts: number;
  hasLocation: boolean;
  customerConfirmed: boolean;
  addressProven: boolean;
  customerDisputed: boolean;
  customerNote: string | null;
  tripRupees: number;
  /**
   * Whether upholding this would be absorbed by us rather than billed on.
   *
   * Shown because it changes what the reviewer is actually deciding: a
   * first-time no-show is a write-off, and somebody weighing a write-off reads
   * thin evidence differently from somebody about to charge a customer.
   */
  wouldBeAbsorbed: boolean;
};

/** Claims a person still has to decide, oldest first. */
export async function openNoShowClaims(): Promise<OpenClaim[]> {
  if (!hasSupabaseConfig()) return [];
  const db = createAdminClient();

  const { data, error } = await db
    .from("no_show_claims")
    .select("*")
    .in("status", ["open", "needs_person"])
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error(`[claims] queue — ${describeError(error)}`);
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const bookingIds = rows.map((row) => row.booking_id as string);
  const [{ data: arrivals }, { data: bookings }, { data: providers }] =
    await Promise.all([
      db
        .from("booking_arrivals")
        .select("booking_id, waited_minutes, contact_attempts, coarse_lat")
        .in("booking_id", bookingIds),
      db
        .from("bookings")
        .select("id, reference, address_id, confirmed_at")
        .in("id", bookingIds),
      db
        .from("providers")
        .select("id, display_name")
        .in(
          "id",
          rows.map((row) => row.provider_id as string),
        ),
    ]);

  const arrivalBy = new Map(
    (arrivals ?? []).map((row) => [row.booking_id as string, row]),
  );
  const bookingBy = new Map(
    (bookings ?? []).map((row) => [row.id as string, row]),
  );
  const providerBy = new Map(
    (providers ?? []).map((row) => [row.id as string, row]),
  );

  const claims: OpenClaim[] = [];
  for (const row of rows) {
    const bookingId = row.booking_id as string;
    const booking = bookingBy.get(bookingId);
    const arrival = arrivalBy.get(bookingId);

    // Derived rather than stored: a completed job at this door is the only
    // honest proof, and a stale copy of it would quietly stop mattering.
    const { count } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("address_id", (booking?.address_id as string) ?? "")
      .eq("status", "completed");

    const history = await customerHistory(row.customer_id as string);
    const ladder = judgeCustomerLadder(history);

    claims.push({
      id: row.id as string,
      bookingId,
      reference: (booking?.reference as string) ?? "—",
      providerName:
        (providerBy.get(row.provider_id as string)?.display_name as string) ??
        null,
      waitedMinutes: (arrival?.waited_minutes as number) ?? 0,
      contactAttempts: (arrival?.contact_attempts as number) ?? 0,
      hasLocation: arrival?.coarse_lat != null,
      customerConfirmed: booking?.confirmed_at != null,
      addressProven: (count ?? 0) > 0,
      customerDisputed: row.customer_disputed_at != null,
      customerNote: (row.customer_note as string | null) ?? null,
      tripRupees: TRIP_COMPENSATION.rupees,
      wouldBeAbsorbed:
        tripDebtFor({
          effectiveStrikesBefore: ladder.effectiveStrikes,
          depositStep: CUSTOMER_LADDER.depositAt,
        }) === 0,
    });
  }

  return claims;
}
