import { describe, expect, it } from "vitest";

import {
  MATCH_WEIGHTS,
  accountKey,
  documentKey,
  matchKeysFor,
  nameKeys,
  normaliseDigits,
} from "@/lib/verification/match-keys";

/**
 * The keys that keep a removed provider out.
 *
 * These are not tests of a string function. The rule being protected is that
 * somebody removed from the platform for putting a customer at risk cannot
 * come back by buying a SIM card — and the only thing standing in the way is
 * whether the same human being, writing their own details a second time,
 * produces the same key.
 *
 * So the cases are written as the same person twice, the way the two forms
 * actually differ: one in Nepali and one in English, one with the middle name
 * and one without, one with the separators the clerk used and one without.
 */

/** Two names are the same person if any key they produce is shared. */
function matches(a: string, b: string): boolean {
  const left = new Set(nameKeys(a));
  return nameKeys(b).some((key) => left.has(key));
}

describe("numerals written in either script are one number", () => {
  it("reads Devanagari digits as their value", () => {
    expect(normaliseDigits("१२३४५६७८९०")).toBe("1234567890");
  });

  it("leaves Latin digits alone and keeps everything else", () => {
    expect(normaliseDigits("12-34/56")).toBe("12-34/56");
  });

  it("makes a citizenship number written in Nepali match the same one in English", () => {
    // The case that matters: a form filled in Nepali and a form filled in
    // English, by one person, for one certificate.
    expect(documentKey("१२-०१-७०-०१२३४")).toBe(documentKey("12-01-70-01234"));
  });
});

describe("a document number survives whichever separators the clerk used", () => {
  it("ignores dashes, slashes, dots and spaces", () => {
    const canonical = documentKey("12-01-70-01234");
    expect(documentKey("12/01/70/01234")).toBe(canonical);
    expect(documentKey("12 01 70 01234")).toBe(canonical);
    expect(documentKey("12.01.70.01234")).toBe(canonical);
    expect(documentKey("120170 01234")).toBe(canonical);
  });

  it("keeps letters, because a licence number has them", () => {
    expect(documentKey("ba-14-pa-2233")).toBe("BA14PA2233");
  });

  it("returns nothing for a blank field rather than a key everybody shares", () => {
    // The bug this prevents: a stored empty key matches every other applicant
    // who left the same field blank, which turns the duplicate check into a
    // machine for flagging honest people.
    expect(documentKey("   ")).toBe("");
    expect(documentKey("--/--")).toBe("");
  });
});

describe("the wallet the money arrives in", () => {
  it("treats an eSewa number with and without the country code as one account", () => {
    expect(accountKey("+977 9801234567")).toBe("9801234567");
    expect(accountKey("9801234567")).toBe("9801234567");
    expect(accountKey("977-9801234567")).toBe("9801234567");
  });

  it("leaves a bank account whole", () => {
    // Longer than a mobile number and not a country code, so nothing is
    // stripped: a bank account beginning 977 is a real possibility.
    expect(accountKey("0123 4567 8901 2345")).toBe("0123456789012345");
  });

  it("reads a Devanagari account number", () => {
    expect(accountKey("९८०१२३४५६७")).toBe("9801234567");
  });
});

describe("the same person, written three ways", () => {
  it("matches Shyam, Syam and श्याम", () => {
    // The example the whole file exists for.
    expect(matches("Shyam Shrestha", "Syam Shrestha")).toBe(true);
    expect(matches("Shyam Shrestha", "श्याम श्रेष्ठ")).toBe(true);
  });

  it("matches Bishnu and Vishnu", () => {
    // व folding to B with the labials is one line in the map and this is what
    // it buys.
    expect(matches("Bishnu Thapa", "Vishnu Thapa")).toBe(true);
    expect(matches("Bikash Gurung", "Vikash Gurung")).toBe(true);
  });

  it("matches across aspiration, which is a spelling habit rather than a sound", () => {
    expect(matches("Ram Bahadur Thapa", "Ram Bahadur Tapa")).toBe(true);
    expect(matches("Prakash Adhikari", "Prakas Adikari")).toBe(true);
  });

  it("matches a long vowel written either way", () => {
    expect(matches("Rita Maharjan", "Reeta Maharjan")).toBe(true);
    expect(matches("Sita Karki", "Seeta Karki")).toBe(true);
    expect(matches("Sunita Rai", "Suneeta Rai")).toBe(true);
  });

  it("matches a whole Nepali name against its Devanagari original", () => {
    expect(matches("Ram Bahadur Thapa", "राम बहादुर थापा")).toBe(true);
    expect(matches("Krishna Prasad", "कृष्ण प्रसाद")).toBe(true);
  });

  it("matches when the middle name is dropped", () => {
    // Middle names get dropped, added and abbreviated constantly, which is
    // why there are two keys rather than one.
    expect(matches("Shyam Kumar Shrestha", "Shyam Shrestha")).toBe(true);
    expect(matches("Ram Bahadur Thapa", "Ram Thapa")).toBe(true);
  });

  it("matches when the name is written in a different order", () => {
    expect(matches("Thapa Ram Bahadur", "Ram Bahadur Thapa")).toBe(true);
  });
});

