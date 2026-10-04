/**
 * The icons a category card can draw.
 *
 * WHY A CLOSED SET. The catalogue renders a lucide component by name, so a name that
 * is not an export renders nothing at all — a blank tile on the grid that is the first
 * thing a customer sees. That was survivable while the ten names only ever came from a
 * seed file nobody edited at runtime; it stops being survivable the moment an admin can
 * type one. So the set is a list, the admin picks from it, and the database refuses
 * anything else.
 *
 * THE OFFERED SET IS THE STORABLE SET, which is `REFUSAL_REASON_CODES`'s arrangement
 * and the reason it is written down once here. A picker offering a name the check
 * constraint rejects would lose the whole edit in the same statement that tried to save
 * it; a constraint allowing a name the picker never offers is dead text.
 * `tests/unit/category-icons.test.ts` asserts this list, the SQL constraint and the
 * live categories all agree, and that every name is a real lucide export.
 *
 * THE FIRST TEN ARE IN USE AND CAME FROM THE DATABASE, NOT FROM MEMORY. The first
 * version of the constraint was written from the seed file's opening rows with the rest
 * guessed, and Postgres refused it: `ac-servicing` is `AirVent`, which had been guessed
 * as `Wind`. The guard caught the guess before it could blank a card, which is what a
 * check constraint on a rendering key is for. The spares below are the trades most
 * likely to be added next, verified as real exports rather than plausible-looking.
 */
export const CATEGORY_ICONS = [
  // In use today, read from `public.categories`.
  "Wrench",
  "Zap",
  "Sparkles",
  "WashingMachine",
  "Hammer",
  "Bug",
  "PaintRoller",
  "AirVent",
  "Droplets",
  "Truck",
  // Spares, so adding a trade does not need a migration.
  "Plug",
  "Sofa",
  "Trees",
  "Package",
  "Wind",
  "Flame",
  "ShowerHead",
  "Lightbulb",
  "Refrigerator",
  "Hotel",
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

export function isCategoryIcon(value: string): value is CategoryIcon {
  return (CATEGORY_ICONS as readonly string[]).includes(value);
}
