import type { LucideIcon } from "lucide-react";

import { categoryIcon } from "@/lib/config/icons";

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
  /**
   * HOW LONG THE PROFESSIONAL IS ON THE TOOLS. Fills their calendar.
   *
   * Minutes rather than hours because the slot maths is already in minutes and
   * hours force a false rounding — a tap leak is neither one hour nor two.
   */
  typicalWorkingMinutes: number;
  /**
   * HOW LONG THE CUSTOMER'S HOME IS A BUILDING SITE. What they plan around.
   *
   * For nine trades this is 1 and only the minutes matter. Painting is why it
   * exists: a room takes four days and a painter a few hours of each, because
   * putty dries, primer cures and coats need hours between them. The two
   * numbers are what `categories.max_concurrent_jobs` was faking with a 3,
   * which is why that column is gone.
   */
  typicalElapsedDays: number;
  /**
   * ITS OWN PROVENANCE, DELIBERATELY SEPARATE FROM THE PRICE'S.
   *
   * Researching what a job costs is not researching how long it takes, and one
   * provenance covering both would launder a guessed duration under a
   * researched price's confidence. Today every one of these is `invented` —
   * nobody in Nepal publishes how long a tap leak takes — which is why nothing
   * here reaches a customer. See `hasPublishableMinutes` in
   * `lib/provider/measured.ts`.
   *
   * IT GOVERNS THE MINUTES AND NOTHING ELSE. It used to gate the span as well,
   * which would have meant promoting a sub-band on minutes evidence switched on
   * 2-, 4- and 7-day holds with no span evidence of any kind.
   */
  durationSource: "invented" | "researched" | "observed";
  durationCheckedAt: string | null;
  durationConfidence: "high" | "medium" | "low";
  durationNote: string | null;
  /**
   * THE SPAN'S OWN PROVENANCE, AND THE REASON IT IS A SECOND COLUMN.
   *
   * The two wrong answers cost wildly different amounts, which
   * `lib/booking/duration.ts` already argued at length while both read one
   * column. A wrong `typicalWorkingMinutes` reserves 90 minutes where 120 was
   * right — bounded, invisible, and strictly better than the flat two hours
   * every booking held before durations existed. A wrong `typicalElapsedDays`
   * holds four days of a painter's week and four days of a customer's home,
   * takes real bookable capacity out of the product, and nothing on any screen
   * tells it apart from a measurement.
   *
   * So the minutes may be promoted on minutes evidence and the span may not.
   * `hasPublishableSpan` is the gate, `spansDays()` is the scheduler's half, and
   * `span_source` in `sync_booking_days()` is the same gate in SQL.
   */
  spanSource: "invented" | "researched" | "observed";
  spanCheckedAt: string | null;
  spanNote: string | null;
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
  /**
   * The published band, or NULL when we could not read it.
   *
   * NULL IS "WE COULD NOT READ IT", NEVER "THIS TRADE HAS NO PRICE" — that is
   * `pricingModel: "survey"` and is a different fact. `lib/data/categories.ts`
   * blanks these two when the `categories` query FAILS, so what used to happen
   * silently cannot: the seed holds the band as authored, the table holds the
   * band as published, `/admin/bands` can move the second without touching the
   * first, and a failed read therefore served a figure that could be months
   * out of date on the first screen anybody sees.
   *
   * IT IS NOT A DISPLAY CONCERN. `createBooking` derives `quoted_min` and
   * `quoted_max` from these same two numbers, and `judgeFinalAmount` measures
   * its 2x overcharge ceiling off `quoted_max` — so a stale seed band reached a
   * customer protection, not just a card. A booking is refused outright rather
   * than quoted from the seed; see `categoryQuote` and `lib/data/bookings.ts`.
   *
   * AN UNCONFIGURED CLONE KEEPS ITS NUMBERS, deliberately: with no Supabase keys
   * the seed IS the data and there is no published band for it to disagree with,
   * so blanking it there would break a fresh checkout to protect against nothing.
   */
  basePriceMin: number | null;
  basePriceMax: number | null;
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
  /** Lucide icon name — resolved through `categoryIcon` in lib/config/icons.ts. */
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
 * What this category can tell a customer about price, in three answers.
 *
 * ONE FUNCTION FOR EVERY SURFACE THAT SHOWS A PRICE, which is `isSurveyPriced`'s
 * own rule — that one is asked on six screens precisely so "should I show a
 * range" is decided once. This is the same decision with the third answer it was
 * missing: a band we could not read is neither a range to print nor a trade that
 * publishes none.
 *
 * `unreadable` IS NOT `survey`, and collapsing them would be the expensive
 * mistake. "Priced after a free survey" is a promise about how movers and
 * packers works, true on every screen for ever; printing it over plumbing
 * because a query timed out tells a customer something false about the product
 * and sends them into a flow that asks for a surveyor.
 *
 * IT COMPOSES `isSurveyPriced` RATHER THAN RE-DERIVING IT, so the two can never
 * disagree about which trades publish no price — the divergence
 * `lib/provider/measured.ts` exists to prevent, one concern over.
 *
 * SURVEY IS ANSWERED FIRST, deliberately. A survey trade's stored bounds are the
 * old guess that nothing reads, so it is `survey` whether the read worked or
 * not: the sentence a movers customer gets must not depend on the health of a
 * query.
 */
