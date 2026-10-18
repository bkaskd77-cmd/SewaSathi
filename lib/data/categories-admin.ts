import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { CATEGORY_ICONS } from "@/lib/config/icons";
import { CATEGORY_SLUG_SHAPE } from "@/lib/config/services";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Opening a trade and withdrawing one.
 *
 * SEPARATE FROM `lib/data/categories.ts` FOR THE REASON `areas-admin.ts` IS
 * SEPARATE FROM `areas.ts`: that module is the READ, reached by the landing
 * page, `/services`, every category page and the triage prompt through the
 * cookie-free anon client. This one holds the service-role key. One file would
 * put that key on the import graph of every public page, and `check:secrets`'
 * source pass is what would eventually say so.
 *
 * RETIRE, NEVER DELETE — and here the reason is sharper than it is for a ward.
 * `bookings.category_slug`, `providers.service_areas`' sibling
 * `provider_categories.category_slug`, `category_price_bands.category_slug`,
 * `category_pricing_signals` and `category_price_revisions` all hold this
 * string, and a booking in a deleted trade could not say what the job WAS.
 * There is no delete path and there should never be one.
 *
 * FORWARD ONLY. Retiring stops new bookings and changes nothing that already
 * happened: an open job in that trade still travels, keeps its quote, its band
 * and its guarantee window. `getCategories` stops returning it — so the landing
 * grid, `/services`, the category page, `/book` and the triage prompt all drop
 * it on the next request — while `allCategories` still returns it, which is
 * what keeps a finished booking able to name its own trade.
 */

export type CategoryWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unreadable"
        | "refused"
        | "noReason"
        | "exists"
        | "notFound"
        | "badSlug"
        | "badIcon"
        | "badBand"
        | "blank";
    };

export type NewCategory = {
  slug: string;
  nameEn: string;
  nameNe: string;
  descriptor: string;
  descriptorNe: string;
  description: string;
  descriptionNe: string;
  ctaLabel: string;
  ctaLabelNe: string;
  icon: string;
  /** `survey` publishes no range at all — movers and packers is the case. */
  pricingModel: "band" | "survey";
  /** The published floor and ceiling. Ignored for a survey trade. */
  bandMin: number;
  bandMax: number;
  actorId: string;
};

/**
 * Open a trade.
 *
 * THE BAND IS WRITTEN `invented` AND THAT IS NOT A PLACEHOLDER. A figure typed
 * into a form has not been checked against a competitor or a settled job, and
 * `createBooking` freezes it as `quoted_max` — the ceiling `judgeFinalAmount`
 * measures a 2x overcharge against. `invented` is the honest provenance and it
 * already has the gate it needs: `npm run check:blockers` refuses a launch
 * build while any published band is one. `/admin/bands`' `stateBand` is where a
 * researched figure replaces it, with a reason recorded in an append-only
 * table — which is exactly why there is no provenance field on this form:
 * letting somebody declare their own guess `researched` would route around the
 * one gate that reads the column.
 */
