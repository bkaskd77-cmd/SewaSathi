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
  description: string;
  ctaLabel: string;
  basePriceMin: number;
  basePriceMax: number;
  /** Lucide icon name — resolved through CATEGORY_ICONS below. */
  icon: string;
  sortOrder: number;
};

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

export type ServiceCategoryCard = {
  slug: string;
  name: string;
  /** Same name in Nepali, for the language toggle. */
  nameNe: string;
  /**
   * Short lower-case form for inline sentences, e.g.
   * "Find {ctaLabel} professionals". Written out per category rather than
   * derived: lower-casing "AC Servicing & Gas Refill" breaks the acronym.
   */
  ctaLabel: string;
  descriptor: string;
  Icon: LucideIcon;
};

/**
 * The landing grid's view of the categories. Ordered as authored.
 */
export const SERVICE_CATEGORIES: ServiceCategoryCard[] = [...CATEGORY_SEED]
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map((category) => ({
    slug: category.slug,
    name: category.nameEn,
    nameNe: category.nameNe,
    ctaLabel: category.ctaLabel,
    descriptor: category.descriptor,
    Icon: categoryIcon(category.icon),
  }));