export type CategoryQuote =
  | { kind: "band"; low: number; high: number }
  | { kind: "survey" }
  | { kind: "unreadable" };

export function categoryQuote(
  category: Pick<Category, "pricingModel" | "basePriceMin" | "basePriceMax">,
): CategoryQuote {
  if (isSurveyPriced(category)) return { kind: "survey" };
  if (category.basePriceMin === null || category.basePriceMax === null) {
    return { kind: "unreadable" };
  }
  return {
    kind: "band",
    low: category.basePriceMin,
    high: category.basePriceMax,
  };
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
 * What a category slug has to look like: lowercase words joined by hyphens.
 *
 * THE SAME REASONING AS `AREA_KEY_SHAPE` AND A LONGER REACH. This string is
 * `bookings.category_slug`, `provider_categories.category_slug`,
 * `category_price_bands.category_slug`, `category_pricing_signals`,
 * `category_price_revisions`, the keys of `GUARANTEE_WINDOWS`, the `category`
 * on every `KEYWORD_RULES` entry, and the `/services/[slug]` URL — with no
 * foreign key behind most of them. So a trade opened as "Water Tank Cleaning"
 * would render correctly on the admin screen and match nothing at all.
 *
 * No trailing number, which is the one place it differs from an area key: a
 * ward IS a number and a trade is not, so `plumbing-2` is a second trade
 * somebody meant to name rather than a variant of the first.
 *
 * It lives here beside the pure helpers rather than in the `server-only`
 * writer that enforces it, so both suites can reach it, and
 * `tests/db/category-retirement.test.ts` compares it against the slug column's
 * own constraint where one exists.
 */
export const CATEGORY_SLUG_SHAPE = /^[a-z]+(-[a-z]+)*$/;


/**
 * The authored sub-bands. Seeds `category_price_bands` and answers when the
 * database is unconfigured or unreachable, exactly like `CATEGORY_SEED`.
 */
export const SUB_BAND_SEED = subBandSeed as SubBand[];

/**
 * Icon names to components — ONE map, in `lib/config/icons.ts`.
 *
 * This file used to hold its own ten-entry copy with `?? Wrench` behind it, while
 * `icons.ts` offered twenty names and the check constraint accepted all twenty. The ten
 * spares therefore stored fine, passed every guard and drew a wrench. Re-exported rather
 * than re-imported at each call site so the existing callers did not have to move.
 */
export { categoryIcon };

export type ServiceCategoryCard = Category & { Icon: LucideIcon };

/**
 * The landing grid's view of the categories. Ordered as authored.
 *
 * Carries the whole row rather than a flattened English view, so a caller can
 * hand it to `categoryCopy` with the reader's locale instead of reaching back
 * into the seed for the Nepali half.
 */
export const SERVICE_CATEGORIES: ServiceCategoryCard[] = asCards(CATEGORY_SEED);

/**
 * Any list of categories as the grid's cards.
 *
 * WHY THIS EXISTS: THE LANDING GRID WAS READING THE SEED, NOT THE TABLE. The
 * standing notes said "`categories` is the single source of truth — the landing
 * grid, `/services`, the category pages and the price bands in the triage
 * prompt all read from it, so repricing happens once", and the first screen
 * anybody sees rendered `SERVICE_CATEGORIES`, a module-level constant built
 * from `CATEGORY_SEED`. So a band moved on `/admin/bands`, a descriptor edited
 * on `/admin/content/categories` and a trade withdrawn through `retireCategory`
 * all changed `/services` and every category page and left the front page
 * exactly as it was — a withdrawn trade still advertised there, linking to a
 * page that `notFound()`s.
 *
 * `SERVICE_CATEGORIES` stays, because six other callers want the full authored
 * list and are right to: `components/marketing/footer.tsx`,
 * `activity-strip.tsx` and `review-wall.tsx` turn a stored slug into words and
 * an icon, which is `labelCategory`'s job and must keep working for a trade we
 * stopped selling, and `providers/join` and `providers/apply` ask a
 * professional which trades they do.
 */
export function asCards(categories: readonly Category[]): ServiceCategoryCard[] {
  return [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({ ...category, Icon: categoryIcon(category.icon) }));
}