export async function addCategory(
  input: NewCategory,
): Promise<CategoryWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };

  const slug = input.slug.trim().toLowerCase();
  if (!CATEGORY_SLUG_SHAPE.test(slug)) return { ok: false, reason: "badSlug" };

  /*
   * THE ICON IS CHECKED AGAINST THE MAP, not against a list of names. `icon` is
   * a free text column and `categoryIcon` resolves an unknown value to `Wrench`
   * — a silent wrong glyph on the landing grid, which is `?? 0`'s shape for a
   * picture. `CATEGORY_ICONS` is the map's own keys, so this cannot drift from
   * what actually renders.
   */
  if (!(CATEGORY_ICONS as readonly string[]).includes(input.icon)) {
    return { ok: false, reason: "badIcon" };
  }

  const words = {
    nameEn: input.nameEn.trim(),
    nameNe: input.nameNe.trim(),
    descriptor: input.descriptor.trim(),
    descriptorNe: input.descriptorNe.trim(),
    description: input.description.trim(),
    descriptionNe: input.descriptionNe.trim(),
    ctaLabel: input.ctaLabel.trim(),
    ctaLabelNe: input.ctaLabelNe.trim(),
  };
  /*
   * ALL EIGHT OR NONE, `addArea`'s rule with four more fields and the same
   * reason: a trade with English words and no Nepali ones renders Latin script
   * into a Nepali page, where it reads as a trade name somebody chose not to
   * translate rather than as a missing field. Rule 5 — Nepali is not a
   * retrofit, and the columns are NOT NULL anyway, so a blank would be a
   * Postgres error rather than a sentence.
   */
  if (Object.values(words).some((value) => value.length === 0)) {
    return { ok: false, reason: "blank" };
  }

  /*
   * THE BAND IS WHOLE RUPEES, POSITIVE, AND ORDERED — the three things
   * `base_price_min > 0` and `base_price_max >= base_price_min` already refuse,
   * checked here so the refusal is a sentence rather than a constraint name.
   * A survey trade still needs figures the column will accept, because those
   * two columns are NOT NULL; `pricing_model = 'survey'` is what stops any
   * screen printing them — `categoryQuote` answers `survey` first and never
   * looks at the numbers.
   */
  const band =
    input.pricingModel === "survey"
      ? { min: 1, max: 1 }
      : { min: input.bandMin, max: input.bandMax };
  if (
    !Number.isInteger(band.min) ||
    !Number.isInteger(band.max) ||
    band.min <= 0 ||
    band.max < band.min
  ) {
    return { ok: false, reason: "badBand" };
  }

  try {
    const db = createAdminClient();
    const { error } = await db.from("categories").insert({
      slug,
      name_en: words.nameEn,
      name_ne: words.nameNe,
      descriptor: words.descriptor,
      descriptor_ne: words.descriptorNe,
      description: words.description,
      description_ne: words.descriptionNe,
      cta_label: words.ctaLabel,
      cta_label_ne: words.ctaLabelNe,
      base_price_min: band.min,
      base_price_max: band.max,
      pricing_model: input.pricingModel,
      /* See the note above: a typed figure is a guess, and `check:blockers`
         is the gate that reads this column. */
      pricing_source: "invented",
      pricing_checked_at: null,
      pricing_note: null,
      pricing_confidence: "low",
      icon: input.icon,
      /* Last in the grid rather than guessing a position among the ten.
         Somebody can see it, and a wrong order is a cosmetic fix where a
         silent reorder of a grid everybody knows is not. */
      sort_order: 1000,
      is_active: true,
    });

    if (error) {
      /* 23505 is the primary key: the trade exists, retired or not, and
         re-opening a retired one is `reopenCategory` rather than an insert. */
      if (error.code === "23505") return { ok: false, reason: "exists" };
      console.error(`[categories] insert failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }

    await recordSecurityEvent({
      kind: "category.opened",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "category",
      subjectId: slug,
      detail: {
        name: words.nameEn,
        pricingModel: input.pricingModel,
        bandMin: band.min,
        bandMax: band.max,
        /*
         * WHAT IT CANNOT DO YET, IN THE LOG, because these are the
         * consequences nobody would think to look for. `KEYWORD_RULES` and
         * `GUARANTEE_WINDOWS` are TypeScript, so a new trade is invisible to
         * the keyword matcher — which is what answers on every fallback path —
         * and takes the 30-day repair window by default. `/admin/content/
         * categories` prints the same list through `categoryReadiness`; this
         * is the copy that survives in the record.
         */
        gaps: "no keyword rules, no products, invented band, no guarantee window",
      },
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[categories] insert threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}

/**
 * Stop selling a trade.
 *
 * THE REASON IS REQUIRED HERE, BY THE FORM AND BY `categories_retired_shape`.
 * `is_active` has been a bare boolean since the first migration, so until now a
 * withdrawal could only ever have recorded that it happened — and "why did we
 * stop selling water tank cleaning" is exactly the question a withdrawal
 * raises.
 */
export async function retireCategory(input: {
  slug: string;
  reason: string;
  actorId: string;
}): Promise<CategoryWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };
  const reason = input.reason.trim();
  if (reason.length === 0) return { ok: false, reason: "noReason" };

  try {
    const db = createAdminClient();
    /*
     * `is_active` MOVES IN THE SAME STATEMENT, which `categories_retired_shape`
     * requires — the two columns are one fact and the database refuses them out
     * of step. Guarded on it not already being retired, so a double submit is
     * one withdrawal with one date rather than a second that re-dates the
     * first; `notFound` covers "no such trade" and "already retired", which
     * from the screen are the same answer.
     */
    const { data, error } = await db
      .from("categories")
      .update({
        is_active: false,
        retired_at: new Date().toISOString(),
        retired_reason: reason,
        retired_by: input.actorId,
      })
      .eq("slug", input.slug)
      .is("retired_at", null)
      .select("slug");

    if (error) {
      console.error(`[categories] retire failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }
    if (!data || data.length === 0) return { ok: false, reason: "notFound" };

    await recordSecurityEvent({
      kind: "category.retired",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "category",
      subjectId: input.slug,
      detail: { reason },
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[categories] retire threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}

/**
 * Sell a trade again.
 *
 * NOT A ONE-WAY DOOR, `reopenArea`'s reasoning: a trade withdrawn by mistake
 * must not need a migration to come back, and the log carries both moves so the
 * history reads as what happened rather than as a row that was always live. The
 * triple goes back to null together with `is_active`, which the shape
 * constraint requires.
 */
export async function reopenCategory(input: {
  slug: string;
  actorId: string;
}): Promise<CategoryWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("categories")
      .update({
        is_active: true,
        retired_at: null,
        retired_reason: null,
        retired_by: null,
      })
      .eq("slug", input.slug)
      .not("retired_at", "is", null)
      .select("slug");

    if (error) {
      console.error(`[categories] reopen failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }
    if (!data || data.length === 0) return { ok: false, reason: "notFound" };

    await recordSecurityEvent({
      kind: "category.reopened",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "category",
      subjectId: input.slug,
      detail: {},
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[categories] reopen threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}
