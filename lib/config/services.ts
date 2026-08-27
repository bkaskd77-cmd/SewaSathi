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
    descriptor: "Leaks, blocked drains, fittings",
    Icon: Wrench,
  },
  {
    slug: "electrical",
    name: "Electrical",
    descriptor: "Wiring, switches, inverters",
    Icon: Zap,
  },
  {
    slug: "home-cleaning",
    name: "Home Cleaning",
    descriptor: "Deep clean, kitchen, bathrooms",
    Icon: Sparkles,
  },
  {
    slug: "appliance-repair",
    name: "Appliance Repair",
    descriptor: "Fridge, washing machine, geyser",
    Icon: WashingMachine,
  },
  {
    slug: "carpentry",
    name: "Carpentry",
    descriptor: "Doors, furniture, fittings",
    Icon: Hammer,
  },
  {
    slug: "pest-control",
    name: "Pest Control",
    descriptor: "Cockroaches, termites, bed bugs",
    Icon: Bug,
  },
  {
    slug: "painting",
    name: "Painting",
    descriptor: "Interior, exterior, touch-ups",
    Icon: PaintRoller,
  },
  {
    slug: "ac-servicing",
    name: "AC Servicing & Gas Refill",
    descriptor: "Servicing, gas top-up, install",
    Icon: AirVent,
  },
  {
    slug: "water-tank-cleaning",
    name: "Water Tank Cleaning",
    descriptor: "Tanks, sumps, overhead drums",
    Icon: Droplets,
  },
  {
    slug: "movers-packers",
    name: "Movers & Packers",
    descriptor: "Shifting flats, offices, storage",
    Icon: Truck,
  },
];
