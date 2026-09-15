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
 * the whole catalogue, and a database blip degrades to slightly stale prices
 * rather than an error page.
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
export const getCategories = cache(async (): Promise<Category[]> => {
  if (!hasSupabaseConfig()) {
    markDataSource("categories", "seed", "no Supabase URL or anon key");
    return CATEGORY_SEED;
  }

  try {
    const { data, error } = await createPublicClient()
      .from("categories")
      .select(
        "slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order",
      )
      .eq("is_active", true)
      .order("sort_order");

    if (error || !data || data.length === 0) {
      markDataSource(
        "categories",
        "seed",
        error ? describeError(error) : "query returned 0 rows",
      );
      return CATEGORY_SEED;
    }

    markDataSource("categories", "database");
    return (data as CategoryRow[]).map(fromRow);
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    // Unreachable database. The catalogue is not worth a 500.
    markDataSource("categories", "seed", describeError(thrown));
    return CATEGORY_SEED;
  }
});

export async function getCategory(slug: string): Promise<Category | null> {
  const categories = await getCategories();
  return categories.find((category) => category.slug === slug) ?? null;
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
        "category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order",
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
    }));
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    markDataSource("subBands", "seed", describeError(thrown));
    return SUB_BAND_SEED;
  }
});

export { categoryCopy } from "@/lib/config/services";
