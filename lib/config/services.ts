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

export type ServiceCategoryCard = {
  slug: string;
  name: string;
  /**
   * Short lower-case form for inline sentences, e.g.
   * "Find {ctaLabel} professionals".
   *
   * Written out per category rather than derived from `name` or `slug`:
   * lower-casing "AC Servicing & Gas Refill" gives "ac servicing & gas
   * refill", which breaks the acronym and is too long for a button.
   */
  ctaLabel: string;
  descriptor: string;
  Icon: LucideIcon;
};

/**
 * Launch categories, ordered roughly by how often Nepali households search
 * for them. Slugs drive /services/[slug], which arrives in Phase 5.
 */
export const SERVICE_CATEGORIES: ServiceCategoryCard[] = [
  {
    slug: "plumbing",
    name: "Plumbing",
    ctaLabel: "plumbing",
    descriptor: "Leaks, blocked drains, fittings",
    Icon: Wrench,
  },
  {
    slug: "electrical",
    name: "Electrical",
    ctaLabel: "electrical",
    descriptor: "Wiring, switches, inverters",
    Icon: Zap,
  },
  {
    slug: "home-cleaning",
    name: "Home Cleaning",
    ctaLabel: "home cleaning",
    descriptor: "Deep clean, kitchen, bathrooms",
    Icon: Sparkles,
  },
  {
    slug: "appliance-repair",
    name: "Appliance Repair",
    ctaLabel: "appliance repair",
    descriptor: "Fridge, washing machine, geyser",
    Icon: WashingMachine,
  },
  {
    slug: "carpentry",
    name: "Carpentry",
    ctaLabel: "carpentry",
    descriptor: "Doors, furniture, fittings",
    Icon: Hammer,
  },
  {
    slug: "pest-control",
    name: "Pest Control",
    ctaLabel: "pest control",
    descriptor: "Cockroaches, termites, bed bugs",
    Icon: Bug,
  },
  {
    slug: "painting",
    name: "Painting",
    ctaLabel: "painting",
    descriptor: "Interior, exterior, touch-ups",
    Icon: PaintRoller,
  },
  {
    slug: "ac-servicing",
    name: "AC Servicing & Gas Refill",
    ctaLabel: "AC servicing",
    descriptor: "Servicing, gas top-up, install",
    Icon: AirVent,
  },
  {
    slug: "water-tank-cleaning",
    name: "Water Tank Cleaning",
    ctaLabel: "water tank cleaning",
    descriptor: "Tanks, sumps, overhead drums",
    Icon: Droplets,
  },
  {
    slug: "movers-packers",
    name: "Movers & Packers",
    ctaLabel: "moving & packing",
    descriptor: "Shifting flats, offices, storage",
    Icon: Truck,
  },
];
