"use server";

import { revalidatePath } from "next/cache";

import { recordSecurityEvent } from "@/lib/audit";
import { adminActor, freshAdminActor } from "@/lib/auth/admin-gate";
import {
  addCategory,
  reopenCategory,
  retireCategory,
  type CategoryWriteResult,
} from "@/lib/data/categories-admin";
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

/**
 * What the three standing actions give the screen back.
 *
 * THE GATE'S OWN REASON IS PASSED THROUGH RATHER THAN CAST, `addAreaAction`'s
 * note: `isReauthReason` keys on `reauthNeeded` to render `ReauthNotice` — one
 * sentence with a link to the code — and flattening it to `refused` would print
 * "that did not save" at somebody whose only problem was a fifteen-minute
 * window, with no way to find the remedy.
 */
type StandingResult = CategoryWriteResult | { ok: false; reason: string };

function field(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Open a trade, withdraw one, or sell it again.
 *
 * A FRESH SECOND FACTOR ON ALL THREE, where `setCategoryAction` above keeps the
 * eight-hour window — and the asymmetry on one screen is the point rather than
 * an accident of what was written when. Editing a descriptor is reversible and
 * costs nothing; withdrawing a trade stops every future booking in it, which is
 * our revenue there and the work of every professional who offers it, and
 * opening one starts taking bookings on a band nobody has researched. That is
 * `stateBandAction`'s distinction, two rows over in `/admin/bands`.
 *
 * All three are declared in `lib/config/admin-money.ts` and
 * `tests/unit/admin-money-reauth.test.ts` reads this file through the
 * TypeScript AST, so the gate cannot be dropped from one of them quietly.
 *
 * `revalidatePath` WITH "layout", for the reason `setCategoryAction` already
 * records at length: a trade reaches the landing grid, `/services`, its own
 * page, the booking flow and the triage prompt, and `getCategories` is a
 * per-request `cache` with no tag to expire.
 */
export async function addCategoryAction(
  data: FormData,
): Promise<StandingResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const model = field(data, "pricingModel") === "survey" ? "survey" : "band";

  /*
   * THE BAND IS PARSED, NEVER ROUNDED — the `rupees()` lesson from the stated
   * band form. `Number("1200.50")` is 1200.5 and `Math.round` would make it
   * 1201, a floor somebody did not type; `addCategory` refuses a non-integer
   * and says so, and this only has to not hide it first. A blank becomes NaN,
   * which is also refused.
   */
  const rupees = (name: string) => {
    const raw = field(data, name);
    return raw === "" ? Number.NaN : Number(raw);
  };

  const result = await addCategory({
    slug: field(data, "slug"),
    nameEn: field(data, "nameEn"),
    nameNe: field(data, "nameNe"),
    descriptor: field(data, "descriptor"),
    descriptorNe: field(data, "descriptorNe"),
    description: field(data, "description"),
    descriptionNe: field(data, "descriptionNe"),
    ctaLabel: field(data, "ctaLabel"),
    ctaLabelNe: field(data, "ctaLabelNe"),
    icon: field(data, "icon"),
    pricingModel: model,
    bandMin: rupees("bandMin"),
    bandMax: rupees("bandMax"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath("/[locale]", "layout");
  return result;
}

export async function retireCategoryAction(
  data: FormData,
): Promise<StandingResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const result = await retireCategory({
    slug: field(data, "slug"),
    reason: field(data, "reason"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath("/[locale]", "layout");
  return result;
}

export async function reopenCategoryAction(
  data: FormData,
): Promise<StandingResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const result = await reopenCategory({
    slug: field(data, "slug"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath("/[locale]", "layout");
  return result;
}
