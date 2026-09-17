import "server-only";

import {
  CATEGORY_SEED,
  SUB_BAND_SEED,
  type Category,
  type SubBand,
} from "@/lib/config/services";

/**
 * The price bands Claude is given as reference data.
 *
 * A model asked to price a Kathmandu plumbing job with no reference invents a
 * plausible number that is not what our providers charge. These are our
 * published rates, so they go into the prompt.
 *
 * THE SUB-BANDS ARE DATA NOW, NOT PROSE. They used to be a hand-written
 * `BAND_NOTES` string per category — "gas refill 3500-5500; filter clean at the
 * bottom" — which worked as a hint to the model and was worthless as anything
 * else: it could not be measured against settled jobs, could not be revised by
 * evidence, and carried no provenance, so nobody could tell a researched figure
 * from a guess. And it is the number that matters most, because a category band
 * spanning 10-13x cannot carry "no surprises": AC servicing runs 500 to 12,000
 * because a routine service, a gas refill and an installation are three
 * products. What the customer actually reads is the narrowed figure, so that
 * figure is the real promise.
 *
 * The note handed to the model is therefore GENERATED from the sub-bands. One
 * source, and repricing a sub-band reprices the prompt with it. The format is
 * deliberately the same terse shape the hand-written strings used, because this
 * is prompt budget and the prompt has to stay byte-identical per request to
 * prefix-cache.
 */
export type PriceBand = {
  slug: string;
  name: string;
  /** The Nepali name, listed alongside so Nepali input maps to the slug. */
  nameNe: string;
  low: number;
  high: number;
  /** Generated from `subBands`. Never hand-written. */
  note: string;
  /** The products inside this trade, in display order. */
  subBands: SubBand[];
  /** `survey` trades have no price until somebody has looked. */
  model: Category["pricingModel"];
};

/** "service=Routine service and deep clean 1200-2000; gas=Gas refill 3500-7500" */
function noteFrom(subBands: readonly SubBand[]): string {
  /*
   * THE SLUG IS IN FRONT NOW, and it is what lets the model name the product
   * rather than only price it. The slug is the key into
   * `category_price_bands`, where the researched price and the researched
   * DURATION both live — so "which product" and "how long" are the same
   * lookup, and nobody has to invent a length.
   *
   * `slug=Label low-high` rather than a second list: this is prompt budget on
   * a path that must stay byte-identical to prefix-cache, and repeating 36
   * labels to carry 36 slugs would roughly double this section.
   *
   * Case is left alone: lowercasing turned "MCB" into "mcb" and "1,000 L" into
   * "1,000 l", which is the kind of small wrongness a model happily copies.
   */
  return subBands
    .map((band) => `${band.slug}=${band.labelEn} ${band.low}-${band.high}`)
    .join("; ");
}

function toBand(category: Category, subBands: readonly SubBand[]): PriceBand {
  const mine = subBands
    .filter((band) => band.categorySlug === category.slug)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    slug: category.slug,
    name: category.nameEn,
    nameNe: category.nameNe,
    low: category.basePriceMin,
    high: category.basePriceMax,
    /*
     * A survey trade has no sub-bands and must not be handed a range to copy.
     * Movers is the case: no Nepali operator publishes a price, so the stored
     * bounds are the old guess and the prompt says so plainly rather than
     * letting the model assert a figure nobody quoted.
     */
    note:
      category.pricingModel === "survey"
        ? "Priced only after a free survey. Do not state a figure; say a surveyor will come and quote."
        : noteFrom(mine),
    subBands: mine,
    model: category.pricingModel,
  };
}

/**
 * Bands as authored. Used where the database cannot be waited on — the price
 * clamp has to work even if the categories read failed.
 */
export const FALLBACK_PRICE_BANDS: PriceBand[] = [...CATEGORY_SEED]
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map((category) => toBand(category, SUB_BAND_SEED));

/**
 * The live bands, from the database, falling back to the authored ones.
 *
 * The data layer is imported *inside* the function rather than at the top of
 * the file. `lib/data/categories` wraps its reads in React's `cache()`, which
 * only exists inside a server runtime — importing it at module scope made
 * FALLBACK_PRICE_BANDS, and therefore the price clamp, impossible to load
 * anywhere else. The clamp is a safety-relevant pure function and must stay
 * loadable on its own; a test that cannot import it is a test nobody writes.
 */
export async function getPriceBands(): Promise<PriceBand[]> {
  const { getCategories, getSubBands } = await import("@/lib/data/categories");
  const [categories, subBands] = await Promise.all([
    getCategories(),
    getSubBands(),
  ]);
  if (categories.length === 0) return FALLBACK_PRICE_BANDS;
  return [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => toBand(category, subBands));
}
