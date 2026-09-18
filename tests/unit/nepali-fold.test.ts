import { describe, expect, it } from "vitest";

import { foldNepali } from "@/lib/text";

/**
 * One sound, two spellings, one match.
 *
 * Nepali writes a nasal before a consonant either as an anusvara (ं) or as the
 * nasal consonant plus a virama (न् म् ङ् ञ् ण्). Both are ordinary. Every
 * Devanagari stem in `lib/ai/safety.ts` was authored in the second form, so
 * somebody typing the first was not detected — eighteen safety stems in that
 * state, and one hand-patched variant (`नांगो तार`) as evidence that this had
 * already been hit once and papered over.
 */

describe("the two spellings converge", () => {
  it("folds the tank, which is where this was found", () => {
    expect(foldNepali("ट्याङ्की")).toBe(foldNepali("ट्यांकी"));
  });

  it.each([
    ["गन्ध", "गंध", "smell — the gas guard"],
    ["सिलिन्डर", "सिलिंडर", "cylinder — the gas guard"],
    ["करेन्ट", "करेंट", "current — the live-wire guard"],
    ["नाङ्गो", "नांगो", "bare — the live-wire guard"],
    ["झुण्डि", "झुंडि", "hanging — the live-wire guard"],
    ["प्लम्बर", "प्लंबर", "plumber — the catalogue search"],
    ["साङ्लो", "सांलो", "cockroach — pest control"],
  ])("folds %s and %s together (%s)", (conjunct, anusvara) => {
    expect(foldNepali(conjunct)).toBe(foldNepali(anusvara));
  });

  it("is idempotent, so folding an already-folded stem is safe", () => {
    const once = foldNepali("ग्यास गन्हाइरहेको छ");
    expect(foldNepali(once)).toBe(once);
  });
});

describe("what it deliberately leaves alone", () => {
  /*
   * A FOLD THAT WIDENS THE MATCH IS A FOLD THAT CRIES WOLF, and CLAUDE.md is
   * explicit that a product which cries wolf is worth nothing when it is real.
   * These three classes vary just as commonly and collapsing any of them
   * merges words that genuinely differ.
   */
  it("keeps श, ष and स apart", () => {
    expect(foldNepali("शाखा")).not.toBe(foldNepali("साखा"));
  });

  it("keeps व and ब apart", () => {
    expect(foldNepali("वन")).not.toBe(foldNepali("बन"));
  });

  it("keeps the short and long i apart", () => {
    expect(foldNepali("दिन")).not.toBe(foldNepali("दीन"));
  });

  /*
   * A VIRAMA AT THE END OF A WORD IS A HALF-FORM, not a nasalised vowel.
   * Folding it would change what the word is rather than how it is spelt,
   * which is why the rule requires a consonant to follow.
   */
  it("leaves a word-final virama alone", () => {
    expect(foldNepali("विद्वान्")).toBe("विद्वान्");
  });

  it("passes Latin and English through untouched", () => {
    expect(foldNepali("gas cylinder is leaking")).toBe(
      "gas cylinder is leaking",
    );
    expect(foldNepali("dhara chuhincha")).toBe("dhara chuhincha");
  });

  /*
   * Most real input is mixed. The Latin half must survive intact while the
   * Devanagari half folds.
   */
  it("folds only the Devanagari half of a mixed sentence", () => {
    expect(foldNepali("AC मा ग्यास गन्ध")).toBe("AC मा ग्यास गंध");
  });

  it("has nothing to say about an empty string", () => {
    expect(foldNepali("")).toBe("");
  });
});
