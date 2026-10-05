"use server";

import { revalidatePath, updateTag } from "next/cache";

import { recordSecurityEvent } from "@/lib/audit";
import { adminActor } from "@/lib/auth/admin-gate";
import {
  CONTENT_DOCUMENTS_TAG,
  discardWorkingCopy,
  isDocumentSlug,
  publishWorkingCopy,
  restoreVersion,
  saveWorkingCopy,
} from "@/lib/content/documents";
import { documentsFromFields, type SectionPair } from "@/lib/content/prose-text";

/**
 * The four things an admin can do to a document, each checking the admin again.
 *
 * AN ACTION IS A PUBLIC POST ENDPOINT, so every one of these re-reads the session rather
 * than trusting the page that rendered the form — the standing rule, and the one three
 * holes in this product have come from ignoring.
 *
 * THE SLUG IS VALIDATED AGAINST THE EIGHT. A caller naming a ninth would otherwise reach a
 * check constraint, which refuses the write and loses the edit in the same statement.
 */

function fieldsFrom(formData: FormData) {
  const str = (name: string) => String(formData.get(name) ?? "");
  const count = Number.parseInt(str("sectionCount"), 10);
  if (!Number.isInteger(count) || count < 1 || count > 60) return null;

  const sections: SectionPair[] = [];
  for (let i = 0; i < count; i += 1) {
    /* A section marked for removal is simply not collected. The anchor stops resolving,
       which the screen warns about rather than hiding — blanking a section instead is the
       thing people do when removal is not offered, and that is worse. */
    if (str(`section-${i}-remove`) === "on") continue;
    sections.push({
      id: str(`section-${i}-id`),
      headingEn: str(`section-${i}-headingEn`),
      headingNe: str(`section-${i}-headingNe`),
      bodyEn: str(`section-${i}-bodyEn`),
      bodyNe: str(`section-${i}-bodyNe`),
    });
  }

  return {
    titleEn: str("titleEn"),
    titleNe: str("titleNe"),
    leadEn: str("leadEn"),
    leadNe: str("leadNe"),
    draft: str("draft") === "on",
    sections,
  };
}

/** Save the working copy. Nothing a customer can see changes. */
export async function saveDocumentAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await adminActor();
  if (!profile) return { ok: false, error: "notAllowed" };

  const slug = String(formData.get("slug") ?? "");
  if (!isDocumentSlug(slug)) return { ok: false, error: "badSlug" };

  const fields = fieldsFrom(formData);
  if (!fields) return { ok: false, error: "badForm" };

  /*
   * `updated` IS TODAY ON A SAVE AND THE PUBLISH MOMENT ON A PUBLISH — and this one is
   * provisional, because the working copy is not what anybody reads. The published version
   * takes its date from the row's own `effective_from` default, so the two cannot disagree.
   */
  const built = documentsFromFields(fields, new Date().toISOString().slice(0, 10));
  if (!built.ok) return { ok: false, error: built.error };

  const result = await saveWorkingCopy({
    slug,
    en: built.en,
    ne: built.ne,
    actorId: profile.id,
  });

  if (result.ok) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "admin",
      actorId: profile.id,
      subjectType: "profile",
      subjectId: profile.id,
      detail: { action: "content.documentSaved", slug, sections: fields.sections.length },
    });
    revalidatePath("/[locale]/(admin)/admin/content/documents/[...slug]", "page");
  }

  return result.ok ? { ok: true } : { ok: false, error: result.reason };
}

/**
 * Publish the working copy.
 *
 * THE BODY COMES FROM THE STORED ROW, NEVER FROM THIS REQUEST. That is what makes the
 * preview honest — the screen renders the row and this publishes the row, so there is
 * nothing a form could carry between them that the preview did not show.
 */
export async function publishDocumentAction(
  formData: FormData,
): Promise<{ ok: boolean; version?: number; error?: string }> {
  const profile = await adminActor();
  if (!profile) return { ok: false, error: "notAllowed" };

  const slug = String(formData.get("slug") ?? "");
  if (!isDocumentSlug(slug)) return { ok: false, error: "badSlug" };

  /* The confirmation is a required field, not a courtesy. A publish cannot be taken back —
     only superseded — and `bookings.terms_version` points at what a customer agreed to. */
  if (String(formData.get("confirm") ?? "") !== "on") {
    return { ok: false, error: "notConfirmed" };
  }

  const result = await publishWorkingCopy({ slug, actorId: profile.id });

  if (result.ok) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "admin",
      actorId: profile.id,
      subjectType: "profile",
      subjectId: profile.id,
      detail: { action: "content.documentPublished", slug, version: result.version },
    });
    updateTag(CONTENT_DOCUMENTS_TAG);
    revalidatePath("/[locale]", "layout");
  }

  return result.ok
    ? { ok: true, version: result.version }
    : { ok: false, error: result.reason };
}

/** Throw the working copy away. Nothing published is touched. */
export async function discardDocumentAction(formData: FormData): Promise<{ ok: boolean }> {
  const profile = await adminActor();
  if (!profile) return { ok: false };

  const slug = String(formData.get("slug") ?? "");
  if (!isDocumentSlug(slug)) return { ok: false };

  const ok = await discardWorkingCopy(slug);
  if (ok) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "admin",
      actorId: profile.id,
      subjectType: "profile",
      subjectId: profile.id,
      detail: { action: "content.documentDiscarded", slug },
    });
    revalidatePath("/[locale]/(admin)/admin/content/documents/[...slug]", "page");
  }
  return { ok };
}

/**
 * Load an old version into the working copy.
 *
 * A ROLLBACK IS A PUBLISH, NOT AN UNDO — it goes through the same preview, diff and
 * confirmation as any other change and ends as a NEW version with its own number. A
 * pointer moved backwards would leave `bookings.terms_version` naming a version that was
 * live, then not, then live again, and no reading of that history would be true.
 */
export async function restoreDocumentAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await adminActor();
  if (!profile) return { ok: false, error: "notAllowed" };

  const slug = String(formData.get("slug") ?? "");
  const version = Number.parseInt(String(formData.get("version") ?? ""), 10);
  if (!isDocumentSlug(slug) || !Number.isInteger(version)) {
    return { ok: false, error: "badSlug" };
  }

  const result = await restoreVersion({ slug, version, actorId: profile.id });

  if (result.ok) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "admin",
      actorId: profile.id,
      subjectType: "profile",
      subjectId: profile.id,
      detail: { action: "content.documentRestored", slug, version },
    });
    revalidatePath("/[locale]/(admin)/admin/content/documents/[...slug]", "page");
  }

  return result.ok ? { ok: true } : { ok: false, error: result.reason };
}
