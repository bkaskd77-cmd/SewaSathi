import { describe, expect, it } from "vitest";

import providerSeed from "@/lib/data/seed/providers.json";
import reviewSeed from "@/lib/data/seed/reviews.json";
import categorySeed from "@/lib/data/seed/categories.json";
import en from "@/messages/en.json";
import ne from "@/messages/ne.json";

/**
 * The fallback cannot serve an invented professional, because there are none.
 *
 * THE HOLE THIS CLOSES, and it was found by asking the right question rather
 * than by a failure. Deleting the 28 fixtures from the database was not enough:
 * `lib/data/providers.ts` imports `seed/providers.json` and renders it whenever
 * Supabase is unconfigured, unreachable, **or the query errors**. So every one
 * of the 28 invented professionals — with their invented ratings, job counts
 * and 94 written reviews — would have come straight back onto a public page on
 * any database hiccup, after we had deleted them.
 *
 * The seed is empty now. The cost is deliberate and recorded: a fresh clone
 * with no keys renders an empty catalogue rather than a populated one.
 * `categories.json` is untouched — the ten services are real.
 */

describe("the seed cannot put fixtures back on the page", () => {
  it("holds no providers and no reviews", () => {
    expect(providerSeed).toEqual([]);
    expect(reviewSeed).toEqual([]);
  });

  /*
   * AND THE CATEGORIES SURVIVE, because emptying the wrong file would take the
   * ten real services down with the invented people and the page would have
   * nothing at all on it.
   */
  it("keeps the ten real categories", () => {
    expect(categorySeed.length).toBe(10);
  });
});

/**
 * An empty grid and a failed read are different facts.
 */
describe("a read that failed does not read as a product with nobody in it", () => {
  /*
   * THE COPY IS THE POINT. Before the seed was emptied a failed read rendered
   * 28 fixtures, so this screen could not happen; now it can, and "no
   * professionals match your filters — search the whole valley" would be a lie
   * that also wastes the visitor's time. The screen says the fault is ours.
   */
  it("has copy that blames us, in both languages", () => {
    for (const cat of [en, ne]) {
      expect(cat.services.unreadableTitle).toBeTruthy();
      expect(cat.services.unreadableBody).toBeTruthy();
      expect(cat.services.tryAgain).toBeTruthy();
    }
    // Not the filter copy: a different sentence, or the branch is pointless.
    expect(en.services.unreadableTitle).not.toBe(en.services.emptyFiltersTitle);
    expect(ne.services.unreadableTitle).not.toBe(ne.services.emptyFiltersTitle);
  });

  it("does not tell somebody to widen a search we could not run", () => {
    expect(en.services.unreadableBody.toLowerCase()).not.toContain("valley");
    expect(en.services.unreadableBody.toLowerCase()).toMatch(/us|our end/);
  });
});
