import "server-only";

import { recordDocumentAccess, recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { checkUploadedImage } from "@/lib/security/image";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONSENT_VERSION, consentCovers } from "@/lib/verification";

/**
 * Identity documents: taking one in, and letting a reviewer look at one.
 *
 * CONSENT IS CHECKED HERE, at the moment of upload, and not at the start of
 * the form. The session that started this application may have been three days
 * and one phone ago — that is the normal case for this audience — so the only
 * place the check means anything is immediately before the bytes are written.
 * `consentFirst` is a refusal, not a warning.
 *
 * THE PATH CARRIES THE OWNER: `<profile_id>/<kind>/<uuid>.jpg`. It is what the
 * storage policy compares against, the same shape as booking photos and for
 * the same reason.
 *
 * EVERY ADMIN READ IS LOGGED. An admin looking at somebody's citizenship
 * certificate is exactly the access nobody would otherwise ever see, and
 * `recordDocumentAccess` is a separate function precisely so it cannot be
 * quietly folded into a helper and skipped.
 */

const BUCKET = "provider-documents";

/** Short, because the URL is handed to a browser and browsers keep things. */
const SIGNED_URL_SECONDS = 120;

export type UploadRejection =
  | "consentFirst"
  | "notYours"
  | "locked"
  | "tooLarge"
  | "notAnImage"
  | "unsupportedFormat"
  | "tooManyPixels"
  | "corrupt"
  | "uploadFailed";

export type UploadResult =
  | { ok: true; documentId: string }
  | { ok: false; reason: UploadRejection };

export async function uploadProviderDocument(input: {
  applicationId: string;
  actorId: string;
  kind: string;
  /** Data URL or bare base64, straight from the capture component. */
  base64: string;
  /** 0–1 from the on-device capture check, stored so a reviewer can sort. */
  captureQuality?: number;
  /** For the documents that lapse. */
  expiresOn?: string | null;
}): Promise<UploadResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "uploadFailed" };
  const db = createAdminClient();

  const { data: application } = await db
    .from("provider_applications")
    .select("id, profile_id, status")
    .eq("id", input.applicationId)
    .maybeSingle();

  if (!application || application.profile_id !== input.actorId) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "customer",
      actorId: input.actorId,
      subjectType: "profile",
      subjectId: input.applicationId,
      detail: { refused: "notYourApplication", action: "document.upload" },
    });
    return { ok: false, reason: "notYours" };
  }
  if (application.status !== "draft") return { ok: false, reason: "locked" };

  /*
   * THE CONSENT GATE. Read fresh, and matched on version: consent given to an
   * older wording is consent to different words and does not carry.
   */
  const { data: consentRow } = await db
    .from("application_consents")
    .select("consent_version, granted_at, scope")
    .eq("application_id", input.applicationId)
    .eq("consent_version", CONSENT_VERSION)
    .is("withdrawn_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const consent = consentRow
    ? {
        version: consentRow.consent_version as string,
        grantedAt: consentRow.granted_at as string,
        scope: (consentRow.scope as string[]) ?? [],
      }
    : null;

  if (!consentCovers(consent, input.kind)) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "customer",
      actorId: input.actorId,
      subjectType: "profile",
      subjectId: input.applicationId,
      detail: { refused: "consentMissing", kind: input.kind },
    });
    return { ok: false, reason: "consentFirst" };
  }

  // Magic bytes, dimensions from the file's own header, and EXIF stripped —
  // a photograph taken at home carries that home's coordinates.
  const checked = checkUploadedImage(input.base64);
  if (!checked.ok) return { ok: false, reason: checked.reason };

  const path = `${input.actorId}/${input.kind}/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, checked.bytes, { contentType: "image/jpeg", upsert: false });

  if (uploadError) {
    console.error(`[documents] upload — ${describeError(uploadError)}`);
    return { ok: false, reason: "uploadFailed" };
  }

  /*
   * A REPLACEMENT SUPERSEDES RATHER THAN OVERWRITES. The old row is marked
   * and kept, so what was submitted and when survives a change of mind — the
   * storage policy has no update or delete for the same reason.
   */
  await db
    .from("provider_documents")
    .update({ status: "expired" })
    .eq("application_id", input.applicationId)
    .eq("kind", input.kind)
    .eq("status", "pending");

  const { data: inserted, error } = await db
    .from("provider_documents")
    .insert({
      profile_id: input.actorId,
      application_id: input.applicationId,
      kind: input.kind,
      storage_path: path,
      mime_type: "image/jpeg",
      byte_size: checked.bytes.byteLength,
      capture_quality: input.captureQuality ?? null,
      expires_on: input.expiresOn ?? null,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error(`[documents] row — ${describeError(error)}`);
    return { ok: false, reason: "uploadFailed" };
  }

  return { ok: true, documentId: inserted.id as string };
}

/**
 * A short-lived URL for a reviewer, and a log line saying they looked.
 *
 * `adminId` is not optional and there is no variant without it. The logging is
 * the point: this is the most sensitive read in the product, and admins are
 * the largest single risk in a platform holding it.
 */
export async function signDocumentForReview(input: {
  documentId: string;
  adminId: string;
}): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;
  const db = createAdminClient();

  const { data: document } = await db
    .from("provider_documents")
    .select("id, storage_path, kind, profile_id")
    .eq("id", input.documentId)
    .maybeSingle();

  if (!document) return null;

  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(document.storage_path as string, SIGNED_URL_SECONDS);

  if (error || !data) return null;

  await recordDocumentAccess({
    adminId: input.adminId,
    documentId: document.id as string,
    ownerId: document.profile_id as string,
    reason: `Reviewing a provider application — ${document.kind as string}.`,
  });

  return data.signedUrl;
}
