import { GUARANTEE_WINDOWS } from "@/lib/config/guarantee";
import { isSurveyPriced, type Category, type SubBand } from "@/lib/config/services";

/**
 * What a trade still lacks before the product can actually sell it properly.
 *
 * OPENING A WARD AND OPENING A TRADE ARE NOT THE SAME SIZE OF ACT, and that is
 * the whole reason this file exists. A ward needs a name and a key; everything
 * that reads it then works. A trade is named in five places that are **code**
 * rather than data, and a row inserted into `categories` renders perfectly on
 * the landing grid, on `/services` and on its own category page while being
 * quietly broken in ways nobody would think to check:
 *
 *   - **The keyword matcher cannot reach it.** `KEYWORD_RULES` in
 *     `lib/ai/mockTriage.ts` is a hand-written list of slugs, and that matcher
 *     is what answers when `ANTHROPIC_API_KEY` is missing, rejected, slow or
 *     returns something the schema refuses. So on every fallback path a new
 *     trade is invisible and `GENERIC_RULE` answers plumbing instead.
 *   - **There are no products to narrow to**, so `step-problem.tsx` asks
 *     nothing, every booking in the trade carries a null `band_slug`, and the
 *     duration loop, the per-product bands and the multi-day span all learn
 *     nothing from it for ever.
 *   - **The band is a guess.** A figure typed into a form is `invented`, and
 *     `createBooking` freezes it as `quoted_max` — which is the ceiling
 *     `judgeFinalAmount` measures a 2x overcharge against.
 *
 * NONE OF THESE IS A REFUSAL, deliberately. A trade we have decided to sell is
 * better open and incomplete than blocked behind a code change, and `invented`
 * already has the gate it needs: `npm run check:blockers` refuses a launch
 * build while any published band is a guess. What was missing is that nobody
 * could SEE the gap — the screen said "ten trades" either way — which is the
 * `/admin/signals` posture: measure and say, never grade and never act.
 *
 * IT IS DERIVED, NEVER A CHECKLIST SOMEBODY TICKS. A stored "ready" flag would
 * be a second fact about the same thing, out of date the moment somebody adds a
 * sub-band — rule 6's shape for a readiness screen.
 */

/** One thing a trade has not got yet. The key is the message key. */
export type CategoryGap =
  | "noKeywordRules"
  | "noProducts"
  | "inventedBand"
  | "noGuaranteeWindow";

export type CategoryReadiness = {
  slug: string;
  /** Empty when the trade is as complete as the ten launch ones. */
  gaps: CategoryGap[];
  /**
   * Gaps a person cannot close from any screen in this product.
   *
   * SAID SEPARATELY BECAUSE THE REMEDY DIFFERS, and a list that mixes them
   * reads as four things somebody could go and do. A band moves on
   * `/admin/bands` and products could get a screen; `KEYWORD_RULES` and
   * `GUARANTEE_WINDOWS` are TypeScript, so closing those is a commit — which is
   * a fact about this product worth printing rather than discovering when the
   * API key lapses.
   */
  needsCode: CategoryGap[];
};

const CODE_GAPS: readonly CategoryGap[] = ["noKeywordRules", "noGuaranteeWindow"];

/**
 * Judge one trade against what the product actually holds for it.
 *
 * `keywordSlugs` and `subBands` are passed in rather than imported, because
 * `lib/ai/mockTriage.ts` is the matcher and this is config: importing it here
 * would put the whole keyword table on the import graph of every screen that
 * asks a readiness question. The caller reads them once.
 */
export function categoryReadiness(input: {
  category: Category;
  /** Every slug `KEYWORD_RULES` can return. */
  keywordSlugs: ReadonlySet<string>;
  subBands: readonly Pick<SubBand, "categorySlug">[];
}): CategoryReadiness {
  const { category, keywordSlugs, subBands } = input;
  const gaps: CategoryGap[] = [];

  if (!keywordSlugs.has(category.slug)) gaps.push("noKeywordRules");

  /*
   * A SURVEY TRADE IS COMPLETE WITH NO PRODUCTS AND NO BAND, which is not an
   * exemption but the same rule read correctly: movers publishes no range
   * anywhere in the market, so there is nothing to narrow to and nothing to
   * research. `sub-band-ask.test.ts` already asserts a survey trade has exactly
   * zero products, so flagging it here would contradict a guard that holds.
   */
  if (!isSurveyPriced(category)) {
    const mine = subBands.filter((band) => band.categorySlug === category.slug);
    // A question with one answer is not a question — `sub-band-ask`'s rule.
    if (mine.length < 2) gaps.push("noProducts");
    if (category.pricingSource === "invented") gaps.push("inventedBand");
  }

  /*
   * `guaranteeFor` FALLS BACK TO THE 30-DAY REDO, so this is never a customer
   * promised an empty guarantee — it is a trade whose window nobody chose.
   * Cleaning's 48 hours and painting's 90 days exist precisely because one
   * number across ten trades is meaningless for one and arbitrary for the
   * other, and a new trade silently taking the repair window is the kind of
   * default that reads as a decision.
   */
  if (!(category.slug in GUARANTEE_WINDOWS)) gaps.push("noGuaranteeWindow");

  return {
    slug: category.slug,
    gaps,
    needsCode: gaps.filter((gap) => CODE_GAPS.includes(gap)),
  };
}
