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
  /** Lucide icon name — resolved through CATEGORY_ICONS below. */
  icon: string;
  sortOrder: number;
};

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
