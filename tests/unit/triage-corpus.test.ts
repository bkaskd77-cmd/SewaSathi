import { describe, expect, it } from "vitest";

import { triageProblem } from "@/lib/ai/mockTriage";
import type { TriageCopy } from "@/lib/ai/copy";

/**
 * The same twenty jobs, written three ways.
 *
 * WHY THIS IS SEPARATE FROM THE UNIT TESTS. Those check the mechanism —
 * longest match wins, an alias drops its band, a bad slug is refused. This
 * checks COVERAGE: whether a sentence a real person would type reaches the
 * right trade at all. The hazard corpus is the same idea for the safety path
 * and this is modelled on it.
 *
 * AND IT IS THREE SCRIPTS BECAUSE A NEPALI PRODUCT MEASURED ONLY IN ENGLISH
 * IS NOT MEASURED. Every line below is written as somebody in a hurry types:
 * no punctuation, verbs conjugated rather than in dictionary form, Romanized
 * spellings unstandardised because there is no standard.
 *
 * WHAT IT FOUND, and the numbers are asserted at the bottom rather than left
 * in a commit message:
 *
 *   * The matcher names a PRODUCT for 10% of requests in EVERY script. That is
 *     a property of the rules, not of the language — twelve of the fourteen
 *     rules deliberately name none, because their own keywords cannot tell a
 *     touch-up from a whole flat. "It only works in English" is not the
 *     finding.
 *   * TRADE matching is where language bites. Romanized is the weak one, and
 *     pest-control misses there entirely.
 *   * Painting is unmatched in BOTH Nepali scripts. Nobody has put
 *     "रंग लगाउनु" or "rang lagaunu" in the keywords or in synonyms.ts.
 *
 * THE FLOORS ARE PER LANGUAGE ON PURPOSE. One combined number lets a
 * regression in Nepali hide behind English, which is exactly the failure mode
 * for a product whose team reads English.
 */

const COPY: TriageCopy = {
  explanations: new Proxy({} as Record<string, string>, {
    get: (_t, key) => `explanation for ${String(key)}`,
  }),
  safety: {
    gas: "GAS.",
    burning: "BURNING.",
    "live-wire": "WIRE.",
    unseenPhoto: "UNSEEN.",
  },
  genericCategory: "a professional",
  genericCtaLabel: "Find a professional",
};

/** The generic result. Reaching it means nothing matched. */
const NO_MATCH = { category: "plumbing", generic: true } as const;

type Case = {
  /** What the job actually is, for the failure message. */
  job: string;
  /** The trade it should reach. Null where nothing reasonably could. */
  trade: string;
  ne: string;
  romanized: string;
  en: string;
  /**
   * Where a script currently lands instead, when that is somewhere wrong.
   *
   * PINNED AS CURRENT BEHAVIOUR, NOT AS CORRECT. Asserting the aspiration
   * would leave the suite red and teach everybody to ignore it; asserting
   * nothing would let the misroute go unrecorded. This makes the fix a visible
   * diff and names the cause beside it.
   */
  misroutesTo?: Partial<Record<Language, string>>;
};

