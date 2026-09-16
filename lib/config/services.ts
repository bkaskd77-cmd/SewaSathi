import type { LucideIcon } from "lucide-react";
import {
  AirVent,
  Bug,
  Droplets,
  Hammer,
  PaintRoller,
  Sparkles,
  Truck,
  WashingMachine,
  Wrench,
  Zap,
} from "lucide-react";

import categorySeed from "@/lib/data/seed/categories.json";
import subBandSeed from "@/lib/data/seed/price-bands.json";

import type { Locale } from "@/i18n/routing";

/**
 * The service categories, as authored.
 *
 * `lib/data/seed/categories.json` is the one place these are written down. It
 * seeds the `categories` table (scripts/generate-seed-sql.mjs), it is what the
 * app falls back to when Supabase is unreachable, and everything below is
 * derived from it — so there is no second list to forget to update.
 *
 * This file is client-safe on purpose: the landing grid renders in the
 * browser. The database read lives in lib/data/categories.ts, which is
 * server-only.
 */

/**
 * One product inside a trade, with its own price range and its own provenance.
 *
 * WHY THESE EXIST AS DATA. A category band spanning 10-13x cannot carry "no
 * surprises" — AC servicing runs 500 to 12,000 because a routine service, a gas
 * refill and an installation are three different products, not one. The number
 * a customer actually reads is the one the triage narrows to, so that number is
 * the real promise and it has to be researched, sourced and dated like any
 * other published price. It was prompt text until 2026-09-15, which meant it
 * could not be measured, could not be revised by evidence, and had no
 * provenance at all.
 *
 * The category band is the union of its sub-bands, exactly — asserted by a test
 * rather than assumed, because a sub-band added outside the category range
 * would quote a figure the clamp then refuses.
 */
export type SubBand = {
  categorySlug: string;
  slug: string;
  labelEn: string;
  labelNe: string;
  low: number;
  high: number;
  pricingSource: "invented" | "researched" | "observed";
  pricingCheckedAt: string | null;
  pricingConfidence: "high" | "medium" | "low";
  pricingNote: string | null;
  sortOrder: number;
};

export type Category = {
  slug: string;
  nameEn: string;
  nameNe: string;
  descriptor: string;
  descriptorNe: string;
  description: string;
  descriptionNe: string;
  ctaLabel: string;
  ctaLabelNe: string;
  basePriceMin: number;
  basePriceMax: number;
  /**
   * WHERE THESE TWO NUMBERS CAME FROM, recorded beside them.
   *
   * The band is not decoration: it is published on every category card, on
   * `/services`, on the category page, inside the triage prompt, and it is the
   * floor of every booking's quote — which the platform fee is charged on.
   * Today every one of them is `invented`: a developer's guess at a Kathmandu
   * price, never checked against a competitor or a real settled job.
   *
   * Nothing distinguished a guess from a researched figure, so after the first
   * trade is researched there would be no way to tell which nine were still
   * made up. Hence a field rather than a comment.
   *
   *   `invented`   — a guess. Cannot go live; `npm run check:blockers` refuses.
   *   `researched` — taken from named competitors, recorded in `pricingNote`
   *                  with the date it was checked. The launch position.
   *   `observed`   — derived from our own settled jobs, once there are enough
   *                  of them to mean anything. `category_pricing_signals` is
   *                  the measurement that gets us here.
   */
  /**
   * How many jobs one professional may hold in one two-hour window.
   *
   * A WORKAROUND WITH AN EXPIRY, NOT A MODEL OF ANYBODY'S WEEK. A job has a
   * duration and this product does not record one — the named structural item
   * in ARCHITECTURE.md. Painting's 3 does not mean a painter paints three
   * flats at once; it means do not block a painter from a second job because
   * the first one's putty is drying. Read as a considered answer about
   * capacity it is simply wrong, and `typical_duration_hours` is what would
   * replace it.
   */
  maxConcurrentJobs: number;
  pricingSource: "invented" | "researched" | "observed";
  /** ISO date the band was last checked against the world. Null while invented. */
  pricingCheckedAt: string | null;
  /** Who was checked, or what the figure was derived from. */
  pricingNote: string | null;
  /**
   * How much the band is worth trusting, which governs how soon our own data
   * is allowed to challenge it. A low-confidence band is a guess, so it earns
   * a proposal on a smaller sample — see `MIN_PROPOSAL_SAMPLE`.
   */
  pricingConfidence: "high" | "medium" | "low";
  /**
   * `band` publishes a price range. `survey` publishes none, because the trade
   * genuinely does not have one until somebody has looked — movers and packers
   * quote after a free survey everywhere in the market, and forcing a range
   * onto that would invent the one number nobody will state.
   */
  pricingModel: "band" | "survey";
  /** Lucide icon name — resolved through CATEGORY_ICONS below. */
  icon: string;
  sortOrder: number;
};

