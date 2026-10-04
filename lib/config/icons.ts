import type { LucideIcon } from "lucide-react";
import {
  AirVent,
  Bug,
  Droplets,
  Flame,
  Hammer,
  Hotel,
  Lightbulb,
  Package,
  PaintRoller,
  Plug,
  Refrigerator,
  ShowerHead,
  Sofa,
  Sparkles,
  Trees,
  Truck,
  WashingMachine,
  Wind,
  Wrench,
  Zap,
} from "lucide-react";

/**
 * The icons a category card can draw, as one map from name to component.
 *
 * WHY A CLOSED SET. The catalogue renders a lucide component by name, so a name that
 * is not an export renders nothing at all — a blank tile on the grid that is the first
 * thing a customer sees. That was survivable while the ten names only ever came from a
 * seed file nobody edited at runtime; it stops being survivable the moment an admin can
 * pick one. So the set is a list, the admin picks from it, and the database refuses
 * anything else.
 *
 * THE OFFERED SET IS THE STORABLE SET IS THE RENDERABLE SET, and the third of those was
 * missing until the picker was built. `lib/config/services.ts` held a SECOND
 * `CATEGORY_ICONS` — a ten-entry component map with `?? Wrench` behind it — while this
 * file held twenty names and the check constraint allowed all twenty. So the ten spares
 * were storable, passed every guard, and rendered a **wrench**: the comment in this file
 * claimed the three sets agreed, the test asserted two of the three, and the one it left
 * out was the one that reaches a customer. One list written twice, which is the sin this
 * repository records most often.
 *
 * SO THE MAP IS THE LIST. `CATEGORY_ICONS` is its keys and `CategoryIcon` is `keyof` it,
 * which makes a name without a component unrepresentable rather than merely tested for
 * — there is no second place to forget. `tests/unit/category-icons.test.ts` asserts the
 * remaining two agreements, against lucide and against the migration.
 *
 * THE FIRST TEN ARE IN USE AND CAME FROM THE DATABASE, NOT FROM MEMORY. The first
 * version of the constraint was written from the seed file's opening rows with the rest
 * guessed, and Postgres refused it: `ac-servicing` is `AirVent`, which had been guessed
 * as `Wind`. The guard caught the guess before it could blank a card, which is what a
 * check constraint on a rendering key is for. The spares below are the trades most
 * likely to be added next.
 */
const ICONS = {
  // In use today, read from `public.categories`.
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
  // Spares, so adding a trade does not need a migration.
  Plug,
  Sofa,
  Trees,
  Package,
  Wind,
  Flame,
  ShowerHead,
  Lightbulb,
  Refrigerator,
  Hotel,
} satisfies Record<string, LucideIcon>;

export type CategoryIcon = keyof typeof ICONS;

/** Every name an admin may pick and the database will accept, in offered order. */
export const CATEGORY_ICONS = Object.keys(ICONS) as CategoryIcon[];

export function isCategoryIcon(value: string): value is CategoryIcon {
  return value in ICONS;
}

/**
 * The component for a stored name.
 *
 * FALLS BACK TO THE WRENCH rather than rendering nothing, because the column is text and
 * a row written before the constraint existed could hold anything. That fallback is a
 * floor under a bad row, never a licence to offer a name without a component — which is
 * what the map above makes impossible.
 */
export function categoryIcon(name: string): LucideIcon {
  return (ICONS as Record<string, LucideIcon>)[name] ?? Wrench;
}
