import "server-only";

import { CATEGORY_SEED, type Category } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";

/**
 * The price bands Claude is given as reference data.
 *
 * A model asked to price a Kathmandu plumbing job with no reference invents a
 * plausible number that is not what our providers charge. These are our
 * published rates, so they go into the prompt.
 *
 * Phase 5 moved the bounds into the `categories` table: repricing a category
 * there reprices the catalogue, the category page and this prompt together.
 * The notes are still written here by hand, because a range alone does not
 * tell the model that a gas refill sits at the top of the AC band and a filter
 * clean at the bottom.
 */

/** What moves a job within its band. Keep short — this is prompt budget. */
const BAND_NOTES: Record<string, string> = {
  plumbing:
    "washer or joint leak 900-2200; blocked drain 1200-3000; no water, pump or airlock 1000-2800; burst pipe or flooding 1500-4500",
  electrical:
    "switch, socket, fitting or MCB 800-2500; short circuit, sparking or burning smell 1500-4000; rewiring a room is quoted after a visit",
  "home-cleaning":
    "priced by hours and flat size; a kitchen or bathroom alone at the bottom, a full deep clean or move-out at the top",
  "appliance-repair":
    "diagnosis plus labour 1200-4000; the part is quoted separately on site, so do not fold a compressor or a drum into this band",
  carpentry:
    "hinge, lock, drawer or shelf at the bottom; a door or a cupboard rebuild at the top; new furniture is quoted separately",
  "pest-control":
    "one flat, one treatment 2000-6000; termites and bed bugs sit at the top and need a follow-up visit",
  painting:
    "quoted per square foot after a site visit; a touch-up at the bottom, a whole flat at the top. Say the range is wide until someone measures",
  "ac-servicing":
    "service and filter clean at the bottom; gas refill 3500-5500; installation at the top",
  "water-tank-cleaning":
    "priced by tank capacity; a single overhead drum at the bottom, an underground sump at the top",
  "movers-packers":
    "within the Valley 5000-20000, by distance, floor level and volume; a survey call settles it",
};

export type PriceBand = {
  slug: string;
  name: string;
  low: number;
  high: number;
  note: string;
};

function toBand(category: Category): PriceBand {
  return {
    slug: category.slug,
    name: category.nameEn,
    low: category.basePriceMin,
    high: category.basePriceMax,
    note: BAND_NOTES[category.slug] ?? "",
  };
}

/**
 * Bands as authored. Used where the database cannot be waited on — the price
 * clamp has to work even if the categories read failed.
 */
export const FALLBACK_PRICE_BANDS: PriceBand[] = [...CATEGORY_SEED]
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map(toBand);

export async function getPriceBands(): Promise<PriceBand[]> {
  const categories = await getCategories();
  if (categories.length === 0) return FALLBACK_PRICE_BANDS;
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder).map(toBand);
}
