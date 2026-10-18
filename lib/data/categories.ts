import "server-only";

import { cache } from "react";

import {
  CATEGORY_SEED,
  SUB_BAND_SEED,
  type Category,
  type SubBand,
} from "@/lib/config/services";
import {
  describeError,
  markDataSource,
  rethrowFrameworkSignal,
} from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The ten service categories.
 *
 * The `categories` table is the source of truth at runtime: the catalogue, the
 * landing grid and the price bands quoted to Claude all read from here, so
 * repricing a category or renaming it happens in one place.
 *
 * `seed/categories.json` is the authored copy. It seeds the table (via
 * scripts/generate-seed-sql.mjs) and it is what we fall back to when Supabase
 * is unconfigured or unreachable — a fresh clone with no keys still renders
 * the whole catalogue rather than an error page.
 *
 * AND "DEGRADES TO SLIGHTLY STALE PRICES" IS WHAT THAT SENTENCE USED TO SAY,
 * which was the whole problem stated as reassurance. `/admin/bands` moves a
 * published band in the TABLE and never in this file, so the gap between the two
 * grows with every decision somebody takes — and a failed read served the older
 * figure on the landing grid, on `/services`, on every category page, and into
 * `createBooking`, where it became the booking's own `quoted_max` and therefore
 * the ceiling `judgeFinalAmount` measures a 2x overcharge against. Not stale
 * decoration: a stale customer protection.
 *
 * `withoutBand` IS THE ANSWER AND IT IS NARROW. On a FAILURE the seed is still
 * the right source for every word on the card — the name, the Nepali, the
 * descriptor, the icon are authored here and cannot go stale against the table
 * in any way that matters — so the catalogue still renders; only the two numbers
 * nobody can vouch for are withheld, and `categoryQuote` turns that into a
 * sentence. **An UNCONFIGURED clone keeps them**, because with no keys the seed
 * IS the data and there is no published band for it to disagree with.
 */

export type { Category };

/** Slugs, in display order. */
export const CATEGORY_SLUGS = CATEGORY_SEED.map((c) => c.slug);

type CategoryRow = {
  slug: string;
  name_en: string;
  name_ne: string;
  descriptor: string;
  descriptor_ne: string;
  description: string;
  description_ne: string;
  cta_label: string;
  cta_label_ne: string;
  base_price_min: number;
  base_price_max: number;
  pricing_source: string;
  pricing_checked_at: string | null;
  pricing_note: string | null;
  pricing_confidence: string;
  pricing_model: string;
  icon: string;
  sort_order: number;
};

/** A category as the admin screen needs it — the words plus its standing. */
export type CategoryRecord = Category & {
  /**
   * When we stopped selling it, with why and who.
   *
   * NULL IS "WE STILL SELL IT", never "unknown" — `categories_retired_shape`
   * refuses a partial triple and keeps `is_active` in step, so these are null
   * together or set together.
   */
  retiredAt: string | null;
  retiredReason: string | null;
  retiredBy: string | null;
};

type RetirementRow = {
  retired_at: string | null;
  retired_reason: string | null;
  retired_by: string | null;
};

function fromRow(row: CategoryRow): Category {
  return {
    slug: row.slug,
    nameEn: row.name_en,
    nameNe: row.name_ne,
    descriptor: row.descriptor,
    descriptorNe: row.descriptor_ne,
    description: row.description,
    descriptionNe: row.description_ne,
    ctaLabel: row.cta_label,
    ctaLabelNe: row.cta_label_ne,
    basePriceMin: row.base_price_min,
    basePriceMax: row.base_price_max,
    /*
     * Falls back to the tightest useful number rather than the loosest. An
     * unreadable capacity should refuse a second booking, not wave it through:
     * a double-booked customer finds out on the day.
     */
    /*
     * An unrecognised value reads as `invented` rather than being trusted. The
     * point of this field is to refuse a launch on made-up prices, and a
     * default that fails open would defeat it silently.
     */
    pricingSource:
      row.pricing_source === "researched" || row.pricing_source === "observed"
        ? row.pricing_source
        : "invented",
    pricingCheckedAt: row.pricing_checked_at,
    pricingNote: row.pricing_note,
    // Both fail closed for the same reason `pricingSource` does: an
    // unrecognised value must read as the cautious answer, never be trusted.
    pricingConfidence:
      row.pricing_confidence === "high" || row.pricing_confidence === "medium"
        ? row.pricing_confidence
        : "low",
    pricingModel: row.pricing_model === "survey" ? "survey" : "band",
    icon: row.icon,
    sortOrder: row.sort_order,
  };
}

/**
 * Active categories in display order.
 *
 * `cache` dedupes this within one render — the header, the grid and the page
 * body all ask for it and one request should mean one query.
 */
/**
 * The seed, with the two numbers a failed read cannot vouch for removed.
 *
 * It is a mapping rather than a filter: the ten categories still render, with
 * every authored word intact. A shorter catalogue would be a second, worse lie —
 * `/services`' rule that an empty list and a failed read are different screens.
 */
