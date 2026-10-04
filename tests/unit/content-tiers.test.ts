import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BLOCKING_TIERS, REVIEW_SCOPE } from "../../scripts/ne-review-scope.mjs";
import { CATEGORY_ICONS, isCategoryIcon } from "@/lib/config/icons";
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

/**
 * The icons a card can draw, agreed in three places.
 *
 * THE OFFERED SET IS THE STORABLE SET IS THE RENDERABLE SET. A picker offering a name
 * the check constraint rejects loses the whole edit in the statement that saves it; a
 * constraint allowing a name lucide does not export renders a blank tile on the grid
 * that is the first thing a customer sees. Both have to agree with the list, and the
 * list has to be real.
 */
describe("category icons", () => {
  const MIGRATION = readFileSync(
    "supabase/migrations/20261004000003_content_admin.sql",
    "utf8",
  );

  it("are every one a real lucide export", async () => {
    const lucide = (await import("lucide-react")) as Record<string, unknown>;
    const missing = CATEGORY_ICONS.filter((name) => !(name in lucide));
    expect(missing, "these would render a blank card").toEqual([]);
  });

  /*
   * THE CONSTRAINT IS WRITTEN FROM THE LIST, and this is what catches the drift. The
   * first version of that constraint was written from the seed file's opening rows with
   * the rest guessed, and Postgres refused it because `ac-servicing` is `AirVent` and
   * had been guessed as `Wind`. This fails before a migration reaches a database.
   */
  it("are all named in the check constraint", () => {
    const clause = MIGRATION.slice(MIGRATION.indexOf("categories_icon_known check"));
    const allowed = Array.from(clause.slice(0, clause.indexOf("));")).matchAll(/'([A-Za-z]+)'/g)).map(
      (m) => m[1],
    );
    expect([...CATEGORY_ICONS].sort()).toEqual([...allowed].sort());
  });

  it("recognises its own members and nothing else", () => {
    expect(isCategoryIcon("AirVent")).toBe(true);
    expect(isCategoryIcon("NotAnIcon")).toBe(false);
  });
});
