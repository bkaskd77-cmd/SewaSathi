import "server-only";

import { headers } from "next/headers";

import { recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/supabase";
import {
  CONSENT_SCOPE,
  CONSENT_VERSION,
  knownTrade,
} from "@/lib/verification";

/**
 * The resumable draft: reading it, saving one step of it, and nothing else.
 *
 * THE SESSION WILL DROP. That is the design constraint, not an edge case. The
 * person filling this in is a tradesperson on a cheap Android phone on mobile
 * data, often standing somewhere with one bar, and the application takes long
 * enough that they will close it and come back. So every step saves on its
 * own, nothing is held in a wizard's memory, and reopening the page three days
 * later on a different phone resumes where they stopped.
 *
 * WHICH IS WHY THE STEP IS IN THE DATABASE and not in a cookie or a URL. A
 * cookie does not survive a new phone, and a URL does not survive being closed.
 *
 * Service role, and the same rule as every other file that holds it: the
 * actor is re-read from the session by the caller and the subject is re-read
 * here. Nothing trusts an id that arrived from a browser.
 */

export type ApplicationDraft = {
  id: string;
  step: number;
  status: string;
  fullName: string | null;
  fullNameNe: string | null;
  dateOfBirth: string | null;
  trades: string[];
  yearsExperience: number | null;
  serviceAreas: string[];
  citizenshipNumber: string | null;
  panNumber: string | null;
  payoutMethod: string | null;
  payoutAccount: string | null;
  payoutBankName: string | null;
  hasConsent: boolean;
  submittedAt: string | null;
};

/** Total steps. Mirrors the `step between 1 and 8` check on the table. */
export const APPLY_STEPS = 8;

function toDraft(
  row: Record<string, unknown>,
  hasConsent: boolean,
): ApplicationDraft {
  return {
    id: row.id as string,
    step: (row.step as number) ?? 1,
    status: row.status as string,
    fullName: (row.full_name as string | null) ?? null,
    fullNameNe: (row.full_name_ne as string | null) ?? null,
    dateOfBirth: (row.date_of_birth as string | null) ?? null,
    trades: (row.trades as string[]) ?? [],
    yearsExperience: (row.years_experience as number | null) ?? null,
    serviceAreas: (row.service_areas as string[]) ?? [],
    citizenshipNumber: (row.citizenship_number as string | null) ?? null,
    panNumber: (row.pan_number as string | null) ?? null,
    payoutMethod: (row.payout_method as string | null) ?? null,
    payoutAccount: (row.payout_account as string | null) ?? null,
    payoutBankName: (row.payout_bank_name as string | null) ?? null,
    hasConsent,
    submittedAt: (row.submitted_at as string | null) ?? null,
  };
}

/**
 * The application this person is in the middle of, or their most recent one.
 *
 * Returns a finished application too, because somebody who has submitted needs
 * to see that it is with us rather than an empty form implying it was lost.
 * An application that disappears into silence is how supply is lost.
 */
export async function currentApplication(
  profileId: string,
): Promise<ApplicationDraft | null> {
  if (!hasSupabaseConfig()) return null;
  const db = createAdminClient();

  const { data, error } = await db
    .from("provider_applications")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[applications] reading — ${describeError(error)}`);
    return null;
  }
  if (!data) return null;

  const { count } = await db
    .from("application_consents")
    .select("id", { count: "exact", head: true })
    .eq("application_id", data.id)
    .eq("consent_version", CONSENT_VERSION)
    .is("withdrawn_at", null);

  return toDraft(data, (count ?? 0) > 0);
}

/** Start one, or return the open one. Idempotent on a double tap. */
export async function startApplication(
  profileId: string,
  locale: string,
): Promise<ApplicationDraft | null> {
  const existing = await currentApplication(profileId);
  if (existing && ["draft", "submitted", "in_review"].includes(existing.status)) {
    return existing;
  }

  if (!hasSupabaseConfig()) return null;
  const db = createAdminClient();

  const { data, error } = await db
    .from("provider_applications")
    .insert({ profile_id: profileId, locale })
    .select("*")
    .single();

  if (error) {
    console.error(`[applications] starting — ${describeError(error)}`);
    return null;
  }
  return toDraft(data, false);
}

export type StepPatch = {
  fullName?: string;
  fullNameNe?: string;
  dateOfBirth?: string;
  trades?: string[];
  yearsExperience?: number;
  serviceAreas?: string[];
  citizenshipNumber?: string;
  panNumber?: string;
  payoutMethod?: string;
  payoutAccount?: string;
  payoutBankName?: string;
  deviceFingerprint?: string;
};

export type SaveResult =
  | { ok: true; step: number }
  | { ok: false; error: "notFound" | "notYours" | "locked" | "invalid" };

/**
 * Save one step and move on.
 *
 * `step` is written as the FURTHEST reached, never decremented, so going back
 * to fix a spelling on step two does not throw away steps three to six. Going
 * backwards is a normal thing to do on a long form and losing work for it is
 * the fastest way to make somebody give up.
 */
export async function saveStep(input: {
  applicationId: string;
  actorId: string;
  step: number;
  patch: StepPatch;
}): Promise<SaveResult> {
  if (!hasSupabaseConfig()) return { ok: false, error: "notFound" };
  const db = createAdminClient();

  const { data: application } = await db
    .from("provider_applications")
    .select("id, profile_id, status, step")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!application) return { ok: false, error: "notFound" };

  // Re-read, never trusted. Three authorization holes in this product have
  // been the same shape: an id from a browser and nothing asking whose it was.
  if (application.profile_id !== input.actorId) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "customer",
      actorId: input.actorId,
      subjectType: "profile",
      subjectId: input.applicationId,
      detail: { refused: "notYourApplication", action: "application.saveStep" },
    });
    return { ok: false, error: "notYours" };
  }

  // Once submitted it is evidence, not a form.
  if (application.status !== "draft") return { ok: false, error: "locked" };

  const trades = input.patch.trades?.filter(knownTrade);
  if (input.patch.trades && (!trades || trades.length === 0)) {
    return { ok: false, error: "invalid" };
  }

  type ApplicationUpdate =
    Database["public"]["Tables"]["provider_applications"]["Update"];
  const update: ApplicationUpdate = {
    step: Math.max(application.step ?? 1, Math.min(input.step, APPLY_STEPS)),
  };
  const map: Array<[keyof StepPatch, string]> = [
    ["fullName", "full_name"],
    ["fullNameNe", "full_name_ne"],
    ["dateOfBirth", "date_of_birth"],
    ["yearsExperience", "years_experience"],
    ["serviceAreas", "service_areas"],
    ["citizenshipNumber", "citizenship_number"],
    ["panNumber", "pan_number"],
    ["payoutMethod", "payout_method"],
    ["payoutAccount", "payout_account"],
    ["payoutBankName", "payout_bank_name"],
    ["deviceFingerprint", "device_fingerprint"],
  ];
  const writable = update as Record<string, unknown>;
  for (const [from, to] of map) {
    const value = input.patch[from];
    if (value !== undefined && value !== "") writable[to] = value;
  }
  if (trades) update.trades = trades;

  const { error } = await db
    .from("provider_applications")
    .update(update)
    .eq("id", input.applicationId)
    .eq("status", "draft");

  if (error) {
    console.error(`[applications] saving step — ${describeError(error)}`);
    return { ok: false, error: "invalid" };
  }

  return { ok: true, step: update.step as number };
}

/**
 * Record consent, server-stamped, before a single document is collected.
 *
 * THE TIMESTAMP IS OURS. A consent a browser could time is a consent an
 * attacker could time, and this is the row that would be produced if somebody
 * asked under Nepal's Individual Privacy Act. The IP and user agent go with
 * it for the same reason: they are what makes it a record rather than a claim.
 */
export async function recordConsent(input: {
  applicationId: string;
  actorId: string;
}): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const db = createAdminClient();

  const { data: application } = await db
    .from("provider_applications")
    .select("id, profile_id")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!application || application.profile_id !== input.actorId) return false;

  const headerBag = headers();
  const { error } = await db.from("application_consents").insert({
    application_id: input.applicationId,
    profile_id: input.actorId,
    consent_version: CONSENT_VERSION,
    scope: [...CONSENT_SCOPE],
    request_ip:
      headerBag.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: headerBag.get("user-agent")?.slice(0, 400) ?? null,
  });

  if (error) {
    console.error(`[applications] consent — ${describeError(error)}`);
    return false;
  }

  await recordSecurityEvent({
    kind: "admin.action",
    actorRole: "customer",
    actorId: input.actorId,
    subjectType: "profile",
    subjectId: input.applicationId,
    detail: { action: "application.consentGranted", version: CONSENT_VERSION },
  });

  return true;
}

/** The references somebody has listed, for the review step. */
export async function listReferences(applicationId: string) {
  if (!hasSupabaseConfig()) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("application_references")
    .select("id, name, phone, relationship")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function addReference(input: {
  applicationId: string;
  actorId: string;
  name: string;
  phone: string;
  relationship: string;
}): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const db = createAdminClient();

  const { data: application } = await db
    .from("provider_applications")
    .select("id, profile_id, status")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (
    !application ||
    application.profile_id !== input.actorId ||
    application.status !== "draft"
  ) {
    return false;
  }

  const { error } = await db.from("application_references").insert({
    application_id: input.applicationId,
    name: input.name.slice(0, 120),
    phone: input.phone.slice(0, 20),
    relationship: ["employer", "customer", "colleague", "other"].includes(
      input.relationship,
    )
      ? input.relationship
      : "other",
  });

  return !error;
}

/** Which documents have arrived, for the progress display and the review step. */
export async function listApplicationDocuments(applicationId: string) {
  if (!hasSupabaseConfig()) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("provider_documents")
    .select("id, kind, status, capture_quality, uploaded_at")
    .eq("application_id", applicationId)
    .order("uploaded_at", { ascending: true });
  return data ?? [];
}