function withoutBand(categories: readonly Category[]): Category[] {
  return categories.map((category) => ({
    ...category,
    basePriceMin: null,
    basePriceMax: null,
  }));
}

/**
 * The answer to every way the read can fail, in one place.
 *
 * THREE BRANCHES REACHED THIS AND EACH USED TO `return CATEGORY_SEED` — a query
 * error, zero rows, and a throw. Three copies of "fall back" is three chances
 * for the next one somebody adds to quietly serve a band nobody can vouch for,
 * which is how this whole fallback came to be a money path. One function, and
 * `tests/unit/category-fallback.test.ts` reads this source and fails if a bare
 * seed return appears outside the unconfigured branch.
 */
function unreadableCatalogue(reason: string): Category[] {
  markDataSource("categories", "seed", reason);
  return withoutBand(CATEGORY_SEED);
}

/** The catalogue columns. One list, two reads — see `allCategories`. */
const COLUMNS =
  "slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order";

export const getCategories = cache(async (): Promise<Category[]> => {
  if (!hasSupabaseConfig()) {
    /*
     * NOT BLANKED. With no keys there is no table to have moved on, so the seed
     * is the data rather than a stale copy of it, and blanking here would break
     * a fresh checkout to guard against nothing. `markDataSource` says `seed`
     * either way, which is what `?debug=data` prints.
     */
    markDataSource("categories", "seed", "no Supabase URL or anon key");
    return CATEGORY_SEED;
  }

  try {
    const { data, error } = await createPublicClient()
      .from("categories")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("sort_order");

    if (error || !data || data.length === 0) {
      /*
       * ZERO ROWS IS BLANKED TOO, which is worth saying because it reads like a
       * different case. Keys are configured, so a table exists and somebody may
       * have moved a band in it; a query that came back empty is a query we
       * could not read, not a catalogue with no prices in it.
       */
      return unreadableCatalogue(
        error ? describeError(error) : "query returned 0 rows",
      );
    }

    markDataSource("categories", "database");
    return (data as CategoryRow[]).map(fromRow);
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    // Unreachable database. The catalogue is not worth a 500 — and it is not
    // worth a price nobody can vouch for either.
    return unreadableCatalogue(describeError(thrown));
  }
});

export async function getCategory(slug: string): Promise<Category | null> {
  const categories = await getCategories();
  return categories.find((category) => category.slug === slug) ?? null;
}

/**
 * The same columns plus the retirement triple, SPELLED OUT rather than composed
 * from `COLUMNS`.
 *
 * A template literal would be shorter and would cost the check that matters:
 * `tests/db/column-manifest.test.ts` reads every `.select(…)` in the codebase
 * and asserts each column against the live schema, and it cannot follow a
 * string built from another binding — it reported this exact expression as one
 * it could not read. A list it can verify beats a list it has to skip, which is
 * the `check:secrets` rule one guard over: a scanner that quietly stops
 * scanning is worse than no scanner.
 */
const ADMIN_COLUMNS =
  "slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order, retired_at, retired_reason, retired_by";

/**
 * EVERY trade ever, retired included, in display order.
 *
 * TWO READS BECAUSE THEY ARE TWO QUESTIONS, exactly as `allAreas` and
 * `bookableAreas` are for wards — and here the split was already needed and
 * already broken. `getCategories` filters `is_active`, so the day somebody
 * withdrew a trade, `getCategory(booking.categorySlug)` would miss and BOTH
 * screens that label a booking fall back to the bare slug: a customer's own
 * booking page and the professional's job card would have read
 * `water-tank-cleaning`. A finished job has to be able to say what it was.
 *
 * So: `getCategories` is the SELLABLE read — the landing grid, `/services`,
 * every category page, `/book`, the triage prompt — and this is the LABEL read,
 * plus the admin screen that opens and withdraws them.
 *
 * `null` ON A FAILED READ, and the asymmetry with `allAreas` is deliberate.
 * A place name does not go stale, so a label read of wards can honestly serve
 * the seed; a category carries a published BAND, and `withoutBand` exists
 * because serving the seed's figure is how a stale customer protection reached
 * `createBooking`. The one screen that calls this is an editor — if the table
 * was unreachable, an edit would write where nothing is reading from and appear
 * to do nothing — so it says so rather than rendering a working-looking form
 * over the seed.
 */
