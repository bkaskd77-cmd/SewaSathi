import { describe, expect, it } from "vitest";

/**
 * What a review card shows when the customer wrote nothing, and who it names.
 *
 * BOTH OF THESE SHIPPED AND WERE FOUND IN A SCREENSHOT, on the live profile
 * page, during the Phase 11 walkthrough — which is the walkthrough doing its
 * job and the test suite not doing its. Every fixture in the suite gave its
 * reviews an author and a comment, so nothing could see either.
 *
 *   1. `author` was `provider_reviews.author_name`, which `submitReview`
 *      writes as the EMPTY STRING on every real review — a public review is not
 *      a box somebody types a name into. So the name slot was blank on every
 *      real review on every listing, for ever.
 *   2. An empty `comment` rendered an empty paragraph, which reads as a card
 *      that failed to load.
 *
 * The rules are pure here because the card is a Server Component; what is
 * asserted is the DECISION each one makes, and the source guard below is what
 * stops the card going back to reading the column.
 */

import { readFileSync } from "node:fs";

import { hasWords } from "@/lib/reviews";

/** The card's rule: a name, or the words that stand in for one. */
function shownAuthor(author: string | null, fallback: string): string {
  return author ?? fallback;
}

/**
 * The card's rule: the words, or the sentence that says there were none.
 *
 * IT CALLS `hasWords` RATHER THAN RE-TRIMMING, and the reason is that the first
 * version of this file carried its own `comment.trim()` — so the test asserted
 * a copy of the rule and the surfaces were free to disagree with it, which they
 * did: `/admin/reviews` wrapped the comment in quotation marks unconditionally
 * and printed `“”` for every wordless rating, and this file was green
 * throughout. A test written against its own copy of the thing it is checking
 * is the class this repository keeps recording.
 */
function shownComment(comment: string, fallback: string): string {
  return hasWords(comment) ? comment : fallback;
}

describe("a review card never renders a blank", () => {
  it("names a customer who wrote nothing, rather than printing nothing", () => {
    expect(shownComment("", "Rated, no comment written.")).toBe(
      "Rated, no comment written.",
    );
    expect(shownComment("   \n ", "Rated, no comment written.")).toBe(
      "Rated, no comment written.",
    );
  });

  it("leaves a real comment exactly as written", () => {
    // Testimony is never reworded, trimmed to a preview or ellipsised.
    const words = "He came within the hour and the leak stopped.";
    expect(shownComment(words, "x")).toBe(words);
  });

  it("stands in for an unreadable name rather than showing an empty line", () => {
    expect(shownAuthor(null, "A customer")).toBe("A customer");
    expect(shownAuthor("Priya", "A customer")).toBe("Priya");
  });
});

describe("the listing keeps what the homepage refuses", () => {
  /*
   * THE TWO SURFACES DISAGREE ON PURPOSE AND THAT IS THE POINT. A wordless
   * review is refused by the homepage — `showsOnHomepage` returns `noWords`,
   * because the wall quotes people — and kept by the listing, because a rating
   * is testimony, it counts toward the average either way, and a review page
   * must not lose anything. If these two ever agree, one of them is wrong.
   */
  it("still counts a wordless review toward the figure", async () => {
    const { showsOnHomepage } = await import("@/lib/reviews");
    const wordless = {
      publishedAt: "2026-10-01T00:00:00Z",
      comment: "",
      authorOptedOut: false,
      hiddenAt: null,
    };

    expect(showsOnHomepage(wordless)).toEqual({ shows: false, why: "noWords" });
    // And the listing shows it, which is this file's other half.
    expect(shownComment(wordless.comment, "Rated, no comment written.")).not.toBe(
      "",
    );
  });
});

describe("the reviews read does not go back to the legacy name column", () => {
  const source = readFileSync("lib/data/providers.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("selects the customer's profile rather than author_name", () => {
    /*
     * A SOURCE GUARD, because the failure is silent: `author_name` is NOT NULL
     * and always present, so reading it returns a perfectly valid empty string
     * and every screen renders a blank. Nothing throws, nothing is missing, and
     * the only symptom is a gap on a page. Comments are stripped first — the
     * `Review` type names the column in order to warn about it.
     */
    expect(
      /author_name/.test(source),
      "lib/data/providers.ts reads author_name again. It is empty on every real review.",
    ).toBe(false);
    /*
     * THE QUALIFIED FORM, not the bare one this first pinned. `profiles` is
     * reachable from `provider_reviews` by three foreign keys, so an embed
     * without a constraint name is refused by PostgREST and the read fails —
     * which is how this fix's first version made the review disappear from the
     * live page entirely. `tests/db/embed-ambiguity.test.ts` derives that rule
     * from the schema for every table; this pins the one call site.
     */
    expect(source).toContain(
      "profiles!provider_reviews_customer_id_fkey(full_name)",
    );
  });

  it("has a rule that still catches the column coming back", () => {
    // The scanner self-tests: one that has stopped matching reads exactly like
    // a file with nothing wrong in it.
    expect(/author_name/.test('"id, author_name, rating"')).toBe(true);
  });
});

describe("no surface asks the wordless question on its own", () => {
  /*
   * THE SOURCE GUARD, because the failure is silent on every screen that gets
   * it wrong: an empty comment is a perfectly valid string, nothing throws, and
   * the only symptom is a pair of quotation marks with nothing between them on
   * the staff screen where somebody decides whether a review is abusive. Three
   * surfaces ask whether a customer wrote anything — the homepage wall refuses
   * such a review, the public listing keeps it and names it, and the admin
   * ledger has to tell those two facts apart — and they were each asking
   * separately.
   */
  const surfaces = [
    "lib/reviews/homepage.ts",
    "components/services/provider-reviews.tsx",
    "app/[locale]/(admin)/admin/reviews/page.tsx",
  ] as const;

  for (const file of surfaces) {
    it(`${file} asks hasWords rather than trimming its own copy`, () => {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      expect(
        source.includes("hasWords("),
        `${file} no longer calls hasWords. Three surfaces must not re-derive it.`,
      ).toBe(true);
      expect(
        /comment\.trim\(\)/.test(source),
        `${file} trims the comment itself. Call hasWords.`,
      ).toBe(false);
    });
  }

  it("has a rule that still catches a surface going back to trim()", () => {
    // The scanner self-tests: one that has stopped matching reads exactly like
    // a file with nothing wrong in it.
    expect(/comment\.trim\(\)/.test("if (review.comment.trim()) {")).toBe(true);
  });

  it("treats whitespace as nothing written", () => {
    expect(hasWords("")).toBe(false);
    expect(hasWords("   \n\t ")).toBe(false);
    expect(hasWords("ok")).toBe(true);
  });
});
