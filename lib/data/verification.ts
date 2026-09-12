import "server-only";

import { createHash } from "node:crypto";

import { recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  matchKeysFor,
  queuePriority,
  scoreApplication,
  type MatchKey,
  type MatchKeyKind,
  type ReferenceOutcome,
  type RiskVerdict,
} from "@/lib/verification";

/**
 * Where an application meets the database, and the only place a match key is
 * ever hashed.
 *
 * SERVICE ROLE, and the same rule as `lib/data/payments.ts`: this file holds a
 * key that bypasses RLS on a path a member of the public can reach, so treat
 * an edit to it the way you would treat shared code. Every function re-reads
 * the subject rather than believing what it was handed — three authorization
 * holes have been found in this product and all three were the same shape, an
 * id that arrived from a browser and nothing asking whose it was.
 *
 * WHY THE HASHING LIVES HERE AND NOT IN `lib/verification`. That module is
 * isomorphic on purpose: the application form has to judge a photograph and
 * warn about an obvious duplicate on a cheap phone with a bad connection,
 * without a round trip. `node:crypto` would drag the whole module server-side.
 * So the normalising is shared and the hashing is the server's, which is also
 * where it belongs — the hash is a storage decision, not a matching one.
 */

/**
 * SHA-256 of `kind:value`, hex.
 *
 * THE KIND IS IN THE HASH so a document number can never collide with a bank
 * account that happens to be the same digits. Without it, "1234567890" as a
 * citizenship number and "1234567890" as an eSewa account would be the same
 * row, and a reviewer would be shown a duplicate that is not one.
 */
export function hashMatchKey(kind: MatchKeyKind, value: string): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

export type DuplicateHit = {
  kind: MatchKeyKind;
  /** The application this key also belongs to. */
  applicationId: string;
  status: string;
  fullName: string | null;
  submittedAt: string | null;
  /** True when that prior application was rejected, or its provider removed. */
  againstRemoved: boolean;
};

/**
 * Everybody else who shares a key with this application.
 *
 * THE ATTACK THIS ANSWERS: a provider removed for putting a customer at risk
 * buys a new SIM and applies again. They can change their phone number, their
 * email and how they spell their own name for almost nothing. What they cannot
 * cheaply change is their citizenship number, the bank account their money
 * arrives in, and their face — so those are what is compared.
 *
 * IT SEARCHES REJECTED AND REMOVED APPLICATIONS TOO, which is the whole point.
 * A duplicate check that only looks at active providers catches somebody
 * applying twice by accident and misses the one case that matters.
 *
 * NOTHING HERE REJECTS ANYBODY. It returns evidence for a person to read.
 */
export async function findDuplicates(
  applicationId: string,
): Promise<DuplicateHit[]> {
  if (!hasSupabaseConfig()) return [];
  const db = createAdminClient();

  const { data: mine, error: keyError } = await db
    .from("application_match_keys")
    .select("kind, key_hash")
    .eq("application_id", applicationId);

  if (keyError) {
    console.error(`[verification] reading keys — ${describeError(keyError)}`);
    return [];
  }
  if (!mine || mine.length === 0) return [];

  const hashes = mine.map((row) => row.key_hash as string);

  const { data: others, error } = await db
    .from("application_match_keys")
    .select(
      "kind, key_hash, application_id, provider_applications(id, status, full_name, submitted_at, profile_id)",
    )
    .in("key_hash", hashes)
    .neq("application_id", applicationId);

  if (error) {
    console.error(`[verification] duplicate lookup — ${describeError(error)}`);
    return [];
  }

  const hits: DuplicateHit[] = [];
  for (const row of others ?? []) {
    const application = (row as Record<string, unknown>)
      .provider_applications as {
      id: string;
      status: string;
      full_name: string | null;
      submitted_at: string | null;
    } | null;
    if (!application) continue;

    hits.push({
      kind: row.kind as MatchKeyKind,
      applicationId: application.id,
      status: application.status,
      fullName: application.full_name,
      submittedAt: application.submitted_at,
      againstRemoved: application.status === "rejected",
    });
  }

  /*
   * A removed provider whose application was approved at the time.
   *
   * Checked separately because the STATUS of the application stays "approved"
   * — the removal happens on `providers`, later. Reading only the application
   * status would miss exactly the person this function exists to catch, which
   * is the kind of gap that looks like it works right up until it matters.
   */
  const approvedIds = hits
    .filter((hit) => hit.status === "approved")
    .map((hit) => hit.applicationId);

  if (approvedIds.length > 0) {
    const { data: removed } = await db
      .from("providers")
      .select("application_id, removed_at")
      .in("application_id", approvedIds)
      .not("removed_at", "is", null);

    const removedIds = new Set(
      (removed ?? []).map((row) => row.application_id as string),
    );
    for (const hit of hits) {
      if (removedIds.has(hit.applicationId)) hit.againstRemoved = true;
    }
  }

  return hits;
}