/**
 * Does this trade publish a price at all?
 *
 * ONE PLACE ASKS IT, because the alternative is what shipped: the database
 * said `survey`, the triage prompt listed movers with no range, the launch
 * blocker named the right remedy — and five screens went on rendering an
 * invented Rs 5,000–20,000. The data was honest and the product was not, which
 * is the worse half to leave, and it happened because each screen re-derived
 * "should I show a range" as "does it have numbers".
 *
 * Movers and packers is the case and the reason is a finding, not a gap: no
 * Nepali operator publishes a figure, every one quotes after a survey, and
 * inventing a range would fabricate the one number the market itself refuses
 * to state before looking at the job.
 */
export function isSurveyPriced(
  category: Pick<Category, "pricingModel">,
): boolean {
  return category.pricingModel === "survey";
}

/**
 * A category's copy in one language.
 *
 * Category copy is data, not interface strings — it lives in the `categories`
 * table so repricing and renaming happen in one place, and the Nepali sits in
 * sibling columns rather than in the message catalogue. This is the single
 * function that picks a side, so nothing else has to write `locale === "ne"`.
 */
export type CategoryCopy = {
  name: string;
  descriptor: string;
  description: string;
  ctaLabel: string;
};

export function categoryCopy(category: Category, locale: Locale): CategoryCopy {
  return locale === "ne"
    ? {
        name: category.nameNe,
        descriptor: category.descriptorNe,
        description: category.descriptionNe,
        ctaLabel: category.ctaLabelNe,
      }
    : {
        name: category.nameEn,
        descriptor: category.descriptor,
        description: category.description,
        ctaLabel: category.ctaLabel,
      };
}

export const CATEGORY_SEED = categorySeed as Category[];

/**
 * The authored sub-bands. Seeds `category_price_bands` and answers when the
 * database is unconfigured or unreachable, exactly like `CATEGORY_SEED`.
 */
export const SUB_BAND_SEED = subBandSeed as SubBand[];

/**
 * Icon names to components.
 *
 * The database stores a name, not a component, so this map is the boundary.
 * A category with an unknown icon renders the wrench rather than nothing.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Wrench,
  Zap,
  Sparkles,
  WashingMachine,
  Hammer,
  Bug,
  PaintRoller,
  AirVent,
  Droplets,
  Truck,
};

export function categoryIcon(name: string): LucideIcon {
  return CATEGORY_ICONS[name] ?? Wrench;
}

export type ServiceCategoryCard = Category & { Icon: LucideIcon };

/**
 * The landing grid's view of the categories. Ordered as authored.
 *
 * Carries the whole row rather than a flattened English view, so a caller can
 * hand it to `categoryCopy` with the reader's locale instead of reaching back
 * into the seed for the Nepali half.
 */
export const SERVICE_CATEGORIES: ServiceCategoryCard[] = [...CATEGORY_SEED]
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map((category) => ({ ...category, Icon: categoryIcon(category.icon) }));
