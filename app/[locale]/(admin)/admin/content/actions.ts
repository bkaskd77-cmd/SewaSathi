"use server";

import { revalidatePath, updateTag } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import { recordSecurityEvent } from "@/lib/audit";
import {
  CONTENT_STRINGS_TAG,
  rollbackContentString,
  setContentString,
} from "@/lib/data/content";

/**
 * Change one interface string.
 *
 * THE ADMIN CHECK IS HERE AS WELL AS ON THE PAGE, the standing rule for every server
 * action in this product: an action is a public POST endpoint, and the page guard only
 * stops somebody SEEING the screen. `admin.*` is refused in the data layer too, so a
 * caller naming a namespace the form never offers gets nowhere.
 *
 * THE CACHE TAG IS EXPIRED, not the path. `contentOverrides` is cached across visitors
 * and feeds every page in the product through `i18n/request.ts` — revalidating one path
 * would leave the rest of the site showing the old wording until the cache aged out,
 * which is exactly the kind of half-applied change that makes somebody edit the same
 * line twice and wonder why it did not take.
 *
 * `updateTag` RATHER THAN `revalidateTag`, which is a Next 16 distinction worth naming:
 * `revalidateTag` now takes a cache-life profile and marks the entry stale, so the
 * admin who just saved can still be served the old copy on the very next render.
 * `updateTag` expires it immediately and is documented for exactly this — a Server
 * Action that needs read-your-own-writes. Somebody editing a safety line should see the
 * new wording when the page comes back, not a cached version of what they replaced.
 */
export async function setStringAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "notAllowed" };

  const messageKey = String(formData.get("messageKey") ?? "");
  const locale = String(formData.get("locale") ?? "");
  const value = String(formData.get("value") ?? "");
  if (locale !== "en" && locale !== "ne") return { ok: false, reason: "badLocale" };

  const result = await setContentString({
    messageKey,
    locale,
    value,
    actorId: profile.id,
  });

  if (result.ok) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "admin",
      actorId: profile.id,
      subjectType: "profile",
      subjectId: profile.id,
      detail: {
        action: "content.stringEdited",
        messageKey,
        locale,
        // The words themselves live in `content_string_revisions`, which is append-only.
        // Logging them here would put a second copy of the same text in a blob nobody
        // can filter, and the length is what makes a bulk edit visible in a timeline.
        length: value.trim().length,
      },
    });
    updateTag(CONTENT_STRINGS_TAG);
    revalidatePath("/[locale]/(admin)/admin/content", "page");
  }

  return result;
}

/**
 * Put a string back to what it used to say.
 *
 * A ROLLBACK IS A CHANGE, so it is logged like one. A trail that recorded edits and not
 * their undos would show somebody an edit still in force that was reverted an hour
 * later.
 */
export async function rollbackStringAction(
  formData: FormData,
): Promise<{ ok: boolean }> {
  const profile = await adminActor();
  if (!profile) return { ok: false };

  const revisionId = String(formData.get("revisionId") ?? "");
  const ok = await rollbackContentString({ revisionId, actorId: profile.id });

  if (ok) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "admin",
      actorId: profile.id,
      subjectType: "profile",
      subjectId: profile.id,
      detail: { action: "content.stringRolledBack", revisionId },
    });
    updateTag(CONTENT_STRINGS_TAG);
    revalidatePath("/[locale]/(admin)/admin/content", "page");
  }

  return { ok };
}