/**
 * Compute and store the keys for an application, then score it.
 *
 * COMPUTED AT SUBMISSION, not at review time. A key written when the row is
 * written is a key that can be indexed, and a comparison that runs at review
 * time quietly stops running the day somebody adds a second review path.
 */
export async function sealApplication(input: {
  applicationId: string;
  /** Re-read from the session by the caller. Never taken from the browser. */
  actorId: string;
}): Promise<{ ok: boolean; risk?: RiskVerdict; duplicates?: DuplicateHit[] }> {
  if (!hasSupabaseConfig()) return { ok: false };
  const db = createAdminClient();

  const { data: application, error } = await db
    .from("provider_applications")
    .select("*")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (error || !application) {
    console.error(`[verification] sealing — ${describeError(error)}`);
    return { ok: false };
  }

  // THE OWNERSHIP CHECK, and it is re-read here rather than trusted from the
  // caller for the same reason every other one in this product is.
  if (application.profile_id !== input.actorId) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "customer",
      actorId: input.actorId,
      subjectType: "profile",
      subjectId: input.applicationId,
      detail: { refused: "notYourApplication", action: "application.seal" },
    });
    return { ok: false };
  }

  /*
   * The referees, read at sealing rather than carried on the application.
   *
   * A reference is the only human check on competence in this phase, so the
   * cheap way to defeat it is one friend vouching for six applicants rather
   * than any forgery. Keys are what make that visible across applications.
   */
  const { data: referenceRows } = await db
    .from("application_references")
    .select("phone")
    .eq("application_id", input.applicationId);

  const keys: MatchKey[] = matchKeysFor({
    documentNumbers: [
      application.citizenship_number ?? "",
      application.pan_number ?? "",
    ],
    accounts: [application.payout_account ?? ""],
    fullName: application.full_name ?? "",
    areaKeys: (application.service_areas as string[]) ?? [],
    deviceFingerprint: application.device_fingerprint ?? undefined,
    referencePhones: (referenceRows ?? []).map((row) => row.phone as string),
  });

  if (keys.length > 0) {
    const { error: writeError } = await db
      .from("application_match_keys")
      .upsert(
        keys.map((key) => ({
          application_id: input.applicationId,
          kind: key.kind,
          key_hash: hashMatchKey(key.kind, key.value),
        })),
        { onConflict: "application_id,kind,key_hash", ignoreDuplicates: true },
      );
    if (writeError) {
      console.error(`[verification] writing keys — ${describeError(writeError)}`);
      return { ok: false };
    }
  }

  const duplicates = await findDuplicates(input.applicationId);
  const risk = await scoreOne(db, application, duplicates);

  const { error: updateError } = await db
    .from("provider_applications")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      risk_score: risk.score,
    })
    .eq("id", input.applicationId)
    .eq("status", "draft");

  if (updateError) {
    console.error(`[verification] submitting — ${describeError(updateError)}`);
    return { ok: false };
  }

  await recordSecurityEvent({
    kind: "admin.action",
    actorRole: "customer",
    actorId: input.actorId,
    subjectType: "profile",
    subjectId: input.applicationId,
    detail: {
      action: "application.submitted",
      riskScore: risk.score,
      // Kinds only, never the hashes: this table is read by people.
      duplicateKinds: Array.from(new Set(duplicates.map((d) => d.kind))),
      duplicatesAgainstRemoved: duplicates.filter((d) => d.againstRemoved).length,
    },
  });

  return { ok: true, risk, duplicates };
}