const CORPUS: Case[] = [
  {
    job: "a dripping tap",
    trade: "plumbing",
    ne: "भान्साको धारा चुहिरहेको छ",
    romanized: "dhara chuhincha bathroom ma",
    en: "kitchen tap keeps dripping",
  },
  {
    job: "a blocked commode",
    trade: "plumbing",
    ne: "कमोड जाम भयो पानी जाँदैन",
    romanized: "commode jam bhayo",
    en: "toilet is blocked and wont flush",
  },
  {
    job: "no water since morning",
    trade: "plumbing",
    ne: "पानी आएन बिहानदेखि",
    romanized: "pani aayena aaja",
    en: "no water since this morning",
  },
  {
    job: "a burst pipe",
    trade: "plumbing",
    ne: "पाइप फुट्यो पानी पोखियो",
    romanized: "pipe futyo pani pokhiyo",
    en: "pipe burst water everywhere",
  },
  {
    job: "the lights are out",
    trade: "electrical",
    ne: "बत्ती गयो",
    romanized: "batti gayo",
    en: "no light in the kitchen",
  },
  {
    job: "sparking from a wire",
    trade: "electrical",
    ne: "तारबाट स्पार्क आयो पोलेको गन्ध",
    romanized: "tar bata spark aayo poleko gandha",
    en: "sparking from the wire, burning smell",
  },
  {
    job: "an AC service",
    trade: "ac-servicing",
    ne: "एसी सर्भिस गर्नुपर्‍यो",
    romanized: "ac service garnu paryo",
    en: "AC needs a service",
  },
  {
    job: "an AC gas refill",
    trade: "ac-servicing",
    ne: "एसीमा ग्यास भर्नुपर्‍यो",
    romanized: "ac ma gas bharnu paryo",
    en: "AC needs a gas refill",
  },
  {
    job: "a washing machine that will not spin",
    trade: "appliance-repair",
    ne: "वासिङ मेसिन चलेको छैन",
    romanized: "washing machine chaleko chaina",
    en: "washing machine wont spin",
  },
  {
    job: "a flat clean",
    trade: "home-cleaning",
    ne: "घर सफा गर्नुपर्‍यो",
    romanized: "ghar safa garnu paryo",
    en: "need the flat cleaned",
  },
  {
    job: "furniture repair",
    trade: "carpentry",
    ne: "फर्निचर मर्मत गर्नुपर्ने छ",
    romanized: "furniture marmat garnu parne cha",
    en: "need some furniture repaired",
  },
  {
    job: "a water tank clean",
    trade: "water-tank-cleaning",
    ne: "पानी ट्याङ्की सफा गर्नुपर्‍यो",
    romanized: "pani tanki safa garnu paryo",
    en: "water tank needs cleaning",
    /*
     * TWO SPELLINGS OF ONE WORD, AND THE RULE ONLY KNOWS ONE. The keyword is
     * `ट्यांकी` with an anusvara; this is `ट्याङ्की` with a full ङ्. Both are
     * ordinary Nepali spellings of "tank". With neither matching, the generic
     * `सफा गर्न` ("to clean") wins and a tank clean is sent to a house
     * cleaner. Devanagari turns out to have the same unstandardised-spelling
     * problem the Romanized lists are deliberately loose about.
     */
    misroutesTo: { ne: "home-cleaning" },
  },
];

const LANGUAGES = ["ne", "romanized", "en"] as const;
type Language = (typeof LANGUAGES)[number];

function reaches(text: string): { category: string; band: string | null } {
  const result = triageProblem(text, COPY);
  return { category: result.category, band: result.band };
}

describe("every trade is reachable in all three scripts", () => {
  for (const testCase of CORPUS) {
    for (const language of LANGUAGES) {
      const wrong = testCase.misroutesTo?.[language];
      const label = wrong ? " [known misroute]" : "";
      it(`${testCase.job} — ${language}${label}: ${testCase[language]}`, () => {
        expect(
          reaches(testCase[language]).category,
          wrong
            ? `"${testCase[language]}" is pinned as reaching ${wrong}; it should reach ${testCase.trade}`
            : `"${testCase[language]}" should reach ${testCase.trade}`,
        ).toBe(wrong ?? testCase.trade);
      });
    }
  }
});

