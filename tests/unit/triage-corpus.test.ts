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
     * FIXED BY `foldNepali`, AND IT WAS PINNED HERE AS A MISROUTE FIRST.
     *
     * The keyword is `ट्यांकी` with an anusvara; this is `ट्याङ्की` with a
     * full ङ्. Both are ordinary Nepali spellings of "tank". With neither
     * matching, the generic `सफा गर्न` ("to clean") won and a tank clean was
     * sent to a house cleaner. That is the whole class the fold exists for,
     * and the same class that left eighteen safety stems undetectable in
     * their other spelling.
     */
  },
];

const LANGUAGES = ["ne", "romanized", "en"] as const;
type Language = (typeof LANGUAGES)[number];

function reaches(text: string): {
  category: string;
  band: string | null;
  /**
   * Nothing matched at all.
   *
   * The generic rule answers `plumbing`, so a category on its own cannot tell
   * "we read this as a plumbing job" from "we read nothing and fell back".
   * COPY resolves an explanation key to its own name, so this is exact.
   */
  generic: boolean;
} {
  const result = triageProblem(text, COPY);
  return {
    category: result.category,
    band: result.band,
    generic: result.explanation === "explanation for generic",
  };
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
   * All three scripts reach every trade in this corpus now — Devanagari was
   * one behind until `foldNepali` landed. The moment one falls behind again,
   * this is what says so: a combined figure would let Nepali rot while English
   * held it up, on a product where English is what the team reads and Nepali
   * is what most customers type.
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
 * The four misroutes, now asserted as FIXED rather than pinned as current.
 *
 * They were recorded here as current behaviour so the fix would arrive as a
 * visible diff rather than a silent change. This is that diff. Each case keeps
 * the cause written beside it, because the cause is the thing worth
 * remembering — the misroute itself is now just an input.
 *
 * TWO MECHANICAL CAUSES, and one rule each:
 *
 *   1. SUBSTRING MATCHING ON LATIN TEXT. `tap` matched inside `tapai`, the
 *      Nepali for "you". Substring is CORRECT for Devanagari, which has no
 *      usable word boundary for a regex, and wrong inside Latin words. A Latin
 *      keyword now has to start a word and may only be continued by a known
 *      suffix — `lib/text/match.ts`.
 *   2. LONGEST-WINS RANKED A GENERIC SYMPTOM ABOVE A NAMED OBJECT. Length is
 *      not specificity: `बिग्रियो` ("broke", 8) outranked `स्विच` ("switch",
 *      5), and `cooling` (7) outranked `fridge` (6). An object now beats a
 *      symptom whatever the length — `GENERIC_SYMPTOMS` in mockTriage.
 */
describe("the four misroutes, fixed", () => {
  it("sends a whole-flat repaint to painting, not to a plumber", () => {
    // `tap` is inside `tapai`. Nothing else in the sentence was plumbing's.
    expect(reaches("pura ghar rangnu paryo rang tapai le lyaune").category).toBe(
      "painting",
    );
  });

  it("sends a broken switch to an electrician, although `बिग्रियो` is longer", () => {
    expect(reaches("स्विच बिग्रियो नयाँ चाहियो").category).toBe("electrical");
  });

  it("sends a broken door to a carpenter, for the same reason", () => {
    expect(reaches("ढोका बिग्रियो बन्द हुँदैन").category).toBe("carpentry");
  });

  it("sends a fridge to appliance repair, although `cooling` is longer", () => {
    expect(reaches("fridge is not cooling").category).toBe("appliance-repair");
  });

  /*
   * AND THE SYMPTOM STILL WINS WHEN IT IS ALL THERE IS. Demoting a symptom
   * must not silence it — somebody who types only "बिग्रियो" has still told us
   * something, and the object rule only decides between candidates.
   */
  it("still answers when the sentence is nothing but a symptom", () => {
    expect(reaches("बिग्रियो").category).toBe("appliance-repair");
    expect(reaches("not working").category).toBe("appliance-repair");
  });

  /*
   * AND A NAMED OBJECT STILL LOSES TO A LONGER NAMED OBJECT. The original
   * rule is untouched inside a kind, which is what keeps "ac not cooling" on
   * the AC technician rather than sending it to appliance repair.
   */
  it("keeps longest-wins between two objects", () => {
    expect(reaches("ac not cooling").category).toBe("ac-servicing");
    expect(reaches("washing machine not working").category).toBe(
      "appliance-repair",
    );
  });
});

/**
 * The two gaps that were absence rather than misroute.
 *
 * Both were filled in `lib/data/synonyms.ts`, the one table the catalogue
 * search and this matcher both read, so both surfaces learnt them at once.
 *
 * PAINTING WAS A SPELLING PROBLEM, NOT AN ABSENCE, and that is the more
 * useful half. `foldNepali` collapses a nasal consonant plus virama into an
 * anusvara, so `ट्याङ्की` and `ट्यांकी` are one string to it. `रङ` is a bare ङ
 * with no virama, so `रङ` and `रंग` are two — and every painting term was
 * authored in the first. Widening the fold was refused for the reason
 * CLAUDE.md gives; both spellings are authored instead.
 */
describe("the two coverage gaps, filled", () => {
  it("recognises painting in both Nepali scripts", () => {
    expect(reaches("एउटा कोठा रंग लगाउनुपर्‍यो").category).toBe("painting");
    expect(reaches("euta kotha rang lagaunu paryo").category).toBe("painting");
    expect(reaches("want one room painted").category).toBe("painting");
  });

  it("recognises pest control in Romanized Nepali", () => {
    expect(reaches("sanglo dherai bhayo bhansa ma").category).toBe(
      "pest-control",
    );
    expect(reaches("साङ्लो धेरै भयो भान्सामा").category).toBe("pest-control");
    expect(reaches("cockroaches in the kitchen").category).toBe("pest-control");
  });
});

/**
 * A postposition written closed up still matches.
 *
 * THE REGRESSION THE FIRST VERSION OF THE BOUNDARY RULE SHIPPED, caught by the
 * corpus. Allowing only English inflections after a Latin keyword broke
 * Romanized Nepali, which is the same alphabet and nothing like the same
 * morphology: "dharama" stopped matching `dhara` and "mistrile" stopped
 * matching `mistri`. CLAUDE.md says a postposition takes a space after Latin
 * text — that is how we write them, not how everybody types them.
 */
describe("romanized Nepali keeps its suffixes", () => {
  it("matches a stem with a postposition stuck to it", () => {
    expect(reaches("dharama pani aayena").category).toBe("plumbing");
    expect(reaches("mistrile aayena").category).toBe("plumbing");
  });

  it("still refuses a Latin keyword buried in a longer word", () => {
    // The whole point: `tapai` is `tap` + `ai`, and `ai` is a suffix in
    // neither language.
    expect(reaches("tapai le bhannu bhayo").category).toBe(NO_MATCH.category);
    expect(reaches("tapai le bhannu bhayo").generic).toBe(true);
  });
});