/** Score one application from what is actually stored against it. */
async function scoreOne(
  db: ReturnType<typeof createAdminClient>,
  application: Record<string, unknown>,
  duplicates: DuplicateHit[],
): Promise<RiskVerdict> {
  const applicationId = application.id as string;

  const [{ data: documents }, { data: references }, { data: assessments }] =
    await Promise.all([
      db
        .from("provider_documents")
        .select("kind, capture_quality, status")
        .eq("application_id", applicationId),
      db
        .from("application_references")
        .select("outcome")
        .eq("application_id", applicationId),
      db
        .from("application_assessments")
        .select("result")
        .eq("application_id", applicationId),
    ]);

  const { requiredDocumentsFor } = await import("@/lib/verification");
  const required = requiredDocumentsFor(
    (application.trades as string[]) ?? [],
  );
  const supplied = new Set((documents ?? []).map((d) => d.kind as string));
  const missingRequired = required.filter((kind) => !supplied.has(kind)).length;

  const qualities = (documents ?? [])
    .map((d) => d.capture_quality as number | null)
    .filter((q): q is number => typeof q === "number");
  /*
   * ONE WHEN NOTHING HAS BEEN UPLOADED, not zero. A blank application is
   * incomplete — which `missingRequired` already charges for — and it must not
   * additionally be accused of blurry photographs it never took.
   */
  const documentQuality =
    qualities.length === 0
      ? 1
      : qualities.reduce((a, b) => a + b, 0) / qualities.length;

  const outcomes = (references ?? []).map((r) => r.outcome as ReferenceOutcome);
  const referenceOutcome: ReferenceOutcome = outcomes.includes("negative")
    ? "negative"
    : outcomes.includes("positive")
      ? "positive"
      : outcomes.includes("unreachable")
        ? "unreachable"
        : "not_contacted";

  const hasCtevt = supplied.has("ctevt");
  const assessmentPassed = (assessments ?? []).some(
    (a) => a.result === "pass" || a.result === "conditional",
  );

  return scoreApplication({
    // Only hits against somebody we removed or rejected count. A hit against
    // an active provider is usually the same person adding a second trade.
    duplicateHitsAgainstRemoved: duplicates
      .filter((hit) => hit.againstRemoved)
      .map((hit) => hit.kind),
    missingRequired,
    documentQuality,
    references: referenceOutcome,
    competenceEstablished: hasCtevt || assessmentPassed,
  });
}

export type QueueRow = {
  applicationId: string;
  fullName: string | null;
  trades: string[];
  serviceAreas: string[];
  status: string;
  submittedAt: string | null;
  riskScore: number;
  waitingDays: number;
  priority: number;
};

/**
 * The review queue, sorted by the thing that actually loses supply.
 *
 * WAITING DOMINATES. A genuine plumber who waits three weeks has already
 * signed up with a competitor, and that loss appears in no metric anybody
 * looks at. Risk brings a flagged application forward too, so nothing rots,
 * but it cannot outrank a fortnight of silence.
 *
 * `demand` is 0 until there is enough booking data for it to mean anything.
 * Passing a made-up number would be worse than passing none: it would sort the
 * queue by a fiction and nobody would know.
 */
export async function reviewQueue(now: Date = new Date()): Promise<QueueRow[]> {
  if (!hasSupabaseConfig()) return [];
  const db = createAdminClient();

  const { data, error } = await db
    .from("provider_applications")
    .select("id, full_name, trades, service_areas, status, submitted_at, risk_score")
    .in("status", ["submitted", "in_review"])
    .order("submitted_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error(`[verification] queue — ${describeError(error)}`);
    return [];
  }

  return (data ?? [])
    .map((row) => {
      const submittedAt = row.submitted_at as string | null;
      const waitingDays = submittedAt
        ? Math.floor(
            (now.getTime() - new Date(submittedAt).getTime()) / 86_400_000,
          )
        : 0;
      const riskScore = (row.risk_score as number | null) ?? 0;
      return {
        applicationId: row.id as string,
        fullName: row.full_name as string | null,
        trades: (row.trades as string[]) ?? [],
        serviceAreas: (row.service_areas as string[]) ?? [],
        status: row.status as string,
        submittedAt,
        riskScore,
        waitingDays,
        priority: queuePriority({ waitingDays, demand: 0, riskScore }),
      };
    })
    .sort((a, b) => b.priority - a.priority);
}
