import { describe, expect, it } from "vitest";

import { BLOCKING_TIERS, REVIEW_SCOPE } from "../../scripts/ne-review-scope.mjs";
import { isEditable, keepsHistory, tierFor } from "@/lib/content/tiers";

/**
 * One rule for what a string is worth, read from one place.
 *
 * `scripts/ne-review-scope.mjs` already decides which namespaces carry money, safety or
 * legal weight — it is what holds the Nepali native-read backlog — and the content
 * editor needs the same answer to decide which edits keep a revision. These cases exist
 * because an import is only as good as the shape on the other side: the script is an
 * `.mjs` module with no type checking across the boundary, so a renamed field would
 * fail here rather than silently making every key `none`.
 */
describe("a key's tier comes from the review scope", () => {
  it("reads the tiers the scope actually declares", () => {
    expect(tierFor("booking.payment.title")).toBe("money");
    expect(tierFor("safety.gasLeak")).toBe("safety");
    expect(tierFor("legal.termsTitle")).toBe("legal");
    expect(tierFor("admin.payouts.title")).toBe("staff");
  });

  /*
   * `none` IS A REAL ANSWER. Most of the catalogue is ordinary interface copy that
   * blocks no launch and needs no revision trail. Returning `staff` for it would widen
   * the blocking backlog by accident; returning `money` would make every edit keep
   * history for nothing.
   */
  it("gives an unclaimed key no tier rather than a default one", () => {
    expect(tierFor("nav.services")).toBe("none");
    expect(tierFor("common.from")).toBe("none");
  });

  /*
   * LONGEST PREFIX WINS. `booking.detail.cancel` is money and `booking.flow.review` is
   * money, while the rest of `booking.*` is unclaimed — so a shorter rule must not
   * swallow a longer one. The scope script relies on its list being authored in order;
   * this is asked one key at a time and cannot.
   */
  it("prefers the most specific rule", () => {
    const money = REVIEW_SCOPE.filter((r) => r.tier === "money").map((r) => r.prefix);
    expect(money).toContain("booking.detail.cancel");
    expect(tierFor("booking.detail.cancel.title")).toBe("money");
  });

  it("keeps history for exactly the tiers that block a launch", () => {
    for (const tier of BLOCKING_TIERS) {
      expect(keepsHistory(tier)).toBe(true);
    }
    expect(keepsHistory("staff")).toBe(false);
    expect(keepsHistory("none")).toBe(false);
  });

  /*
   * THE ONE EXCLUSION, asserted because it is the difference between an admin breaking
   * a customer's screen and an admin breaking the button they would need to fix it.
   */
  it("refuses admin strings and allows everything else", () => {
    expect(isEditable("admin.content.save")).toBe(false);
    expect(isEditable("admin.payouts.title")).toBe(false);
    expect(isEditable("home.lead")).toBe(true);
    expect(isEditable("provider.money.balance")).toBe(true);
  });
});