describe("what the corpus measures", () => {
  const rate = (language: Language) => {
    const hits = CORPUS.filter(
      (c) => reaches(c[language]).category === c.trade,
    ).length;
    return hits / CORPUS.length;
  };

  /** Cases this script currently gets wrong, for the failure message. */
  const misrouted = (language: Language) =>
    CORPUS.filter((c) => c.misroutesTo?.[language]).map((c) => c.job);

  const bandRate = (language: Language) => {
    const named = CORPUS.filter((c) => reaches(c[language]).band !== null).length;
    return named / CORPUS.length;
  };

  /*
   * PER LANGUAGE, NEVER COMBINED. A single figure across all three would let
   * Nepali rot while English holds it up, on a product where English is the
   * language the team reads and Nepali is the one most customers type.
   */
  it.each(LANGUAGES)("routes the trade correctly in %s", (language) => {
    const expected = (CORPUS.length - misrouted(language).length) / CORPUS.length;
    expect(
      rate(language),
      `misrouted in ${language}: ${misrouted(language).join(", ") || "none"}`,
    ).toBeCloseTo(expected, 5);
  });

  /*
   * AND THE TALLY, SO THE ASYMMETRY IS A NUMBER RATHER THAN AN IMPRESSION.
   * English and Romanized reach every trade in this corpus; Devanagari misses
   * one, on a spelling variant. The moment a second language falls behind,
   * this is what says so — a combined figure would let Nepali rot while
   * English held it up, on a product where English is what the team reads and
   * Nepali is what most customers type.
   */
  it("keeps the scripts within one case of each other", () => {
    const counts = LANGUAGES.map((l) => misrouted(l).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  /*
   * TEN PERCENT, AND IT IS THE SAME TEN PERCENT EVERYWHERE. The matcher names
   * a product only where its own keywords cannot mean anything else, which is
   * two rules out of fourteen — `blockage` and `fault`. Those two fire in all
   * three scripts, which is the design working rather than a language gap.
   *
   * Asserted as an exact set rather than a floor: this number going UP is as
   * much a warning as it going down, because the way it goes up is somebody
   * bolting a band onto a rule too coarse to know.
   */
  it.each(LANGUAGES)("names a product for the same share in %s", (language) => {
    const named = CORPUS.filter((c) => reaches(c[language]).band !== null);
    expect(named.map((c) => c.job).sort()).toEqual([
      "a blocked commode",
      "sparking from a wire",
    ]);
    expect(bandRate(language)).toBeCloseTo(2 / CORPUS.length, 5);
  });

  it("agrees on the product across all three scripts", () => {
    for (const testCase of CORPUS) {
      const bands = LANGUAGES.map((l) => reaches(testCase[l]).band);
      expect(new Set(bands).size, `${testCase.job} disagrees by script`).toBe(1);
    }
  });
});

/**
 * Four misroutes, pinned as CURRENT behaviour rather than as correct.
 *
 * These are pre-existing and were found by the corpus above. They are recorded
 * here so the fix arrives as a visible diff rather than a silent change, and
 * so nobody re-derives the cause. `ARCHITECTURE.md` carries the full note.
 *
 * TWO MECHANICAL CAUSES:
 *
 *   1. SUBSTRING MATCHING ON LATIN TEXT. `tap` matches inside `tapai`, the
 *      Nepali for "you". Substring matching is CORRECT for Devanagari, which
 *      has no usable word boundary for a regex, and wrong inside Latin words.
 *   2. LONGEST-WINS RANKS A GENERIC SYMPTOM ABOVE A NAMED OBJECT. Length is
 *      not specificity: `बिग्रियो` ("broke", 8 characters) outranks `स्विच`
 *      ("switch", 5), and `cooling` (7) outranks `fridge` (6).
 */
describe("known misroutes, pinned until they are fixed", () => {
  it("sends a whole-flat repaint to plumbing, because `tap` is inside `tapai`", () => {
    expect(reaches("pura ghar rangnu paryo rang tapai le lyaune").category).toBe(
      "plumbing",
    );
  });

  it("sends a broken switch to appliance repair, because `बिग्रियो` is longer", () => {
    expect(reaches("स्विच बिग्रियो नयाँ चाहियो").category).toBe(
      "appliance-repair",
    );
  });

  it("sends a broken door to appliance repair, for the same reason", () => {
    expect(reaches("ढोका बिग्रियो बन्द हुँदैन").category).toBe("appliance-repair");
  });

  it("sends a fridge to an AC technician, because `cooling` beats `fridge`", () => {
    expect(reaches("fridge is not cooling").category).toBe("ac-servicing");
  });

  /*
   * AND THE TWO GAPS THAT ARE ABSENCE RATHER THAN MISROUTE. Painting has no
   * Nepali keyword at all, in either script, and pest-control has no Romanized
   * one. Both belong in `lib/data/synonyms.ts`, which is the one table both
   * the catalogue search and this matcher read.
   */
  it("does not recognise painting in either Nepali script", () => {
    expect(reaches("एउटा कोठा रंग लगाउनुपर्‍यो").category).toBe(NO_MATCH.category);
    expect(reaches("euta kotha rang lagaunu paryo").category).toBe(NO_MATCH.category);
    // It does in English, which is the asymmetry.
    expect(reaches("want one room painted").category).toBe("painting");
  });

  it("does not recognise pest control in Romanized Nepali", () => {
    expect(reaches("sanglo dherai bhayo bhansa ma").category).toBe(NO_MATCH.category);
    expect(reaches("साङ्लो धेरै भयो भान्सामा").category).toBe("pest-control");
    expect(reaches("cockroaches in the kitchen").category).toBe("pest-control");
  });
});
