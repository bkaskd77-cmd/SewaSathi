/**
 * MOCK DATA — placeholder booking counts for the category cards.
 *
 * Replaced in Phase 5 by a real aggregate over the bookings table (a rolling
 * 7-day count per category, cached). Keyed by the slugs in
 * lib/config/services.ts.
 */
export const CATEGORY_BOOKINGS_THIS_WEEK: Record<string, number> = {
  plumbing: 312,
  electrical: 268,
  "home-cleaning": 241,
  "appliance-repair": 154,
  carpentry: 97,
  "pest-control": 88,
  painting: 64,
  "ac-servicing": 143,
  "water-tank-cleaning": 71,
  "movers-packers": 52,
};