describe("two different people stay two different people", () => {
  it("does not match unrelated names", () => {
    expect(matches("Ram Thapa", "Sita Gurung")).toBe(false);
    expect(matches("Krishna Shrestha", "Bimala Maharjan")).toBe(false);
  });

  it("keeps the first vowel, so Ram and Rima are not one person", () => {
    // Dropping every vowel would collapse these. Keeping every vowel would
    // split Rita from Reeta. The first vowel is the line between the two
    // failures.
    expect(matches("Ram Thapa", "Rim Thapa")).toBe(false);
    expect(matches("Ram Thapa", "Rum Thapa")).toBe(false);
  });

  it("keeps surnames apart", () => {
    expect(matches("Ram Thapa", "Ram Gurung")).toBe(false);
  });

  it("produces no key at all for a name with no letters", () => {
    expect(nameKeys("   ")).toEqual([]);
    expect(nameKeys("123")).toEqual([]);
  });
});

describe("the whole key set for one application", () => {
  const input = {
    documentNumbers: ["12-01-70-01234", ""],
    accounts: ["+977 9801234567"],
    fullName: "Shyam Kumar Shrestha",
    areaKeys: ["Lalitpur-4"],
    deviceFingerprint: "fp_abc",
  };

  it("carries a key of every kind that had a value", () => {
    const kinds = new Set(matchKeysFor(input).map((key) => key.kind));
    expect(kinds).toEqual(
      new Set(["document", "account", "name", "area", "device"]),
    );
  });

  it("drops the empty document number rather than storing a shared key", () => {
    const documents = matchKeysFor(input).filter((k) => k.kind === "document");
    expect(documents).toHaveLength(1);
    expect(documents[0].value).toBe("120170 01234".replace(/\s/g, ""));
  });

  it("canonicalises the ward so a capital letter is not a different place", () => {
    const area = matchKeysFor(input).find((key) => key.kind === "area");
    expect(area?.value).toBe("lalitpur-4");
  });

  it("never repeats a key", () => {
    const twice = matchKeysFor({
      ...input,
      documentNumbers: ["12-01-70-01234", "12/01/70/01234"],
    });
    const ids = twice.map((key) => `${key.kind}:${key.value}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("produces nothing at all from an empty application", () => {
    expect(matchKeysFor({})).toEqual([]);
  });

  it("catches the re-registration this file exists for", () => {
    /*
     * A provider removed for cause comes back: new phone, new email, name
     * spelled the way the other document spells it. Everything they could
     * cheaply change, they changed. The citizenship number and the wallet are
     * what they could not.
     */
    const removed = matchKeysFor({
      documentNumbers: ["12-01-70-01234"],
      accounts: ["9801234567"],
      fullName: "Shyam Kumar Shrestha",
    });
    const returning = matchKeysFor({
      documentNumbers: ["१२०१७००१२३४"],
      accounts: ["+977 9801234567"],
      fullName: "Syam Shrestha",
    });

    const before = new Set(removed.map((k) => `${k.kind}:${k.value}`));
    const hits = returning.filter((k) => before.has(`${k.kind}:${k.value}`));

    expect(hits.map((k) => k.kind).sort()).toEqual([
      "account",
      "document",
      "name",
    ]);
  });
});

describe("how loudly each kind of hit speaks", () => {
  it("ranks by how expensive the identifier is to change", () => {
    // A phone number costs a SIM. A citizenship number costs a forgery.
    expect(MATCH_WEIGHTS.document).toBeGreaterThan(MATCH_WEIGHTS.account);
    expect(MATCH_WEIGHTS.account).toBeGreaterThan(MATCH_WEIGHTS.name);
    expect(MATCH_WEIGHTS.name).toBeGreaterThan(MATCH_WEIGHTS.area);
  });

  it("makes a shared ward too weak to carry a flag on its own", () => {
    // Kathmandu wards hold tens of thousands of people and plumbers cluster
    // where the work is. It corroborates; it never accuses.
    expect(MATCH_WEIGHTS.area).toBeLessThan(MATCH_WEIGHTS.document / 10);
  });
});
