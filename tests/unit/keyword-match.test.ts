import { describe, expect, it } from "vitest";

import { containsKeyword, foldNepali } from "@/lib/text";
import { GENERIC_SYMPTOMS, KEYWORD_RULES } from "@/lib/ai/mockTriage";
import { CATEGORY_ALIASES } from "@/lib/data/synonyms";

/**
 * A word, not a fragment — and only where that is the right question.
 *
 * `containsKeyword` is shared by the keyword matcher and the catalogue search,
 * which is the point: they read one alias table and must agree about what a
 * word is. It is deliberately NOT used by `lib/ai/safety.ts`, and the last
 * block here pins that, because narrowing a hazard detector is the opposite of
 * what that file is for.
 */
describe("Devanagari is matched as a substring", () => {
  it("matches a stem inside a conjugated word", () => {
    // Nepali conjugates by suffixing and has no usable word boundary for a
    // regex, which is why every list in this product is written as stems.
    expect(containsKeyword("धारा चुहिरहेको छ", "चुहि")).toBe(true);
    expect(containsKeyword("भान्सामा साङ्लो", "भान्सा")).toBe(true);
  });

  it("matches a postposition bound straight onto the word", () => {
    expect(containsKeyword("कोठामा पानी", "कोठा")).toBe(true);
  });
});

describe("Latin must start a word", () => {
  it("refuses a keyword buried inside a longer word", () => {
    /*
     * THE ONE THAT COST A MISROUTE. `tapai` is the Nepali for "you", and a
     * whole-flat repaint reached a plumber because `tap` is inside it.
     */
    expect(containsKeyword("tapai le lyaune", "tap")).toBe(false);
    // `ac` inside `machine` is not a mention of an air conditioner.
    expect(containsKeyword("washing machine", "ac")).toBe(false);
    expect(containsKeyword("orange wall", "rang")).toBe(false);
  });

  it("matches the same keyword when it really is a word", () => {
    expect(containsKeyword("kitchen tap keeps dripping", "tap")).toBe(true);
    expect(containsKeyword("ac not cooling", "ac")).toBe(true);
  });

  it("allows an English inflection after it", () => {
    // A trailing boundary alone would be too strict: English suffixes too.
    expect(containsKeyword("want the room repainted", "repaint")).toBe(true);
    expect(containsKeyword("water flooding the floor", "flood")).toBe(true);
    expect(containsKeyword("drain is blocked", "block")).toBe(true);
  });

  it("allows a Romanized Nepali postposition after it", () => {
    /*
     * THE REGRESSION THE FIRST VERSION SHIPPED. Latin script here carries two
     * languages. Allowing only English inflections broke Romanized Nepali,
     * which is the same alphabet and nothing like the same morphology.
     */
    expect(containsKeyword("dharama pani aayena", "dhara")).toBe(true);
    expect(containsKeyword("mistrile bhanyo", "mistri")).toBe(true);
    expect(containsKeyword("gharbata saman", "ghar")).toBe(true);
  });

  it("refuses a suffix from neither language", () => {
    // `tanki` is not `tank` plus anything — it is how ट्यांकी is spelt in
    // Latin letters, so it is a word and lives in synonyms.ts instead.
    expect(containsKeyword("pani tanki safa", "tank")).toBe(false);
  });

  it("matches at the very end of the text", () => {
    // The bounds check is the kind of thing that is right until it is not.
    expect(containsKeyword("problem with the tap", "tap")).toBe(true);
    expect(containsKeyword("rooms need paint", "paint")).toBe(true);
  });

  it("finds a later occurrence when the first is buried", () => {
    // The scan must not stop at the first rejected position.
    expect(containsKeyword("tapai said the tap leaks", "tap")).toBe(true);
  });

  it("is never true for an empty keyword", () => {
    expect(containsKeyword("anything at all", "")).toBe(false);
  });
});

/**
 * The lists this rule is applied to stay usable under it.
 *
 * A keyword nothing can ever match is dead weight that reads as coverage, and
 * this is the class of mistake a boundary rule introduces silently.
 */
describe("every authored term can still match itself", () => {
  it("holds for every keyword rule", () => {
    for (const rule of KEYWORD_RULES) {
      for (const keyword of rule.keywords) {
        const folded = foldNepali(keyword.toLowerCase());
        expect(
          containsKeyword(folded, folded),
          `${rule.category}: ${keyword} cannot match itself`,
        ).toBe(true);
      }
    }
  });

  it("holds for every alias", () => {
    for (const alias of CATEGORY_ALIASES) {
      const folded = foldNepali(alias.term.toLowerCase());
      expect(
        containsKeyword(folded, folded),
        `${alias.term} cannot match itself`,
      ).toBe(true);
    }
  });
});

/**
 * An object beats a symptom, and the symptom list cannot drift.
 *
 * `GENERIC_SYMPTOMS` is a small hand-written list, which is exactly the shape
 * that rots: a keyword gets reworded in the rules above and the entry here
 * quietly stops applying to anything, with nothing failing. So it is asserted
 * against the rules rather than trusted.
 */
describe("the symptom list is tied to the rules", () => {
  it("names only words some rule actually uses", () => {
    const authored = new Set(
      KEYWORD_RULES.flatMap((rule) =>
        rule.keywords.map((keyword) => foldNepali(keyword.toLowerCase())),
      ),
    );
    // Array.from rather than for...of: the tsconfig target predates
    // downlevel iteration, the same limit that keeps the `u` flag off the
    // regex in lib/text/nepali.ts.
    for (const symptom of Array.from(GENERIC_SYMPTOMS)) {
      expect(authored.has(symptom), `${symptom} is in no rule`).toBe(true);
    }
  });

  it("is a short list, and stays one", () => {
    /*
     * A WORD GOES IN HERE ONLY WHEN IT NAMES NO OBJECT AND BELONGS TO NO TRADE
     * ON ITS OWN. `leak` stays out: a leak is a symptom, but it is
     * unmistakably plumbing's. The failure mode this guards is somebody
     * demoting half the keyword lists to fix one route, which would leave
     * ranking decided by whatever was left.
     */
    expect(GENERIC_SYMPTOMS.size).toBeLessThanOrEqual(12);
  });
});
