import { describe, expect, it } from "vitest";

import {
  categoryReadiness,
  type CategoryGap,
} from "@/lib/config/category-readiness";
import { GUARANTEE_WINDOWS } from "@/lib/config/guarantee";
import { KEYWORD_RULES } from "@/lib/ai/mockTriage";
import {
  CATEGORY_SEED,
  CATEGORY_SLUG_SHAPE,
  SUB_BAND_SEED,
  type Category,
} from "@/lib/config/services";

/**
 * What a newly opened trade still lacks.
 *
 * THE POINT OF THIS RULE IS THAT A ROW IN `categories` LOOKS COMPLETE. It
 * renders on the landing grid, on `/services` and on its own page with every
 * word in place, while three things nobody would check are missing: the keyword
 * matcher cannot reach it (and that matcher is what answers whenever the AI key
 * is missing, rejected or slow), there are no products to narrow to, and the
 * band is a figure somebody typed. "Ten trades" looked identical either way.
 *
 * THE TEN LAUNCH TRADES ARE THE ORACLE. Rather than asserting the rule against
 * a fixture I wrote, the first case asserts that every authored trade comes back
 * with NO gaps — so the definition of "ready" is whatever the launch catalogue
 * actually is, and a rule that drifted from it fails here rather than printing a
 * warning on all ten.
 */

const KEYWORD_SLUGS = new Set(KEYWORD_RULES.map((rule) => rule.category));

/** A trade somebody has just opened: words and a typed band, nothing else. */
const OPENED: Category = {
  slug: "gardening",
  nameEn: "Gardening",
  nameNe: "बगैंचा",
  descriptor: "trim and tidy",
  descriptorNe: "काटकुट",
  description: "Hedges, lawns and beds.",
  descriptionNe: "बार, चौर र क्यारा।",
  ctaLabel: "gardener",
  ctaLabelNe: "माली",
  basePriceMin: 800,
  basePriceMax: 5000,
  pricingSource: "invented",
  pricingCheckedAt: null,
  pricingNote: null,
  pricingConfidence: "low",
  pricingModel: "band",
  icon: "Wrench",
  sortOrder: 1000,
};

function gaps(category: Category, subBands = SUB_BAND_SEED): CategoryGap[] {
  return categoryReadiness({
    category,
    keywordSlugs: KEYWORD_SLUGS,
    subBands,
  }).gaps;
}

describe("the launch catalogue is what ready means", () => {
  it("finds nothing missing in any authored trade", () => {
    expect(CATEGORY_SEED.length).toBeGreaterThan(0);
    for (const category of CATEGORY_SEED) {
      expect(gaps(category), `${category.slug}`).toEqual([]);
    }
  });

  it("counts the survey trade as complete with no products and no band", () => {
    /*
     * MOVERS IS THE CASE AND IT IS NOT AN EXEMPTION. No Nepali operator
     * publishes a figure, so there is nothing to narrow to and nothing to
     * research — and `sub-band-ask.test.ts` already asserts a survey trade has
     * exactly zero products. Flagging it here would contradict a guard that
     * holds, and would put a permanent "two things missing" on a trade that is
     * finished.
     */
    const survey = CATEGORY_SEED.filter((c) => c.pricingModel === "survey");
    expect(survey.length).toBeGreaterThan(0);
    for (const category of survey) {
      expect(
        SUB_BAND_SEED.filter((b) => b.categorySlug === category.slug),
      ).toHaveLength(0);
      expect(category.pricingSource, `${category.slug}`).toBe("invented");
      expect(gaps(category), `${category.slug}`).toEqual([]);
    }
  });
});

describe("a trade somebody just opened", () => {
  it("names all four gaps", () => {
    expect(gaps(OPENED).sort()).toEqual(
      ["inventedBand", "noGuaranteeWindow", "noKeywordRules", "noProducts"].sort(),
    );
  });

  it("separates the two a person cannot close from any screen", () => {
    /*
     * THE REMEDY DIFFERS AND THAT IS WHY IT IS A SECOND FIELD. A band moves on
     * `/admin/bands` and products could get a screen; `KEYWORD_RULES` and
     * `GUARANTEE_WINDOWS` are TypeScript, so those two are a commit — which is
     * a fact about this product worth printing rather than discovering when the
     * API key lapses.
     */
    const readiness = categoryReadiness({
      category: OPENED,
      keywordSlugs: KEYWORD_SLUGS,
      subBands: SUB_BAND_SEED,
    });
    expect(readiness.needsCode.sort()).toEqual(
      ["noGuaranteeWindow", "noKeywordRules"].sort(),
    );
    for (const gap of readiness.needsCode) {
      expect(readiness.gaps).toContain(gap);
    }
  });

  it("closes each gap on its own as the thing arrives", () => {
    /* One at a time, so a rule that collapsed two of them into one answer
       cannot pass by accident. */
    const known = { ...OPENED, slug: "plumbing" };
    expect(gaps(known)).not.toContain("noKeywordRules");
    expect(gaps(known)).not.toContain("noGuaranteeWindow");

    const researched: Category = { ...OPENED, pricingSource: "researched" };
    expect(gaps(researched)).not.toContain("inventedBand");
    expect(gaps({ ...OPENED, pricingSource: "observed" })).not.toContain(
      "inventedBand",
    );

    const withProducts = [
      ...SUB_BAND_SEED,
      { categorySlug: "gardening" },
      { categorySlug: "gardening" },
    ];
    expect(gaps(OPENED, withProducts as typeof SUB_BAND_SEED)).not.toContain(
      "noProducts",
    );
  });

  it("treats one product as no products, because one answer is not a question", () => {
    /* `sub-band-ask`'s own rule, asserted here so the two screens agree about
       what counts as a product list. */
    const one = [...SUB_BAND_SEED, { categorySlug: "gardening" }];
    expect(gaps(OPENED, one as typeof SUB_BAND_SEED)).toContain("noProducts");
  });

  it("is in the slug shape every authored trade is already in", () => {
    for (const category of CATEGORY_SEED) {
      expect(CATEGORY_SLUG_SHAPE.test(category.slug), category.slug).toBe(true);
    }
    for (const bad of [
      "Water Tank Cleaning",
      "water_tank_cleaning",
      "plumbing-2",
      "plumbing-",
      "-plumbing",
      "PLUMBING",
      " plumbing",
    ]) {
      expect(CATEGORY_SLUG_SHAPE.test(bad), bad).toBe(false);
    }
  });
});

describe("the guarantee window gap is about a choice, never an empty promise", () => {
  it("still gives an unlisted trade the repair window", async () => {
    /*
     * `guaranteeFor` FALLS BACK TO 30 DAYS, which this gap must not be read as
     * contradicting: a customer is never promised a guarantee that is empty.
     * What the gap says is that nobody CHOSE — cleaning's 48 hours and
     * painting's 90 days exist because one number across ten trades is
     * meaningless for one and arbitrary for the other.
     */
    const { guaranteeFor } = await import("@/lib/config/guarantee");
    expect(OPENED.slug in GUARANTEE_WINDOWS).toBe(false);
    expect(guaranteeFor(OPENED.slug).days).toBe(30);
    expect(guaranteeFor(OPENED.slug).kind).toBe("redo");
    expect(gaps(OPENED)).toContain("noGuaranteeWindow");
  });
});
