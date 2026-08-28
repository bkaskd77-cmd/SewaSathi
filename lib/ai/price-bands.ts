import { KEYWORD_RULES } from "@/lib/ai/mockTriage";
import { SERVICE_CATEGORIES } from "@/lib/config/services";

/**
 * The price bands Claude is given as reference data.
 *
 * A model asked to price a plumbing job in Kathmandu with no reference will
 * invent a number, and the number it invents is not what our providers charge.
 * These are our published rates, so they go into the prompt.
 *
 * The bounds are derived from `KEYWORD_RULES` rather than retyped — the two
 * would otherwise drift the first time someone repriced one and not the other.
 * The notes are written by hand because a range alone does not tell the model
 * that a gas refill sits at the top of the AC band and a filter clean at the
 * bottom.
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

/** Widest low-high across every keyword rule for a category. */
function boundsFor(slug: string): [number, number] | null {
  const rules = KEYWORD_RULES.filter((rule) => rule.category === slug);
  if (rules.length === 0) return null;
  return [
    Math.min(...rules.map((rule) => rule.priceRangeNPR[0])),
    Math.max(...rules.map((rule) => rule.priceRangeNPR[1])),
  ];
}

export const PRICE_BANDS: PriceBand[] = SERVICE_CATEGORIES.flatMap(
  ({ slug, name }) => {
    const bounds = boundsFor(slug);
    if (!bounds) return [];
    return [
      {
        slug,
        name,
        low: bounds[0],
        high: bounds[1],
        note: BAND_NOTES[slug] ?? "",
      },
    ];
  },
);