export const allCategories = cache(
  async (): Promise<CategoryRecord[] | null> => {
    if (!hasSupabaseConfig()) {
      /*
       * THE UNCONFIGURED CLONE GETS THE SEED, `getCategories`' own reasoning:
       * with no keys the seed IS the data, there is no table to have moved on,
       * and withholding here would break a fresh checkout to guard against
       * nothing. Nothing in the seed is retired, because the file records no
       * retirement — which is exactly why a FAILED read may not fall back to it.
       */
      markDataSource("categories", "seed", "no Supabase URL or anon key");
      return CATEGORY_SEED.map((category) => ({
        ...category,
        retiredAt: null,
        retiredReason: null,
        retiredBy: null,
      }));
    }

    try {
      const { data, error } = await createPublicClient()
        .from("categories")
        .select(ADMIN_COLUMNS)
        .order("sort_order");

      if (error || !data || data.length === 0) {
        markDataSource(
          "categories",
          "seed",
          error ? describeError(error) : "query returned 0 rows",
        );
        return null;
      }

      markDataSource("categories", "database");
      return (data as (CategoryRow & RetirementRow)[]).map((row) => ({
        ...fromRow(row),
        retiredAt: row.retired_at,
        retiredReason: row.retired_reason,
        retiredBy: row.retired_by,
      }));
    } catch (thrown) {
      rethrowFrameworkSignal(thrown);
      markDataSource("categories", "seed", describeError(thrown));
      return null;
    }
  },
);

/**
 * One trade by slug, retired included — for labelling a row that already names
 * it.
 *
 * It is what `/bookings/[id]` and `/provider/jobs` should ask rather than
 * `getCategory`, so a withdrawn trade still reads as words. A failed read
 * answers null and those screens already print the slug in that case, which is
 * the honest fallback: the string is at least what the booking actually holds.
 */
export async function labelCategory(
  slug: string | null | undefined,
): Promise<Category | null> {
  if (!slug) return null;
  const all = await allCategories();
  if (all) return all.find((category) => category.slug === slug) ?? null;
  /* The read failed. The seed still has every authored word, and `withoutBand`
     is what keeps a band nobody can vouch for off the screen — a label is the
     one thing the seed is always right about. */
  return (
    withoutBand(CATEGORY_SEED).find((category) => category.slug === slug) ?? null
  );
}

/**
 * The sub-bands, in display order.
 *
 * `cache`d per request like the categories, because the prompt builder and any
 * screen that explains a quote both want them and one request should mean one
 * query. Falls back to the seed on the same terms and announces which path it
 * took, so a broken query cannot render a perfect-looking page — see
 * `lib/data/source.ts`.
 */
export const getSubBands = cache(async (): Promise<SubBand[]> => {
  if (!hasSupabaseConfig()) {
    markDataSource("subBands", "seed", "no Supabase URL or anon key");
    return SUB_BAND_SEED;
  }

  try {
    const { data, error } = await createPublicClient()
      .from("category_price_bands")
      .select(
        "category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note, span_source, span_checked_at, span_note",
      )
      .order("sort_order");

    if (error || !data || data.length === 0) {
      markDataSource(
        "subBands",
        "seed",
        error ? describeError(error) : "no rows",
      );
      return SUB_BAND_SEED;
    }

    markDataSource("subBands", "database");
    return (data as Array<Record<string, unknown>>).map((row) => ({
      categorySlug: row.category_slug as string,
      slug: row.slug as string,
      labelEn: row.label_en as string,
      labelNe: row.label_ne as string,
      low: Number(row.low),
      high: Number(row.high),
      // Fails closed, same as the category columns.
      pricingSource:
        row.pricing_source === "researched" || row.pricing_source === "observed"
          ? row.pricing_source
          : "invented",
      pricingCheckedAt: (row.pricing_checked_at as string | null) ?? null,
      pricingConfidence:
        row.pricing_confidence === "high" || row.pricing_confidence === "medium"
          ? row.pricing_confidence
          : "low",
      pricingNote: (row.pricing_note as string | null) ?? null,
      sortOrder: Number(row.sort_order),
      typicalWorkingMinutes: Number(row.typical_working_minutes),
      typicalElapsedDays: Number(row.typical_elapsed_days),
      /*
       * Fails closed to `invented`, which for duration means "do not print
       * this". An unreadable provenance must make the product quieter, never
       * more confident — the opposite default would publish a guess the first
       * time this column was misspelt.
       */
      durationSource:
        row.duration_source === "researched" || row.duration_source === "observed"
          ? row.duration_source
          : "invented",
      durationCheckedAt: (row.duration_checked_at as string | null) ?? null,
      durationConfidence:
        row.duration_confidence === "high" || row.duration_confidence === "medium"
          ? row.duration_confidence
          : "low",
      durationNote: (row.duration_note as string | null) ?? null,
      /*
       * The same fail-closed, on the column that also decides whether the
       * scheduler may hold more than one day. Falling back to `invented` here
       * costs a span and nothing else: the job holds its minutes on the day the
       * customer picked, which is what every booking did before spans existed.
       */
      spanSource:
        row.span_source === "researched" || row.span_source === "observed"
          ? row.span_source
          : "invented",
      spanCheckedAt: (row.span_checked_at as string | null) ?? null,
      spanNote: (row.span_note as string | null) ?? null,
    }));
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    markDataSource("subBands", "seed", describeError(thrown));
    return SUB_BAND_SEED;
  }
});

export { categoryCopy } from "@/lib/config/services";
