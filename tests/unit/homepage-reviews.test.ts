import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  HOMEPAGE_HIDE_CODES,
  HOMEPAGE_REVIEW_FLOOR,
  isHomepageHideCode,
  showsOnHomepage,
} from "@/lib/reviews";
import { contactKinds, containsContactDetails, foldDigits } from "@/lib/text";

/**
 * Which reviews reach the front page, and the one thing the mechanism must not
 * be able to do.
 *
 * THE CASES ARE WRITTEN AS BEHAVIOUR, NEVER AGAINST THE CONSTANTS, which is
 * `ACTIVITY_FLOOR`'s lesson and the reason its own floor tests were blind:
 * every case read the constant, so lowering the floor to 1 left them all green
 * — they asserted that the floor is the floor. What the constraint actually
 * says is that one lonely review is never the wall, and that is what is pinned.
 */

function review(over: Partial<Parameters<typeof showsOnHomepage>[0]> = {}) {
  return {
    publishedAt: "2026-10-01T00:00:00Z",
    comment: "He arrived within the hour and the leak stopped. Tidy work.",
    authorOptedOut: false,
    hiddenAt: null,
    ...over,
  };
}

describe("a one-star review is as eligible as a five-star one", () => {
  /*
   * THE STRUCTURAL HALF OF "NEVER HIDDEN FOR BEING NEGATIVE". A promise that
   * nobody will filter by rating is worth what the mechanism makes it worth,
   * and the mechanism here cannot express a rating at all — `showsOnHomepage`
   * is not given one. These cases are what make that a fact rather than a
   * reading of the source.
   */

  it("is not given a rating to judge, asserted on the rule's own source", () => {
    /*
     * A SOURCE READ, AND THE FIRST VERSION OF THIS CASE WAS BLIND. It compared
     * `Object.keys()` of the fixture in this file against a list in this file,
     * so adding `rating: number` to `HomepageCandidate` left it green — it
     * asserted that my fixture is my fixture. `ACTIVITY_FLOOR`'s class, found
     * the same way: by breaking the thing on purpose and watching nothing
     * happen.
     *
     * The rule module may not contain the word at all, which is the only
     * version of this that bites. Comments are stripped first — they name
     * `rating` repeatedly in order to say nothing reads it, and a scanner that
     * punished the warning would delete the warning
     * (`provider-money-one-source`'s rule).
     */
    const source = readFileSync("lib/reviews/homepage.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(
      /\brating\b/i.test(source),
      "lib/reviews/homepage.ts reads a rating. The next line somebody writes " +
        "after that is `if (rating < 4)`.",
    ).toBe(false);
  });

  it("is not filtered or sorted by stars where the wall is read", () => {
    /*
     * The other end of the same rule. The read DOES select `rating` — the cards
     * show stars — so the ban here is on using it to choose or to order, which
     * is what would turn the wall into a claim nobody made.
     */
    const source = readFileSync("lib/data/activity.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    for (const pattern of [
      /\.order\(\s*"rating/,
      /\.(?:gte|lte|gt|lt|eq)\(\s*"rating/,
      /sort\([^)]*rating/,
    ]) {
      expect(
        pattern.test(source),
        `lib/data/activity.ts selects the wall by stars (${pattern}).`,
      ).toBe(false);
    }
  });

  it("has rules that still catch a rating being read", () => {
    // The scanner self-tests: a pattern that has quietly stopped matching reads
    // exactly like a module with nothing wrong in it.
    expect(/\brating\b/i.test("  rating: number;")).toBe(true);
    expect(/\.order\(\s*"rating/.test('.order("rating", { ascending: false })')).toBe(
      true,
    );
  });

  it("offers no hide code that could mean negative, disputed or unfair", () => {
    /*
     * `CUSTOMER_FLAGS`' rule one table over: a list that cannot express
     * retaliation is a stronger guarantee than a policy saying nobody will. The
     * forbidden words are spelled out rather than derived, because the point is
     * that somebody adding one has to delete this line to do it.
     */
    for (const forbidden of [
      "negative",
      "low",
      "unfair",
      "disputed",
      "rating",
      "stars",
      "price",
      "other",
    ]) {
      expect(
        HOMEPAGE_HIDE_CODES.some((code) => code.includes(forbidden)),
        `"${forbidden}" must never be a reason for hiding a review`,
      ).toBe(false);
    }

    expect(HOMEPAGE_HIDE_CODES).toEqual(["abusive", "irrelevant"]);
    expect(isHomepageHideCode("negative")).toBe(false);
  });
});

describe("four reasons a review is not on the homepage", () => {
  it("shows an ordinary published review", () => {
    expect(showsOnHomepage(review())).toEqual({ shows: true });
  });

  it("refuses one that has not published", () => {
    // Sealed is the author's alone, and `sealed()` is the rule — this never
    // second-guesses it, it only refuses to publish what has not published.
    expect(showsOnHomepage(review({ publishedAt: null }))).toEqual({
      shows: false,
      why: "notPublished",
    });
  });

  it("refuses one whose author opted out of the activity strip", () => {
    /*
     * ONE SWITCH COVERS BOTH SURFACES. Somebody who said "do not put my
     * finished jobs on your homepage" did not mean "but my words are fine" —
     * the review carries their first name, their city AND what they wrote,
     * which is strictly more than the strip does.
     */
    expect(showsOnHomepage(review({ authorOptedOut: true }))).toEqual({
      shows: false,
      why: "authorOptedOut",
    });
  });

  it("refuses one a person hid, and says it was a person", () => {
    expect(
      showsOnHomepage(review({ hiddenAt: "2026-10-02T00:00:00Z" })),
    ).toEqual({ shows: false, why: "hiddenByStaff" });
  });

  it("names the customer's own choice ahead of our judgement of their words", () => {
    // Both apply. The opt-out is reported, because a screen saying "contains a
    // phone number" about a review the customer asked us not to use would
    // describe our filter and hide their decision.
    const both = review({
      authorOptedOut: true,
      comment: "Call him on 9841234567, he is excellent",
    });
    expect(showsOnHomepage(both)).toEqual({
      shows: false,
      why: "authorOptedOut",
    });
  });

  it("names the staff decision last, so an accident never masks it", () => {
    /*
     * A review somebody deliberately hid that ALSO contains a phone number must
     * report the decision, not the accident. Reporting the contact rule would
     * put the one fact worth auditing behind one nobody chose.
     */
    const both = review({
      hiddenAt: "2026-10-02T00:00:00Z",
      comment: "Ring 9841234567",
    });
    expect(showsOnHomepage(both)).toEqual({ shows: false, why: "phone" });
  });
});

describe("one lonely review is never the wall", () => {
  /*
   * WRITTEN AS THE BEHAVIOUR, not as `floor - 1`. These numbers are literals on
   * purpose: if somebody drops the floor to 1, the first case goes red rather
   * than quietly agreeing with the new constant.
   */
  const eligible = (n: number) =>
    Array.from({ length: n }, () => review()).filter(
      (r) => showsOnHomepage(r).shows,
    ).length;

  it("needs more than a handful before it says anything", () => {
    expect(eligible(1)).toBeLessThan(HOMEPAGE_REVIEW_FLOOR);
    expect(eligible(2)).toBeLessThan(HOMEPAGE_REVIEW_FLOOR);
    expect(eligible(7)).toBeLessThan(HOMEPAGE_REVIEW_FLOOR);
    expect(eligible(8)).toBeGreaterThanOrEqual(HOMEPAGE_REVIEW_FLOOR);
  });
});

describe("a contact detail is never shown publicly", () => {
  it("catches a Nepali mobile however it is written", () => {
    for (const text of [
      "call 9841234567",
      "9841 234 567 is his number",
      "+977 9841-234-567",
      "ring him on 98.41.23.45.67",
      "landline 4123456",
    ]) {
      expect(contactKinds(text), text).toContain("phone");
    }
  });

  it("catches a number typed in Devanagari digits", () => {
    /*
     * `\d` DOES NOT MATCH THESE, and a rule authored in ASCII would have been
     * blind to exactly the readers this product calls a first-class path.
     * `foldNepali`'s lesson one character class over.
     */
    expect(foldDigits("९८४१२३४५६७")).toBe("9841234567");
    expect(contactKinds("फोन ९८४१२३४५६७ मा")).toContain("phone");
  });

  it("catches an address and a link", () => {
    expect(contactKinds("mail me at ram@example.com")).toContain("email");
    expect(contactKinds("see https://ram.example/jobs")).toContain("link");
    expect(contactKinds("find him at www.rambuilders.np")).toContain("link");
    expect(contactKinds("rambuilders.com has his prices")).toContain("link");
  });

  it("leaves ordinary reviews alone, which is what stops it eating the wall", () => {
    /*
     * A RULE THAT CRIES WOLF GETS SWITCHED OFF — `check:keys`' lesson after
     * three regex attempts. Every line here is something a customer would
     * plausibly write, and all four defeated an earlier draft of one of the
     * patterns: prices with commas, a slashed date, a full stop with no space
     * after it, and a time.
     */
    for (const text of [
      "Paid Rs 1,500 and Rs 2,000 for parts, all fair.",
      "He came on 12/10/2026 and finished the same day.",
      "He fixed the tap.Thanks for the quick response.",
      "Arrived at 5.30pm, done by 7pm.",
      "Took 2 hours 30 minutes, cost 1500.",
    ]) {
      expect(containsContactDetails(text), text).toBe(false);
    }
  });

  it("errs toward hiding where the two errors are not symmetric", () => {
    /*
     * A spaced-out date reads as a seven-digit run and is hidden. Stated as a
     * deliberate cost rather than left as a surprise: a false negative puts a
     * real phone number on a public page, where a false positive costs one
     * testimonial out of a wall that needs eight — and the review is still on
     * the professional's listing either way.
     */
    expect(containsContactDetails("he came on 12 10 2026")).toBe(true);
  });
});
