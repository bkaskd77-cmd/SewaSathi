import { describe, expect, it } from "vitest";

import { KEYWORD_RULES, triageProblem } from "@/lib/ai/mockTriage";
import { containsKeyword } from "@/lib/text";
import type { TriageCopy } from "@/lib/ai/copy";

/**
 * A Latin keyword is authored as a STEM, never as a plural.
 *
 * THE BUG, REPORTED BY A CUSTOMER. "insects in the room" was answered and "insect in the
 * room" was not. `containsKeyword` lets the TEXT carry a suffix — `insect` matches
 * "insects" through the `s` in `SUFFIXES` — but it cannot work the other way round, so a
 * keyword written in the plural is invisible to everybody who types the singular.
 *
 * IT WAS HALF-NOTICED AND THAT IS WHY IT SURVIVED. `cockroach`/`cockroaches`,
 * `termite`/`termites` and `rat`/`rats` were each written out twice, which fixed those
 * three words and hid the rule from the next reader. `ants`, `insects` and `packers` had
 * no singular at all.
 *
 * SO THE TEST IS OVER THE LIST, NOT OVER A SENTENCE. A corpus case proves one phrasing
 * works; this proves the whole list is authored the one way that makes every phrasing
 * work. The behavioural half is below it, and the pair is deliberate: the first says what
 * is wrong, the second says what it costs.
 */

/**
 * Keywords that merely END in "s" without being a plural of anything.
 *
 * Each needs a reason, the same shape as `write-grants.test.ts`'s table: an unexplained
 * exception list is how a guard stops biting.
 */
const NOT_A_PLURAL: Record<string, string> = {
  mess: "A mess is one thing. Its 'stem' would be 'mes'.",
  "smell of gas": "Ends in `gas`, the substance; the phrase is not a plural.",
  udus: "Romanized Nepali for उडुस, a bedbug. Not an English plural, and Romanized Nepali has no spelling standard to take a stem from.",
};

const LATIN = /^[a-z0-9 ]+$/;

function latinKeywords(): string[] {
  const out = new Set<string>();
  for (const rule of KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (LATIN.test(keyword)) out.add(keyword);
    }
  }
  return [...out].sort();
}

describe("every Latin keyword is a stem", () => {
  it("has no keyword authored only in the plural", () => {
    const stems = new Set(latinKeywords());
    const offenders: string[] = [];

    for (const keyword of latinKeywords()) {
      if (!keyword.endsWith("s")) continue;
      if (keyword in NOT_A_PLURAL) continue;
      const stem = keyword.slice(0, -1);
      if (stem.length < 3) continue;
      if (stems.has(stem)) {
        /* Both forms present. Not a miss, but it is the redundancy that hid the rule:
           the stem alone already matches the plural. */
        offenders.push(`${keyword} (drop it — "${stem}" already matches it)`);
        continue;
      }
      offenders.push(`${keyword} (author it as "${stem}")`);
    }

    expect(
      offenders,
      "a plural keyword cannot be reached by somebody typing the singular",
    ).toEqual([]);
  });

  /**
   * THE OTHER DIRECTION, so the exception list cannot quietly grow to cover a real
   * plural. Every name in it must still be a keyword somewhere.
   */
  it("lists nothing as an exception that is not a keyword", () => {
    const all = new Set(latinKeywords());
    for (const word of Object.keys(NOT_A_PLURAL)) {
      expect(all.has(word), `"${word}" is excused and is not a keyword — remove it`).toBe(
        true,
      );
    }
  });
});

/**
 * And what the list rule actually buys, asserted as behaviour.
 *
 * `triage-corpus.test.ts` covers coverage across three scripts; these are the exact
 * singular/plural pairs, because "the plural works and the singular does not" is the
 * failure a customer met and a corpus case written in one of the two forms would not
 * have caught it.
 */
const COPY: TriageCopy = {
  explanations: new Proxy({} as Record<string, string>, {
    get: (_t, key) => `explanation for ${String(key)}`,
  }),
  safety: { gas: "GAS.", burning: "BURNING.", "live-wire": "WIRE.", unseenPhoto: "UNSEEN." },
  genericCategory: "a professional",
  genericCtaLabel: "Find a professional",
};

describe("singular and plural reach the same trade", () => {
  const pairs: Array<[string, string, string]> = [
    ["insect in the room", "insects in the room", "pest-control"],
    ["there is an ant problem", "there are ants everywhere", "pest-control"],
    ["a rat in the kitchen", "rats in the kitchen", "pest-control"],
    ["cockroach in the bathroom", "cockroaches in the bathroom", "pest-control"],
    ["termite in the door frame", "termites in the door frame", "pest-control"],
    ["need a mouse trap person", "mice in the ceiling", "pest-control"],
    ["need a packer for my flat", "need packers for my flat", "movers-packers"],
    ["need a mover", "need movers", "movers-packers"],
  ];

  for (const [singular, plural, category] of pairs) {
    it(`"${singular}" and "${plural}" both reach ${category}`, () => {
      expect(triageProblem(singular, COPY).category, singular).toBe(category);
      expect(triageProblem(plural, COPY).category, plural).toBe(category);
    });
  }

  /** The suffix rule itself, at the level it operates on. */
  it("reaches a plural from a stem but never the reverse", () => {
    expect(containsKeyword("insects in the room", "insect")).toBe(true);
    expect(
      containsKeyword("insect in the room", "insects"),
      "this asymmetry IS the bug — the list is what has to be right",
    ).toBe(false);
  });
});
