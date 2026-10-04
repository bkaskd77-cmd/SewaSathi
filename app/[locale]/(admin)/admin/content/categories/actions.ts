"use server";

import { revalidatePath } from "next/cache";

import { recordSecurityEvent } from "@/lib/audit";
import { adminActor } from "@/lib/auth/admin-gate";
import { setCategoryContent } from "@/lib/data/content";

/**
 * Change one category's words, its icon or where it sits in the grid.
 *
 * THE ADMIN CHECK IS HERE AS WELL AS ON THE PAGE, the standing rule for every server
 * action in this product: an action is a public POST endpoint, and the page guard only
 * stops somebody SEEING the screen. The icon is checked in the data layer and again by
 * the check constraint, so a caller naming a name the picker never offered gets a
 * sentence rather than a blank tile on the grid.
 *
 * NOTHING ABOUT PRICE IS IN THIS FORM OR IN THIS ACTION. `base_price_min` and
 * `base_price_max` are a published band; moving one is `/admin/bands`, where a proposal
 * carries its evidence and a rejection is stored in `category_price_revisions`. A field
 * here would route around all of it, on a number `freeze_booking_band` stamps onto every
 * booking.
 *
 * THE WHOLE LOCALE TREE IS REVALIDATED, not one path. Category words render on the
 * landing grid, on `/services`, on every category page and inside the triage prompt —
 * `getCategories` is a per-request React `cache`, so there is no tag to expire and
 * revalidating one path would leave the rest of the site on the old wording until it
 * re-rendered for some other reason. That is the half-applied change that makes somebody
 * edit the same line twice. (Giving the catalogue its own `unstable_cache` tag is the
 * better shape and is already on the latency list; it is a shared-read change and not
 * this screen's to make.)
 */
export async function setCategoryAction(
  formData: FormData,
): Promise<{ ok: boolean; reason?: string }> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "notAllowed" };

  const str = (name: string) => String(formData.get(name) ?? "");
  const slug = str("slug");

  const sortOrder = Number.parseInt(str("sortOrder"), 10);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false, reason: "badSortOrder" };
  }

  const result = await setCategoryContent({
    slug,
    nameEn: str("nameEn"),
    nameNe: str("nameNe"),
    descriptor: str("descriptor"),
    descriptorNe: str("descriptorNe"),
    description: str("description"),
    descriptionNe: str("descriptionNe"),
    ctaLabel: str("ctaLabel"),
    ctaLabelNe: str("ctaLabelNe"),
    icon: str("icon"),
    sortOrder,
    actorId: profile.id,
  });

  /*
   * A SAVE THAT CHANGED NOTHING LEAVES NO TRAIL AND REVALIDATES NOTHING. Somebody who
   * opens a category, reads it and presses Save has not edited anything, and an audit row
   * saying they did makes every real edit harder to find.
   */
  if (result.ok && result.changed !== null && Object.keys(result.changed ?? {}).length === 0) {
    return { ok: true, reason: "unchanged" };
  }

  if (result.ok) {
    await recordSecurityEvent({
      kind: "admin.action",
      actorRole: "admin",
      actorId: profile.id,
      subjectType: "profile",
      subjectId: profile.id,
      detail: {
        action: "content.categoryEdited",
        slug,
        /*
         * THE BEFORE AND AFTER, which is the opposite of what `setStringAction` logs and
         * for a reason rather than by accident: a string edit writes
         * `content_string_revisions`, so recording the words here would be a second copy
         * nobody can filter. A category has no revisions table — `categories` is already
         * the live source — so this append-only row IS the history, and a trail that
         * recorded only the slug could not answer what a category used to say.
         *
         * NULL MEANS THE PREVIOUS ROW WAS UNREADABLE, never "nothing changed" (rule 6).
         */
        changed: result.changed ?? null,
      },
    });
    revalidatePath("/[locale]", "layout");
  }

  return result;
}
