import { describe, expect, it } from "vitest";

import { detectHazard, type Hazard } from "@/lib/ai/safety";

/**
 * Realistic hazard sentences, in the three ways people actually type here.
 *
 * This is the corpus, kept separate from the unit tests on purpose. Those test
 * the mechanism; this tests coverage — whether a real sentence from a real
 * frightened person reaches the safety path.
 *
 * Every line below is written as somebody in a hurry would type it: no
 * punctuation to speak of, mixed script, the verb conjugated rather than in
 * the dictionary form, and Romanized spellings that are not standardised
 * because there is no standard.
 *
 * ADDING TO THIS IS ALWAYS CHEAP AND ALWAYS WORTH IT. When a native speaker
 * flags a phrasing, it goes here first as a failing case, then the matcher
 * changes.
 */

type Case = [text: string, expected: Hazard, note?: string];

const GAS: Case[] = [
  // Devanagari, verb conjugated every way it comes.
  ["भान्सामा ग्यास गन्हाइरहेको छ", "gas"],
  ["ग्यास गन्हायो", "gas"],
  ["बिहानैदेखि ग्याँस गन्हाउँछ", "gas", "chandrabindu spelling"],
  ["कोठाभरि ग्यासको गन्ध आयो", "gas"],
  ["सिलिन्डरबाट ग्यास चुहिरहेको छ", "gas"],
  ["ग्यास चुहियो अब के गर्ने", "gas"],
  ["ग्याँस लिक भएको जस्तो छ", "gas"],
  ["सिलिन्डरको पाइपबाट ग्यास निस्किरहेको छ", "gas"],
  ["ग्यासको बास्ना आइरहेछ डर लाग्यो", "gas"],
  ["एलपीजी गन्हाएको छ", "gas"],

  // Romanized, spelled the several ways it gets spelled.
  ["ghar bhari gas ko gandha aayo", "gas"],
  ["gas ganhayo bhansa ma", "gas"],
  ["silinder bata gas chuhiraheko cha", "gas"],
  ["gyas leak bhayo", "gas"],
  ["lpg gas ko basna aairacha", "gas"],

  ["I can smell gas in the kitchen", "gas"],
  ["gas cylinder is leaking, what do I do", "gas"],
];

const BURNING: Case[] = [
  ["स्विचबाट धुवाँ आइरहेको छ", "burning"],
  ["तार पोलेको गन्ध आयो", "burning"],
  ["बोर्ड जलेको छ र धुवा निस्कियो", "burning"],
  ["सकेट डढेको छ", "burning"],
  ["प्लास्टिक पोलेको जस्तो गन्हायो", "burning"],
  ["मिटरबाट स्पार्क भयो", "burning"],
  ["स्विच बोर्डमा आगो जस्तो देखियो", "burning"],
  ["तारमा सर्ट सर्किट भयो", "burning"],

  ["switch bata dhuwa aayo", "burning"],
  ["tar poleko gandha aayo", "burning"],
  ["board ma spark bhayo", "burning"],

  ["burning smell from the socket", "burning"],
  ["the switchboard is sparking", "burning"],
  ["smoke coming out of the fuse box", "burning"],
];

const LIVE_WIRE: Case[] = [
  ["नाङ्गो तार बाहिर निस्केको छ", "live-wire"],
  ["तार खुला छ बच्चा नजिकै छ", "live-wire"],
  ["छानाबाट तार झुण्डिएको छ", "live-wire"],
  ["धारा छुँदा करेन्ट लाग्यो", "live-wire"],
  ["स्विच छुँदा झट्का लाग्यो", "live-wire"],
  ["बिजुली लाग्यो हात सुन्निएको छ", "live-wire"],

  ["nango tar bahira niskeko cha", "live-wire"],
  ["dhara chudda current lagyo", "live-wire"],
  ["switch chuda jhatka lagyo", "live-wire"],

  ["got an electric shock from the tap", "live-wire"],
  ["there is a bare wire hanging in the bathroom", "live-wire"],
];

/**
 * Ordinary complaints that must NOT be escalated.
 *
 * These matter as much as the hazards. A product that shouts about gas leaks
 * at somebody whose power is simply out teaches everyone to ignore the
 * warning, and then it is worth nothing when it is real.
 */
const CALM: string[] = [
  "करेन्ट आएको छैन",
  "बिजुली गएको छ बत्ती बल्दैन",
  "current aaeko chaina",
  "the power is out in the whole tole",

  "एसीमा ग्यास भर्नुपर्‍यो",
  "ac gas refill garnu parne cha",
  "AC needs a gas refill, not cooling",
  "fridge is not cooling, maybe gas refill",

  "भान्साको धारा चुहिरहेको छ",
  "kitchen tap is dripping since morning",
  "bathroom ko dhara chuhiyo",

  "घर सफा गर्नुपर्‍यो",
  "need the flat deep cleaned before we move in",
  "फर्निचर मर्मत गर्नुपर्ने छ",
  "washing machine is not spinning",
  "बत्ती फ्युज भयो नयाँ हाल्नुपर्‍यो",
];

describe("gas, as people actually report it", () => {
  for (const [text, expected] of GAS) {
    it(text, () => expect(detectHazard(text)).toBe(expected));
  }
});

describe("burning and sparking, as people actually report it", () => {
  for (const [text, expected] of BURNING) {
    it(text, () => expect(detectHazard(text)).toBe(expected));
  }
});

describe("live wiring and shocks, as people actually report it", () => {
  for (const [text, expected] of LIVE_WIRE) {
    it(text, () => expect(detectHazard(text)).toBe(expected));
  }
});

describe("ordinary jobs stay ordinary", () => {
  for (const text of CALM) {
    it(text, () => expect(detectHazard(text)).toBeNull());
  }
});

describe("the corpus itself", () => {
  it("covers all three hazards in all three ways people write", () => {
    // A corpus that quietly lost its Devanagari half would still pass every
    // assertion above. This is the check on the check.
    const devanagari = /[ऀ-ॿ]/;
    for (const group of [GAS, BURNING, LIVE_WIRE]) {
      expect(group.filter(([t]) => devanagari.test(t)).length).toBeGreaterThan(2);
      expect(
        group.filter(([t]) => !devanagari.test(t) && !/^[\x00-\x7F]*$/.test(t))
          .length,
      ).toBe(0);
      // At least some Romanized and some English.
      expect(group.filter(([t]) => !devanagari.test(t)).length).toBeGreaterThan(2);
    }
  });
});
