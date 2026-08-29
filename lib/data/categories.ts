import "server-only";

import { cache } from "react";

import { CATEGORY_SEED, type Category } from "@/lib/config/services";
import {
  describeError,
  markDataSource,
  rethrowFrameworkSignal,
} from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

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
    const { data, error } = await createClient()
      .from("categories")
      .select(
        "slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, icon, sort_order",
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

export { categoryCopy } from "@/lib/config/services";
