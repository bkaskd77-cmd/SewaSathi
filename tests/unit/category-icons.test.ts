import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import categorySeed from "../../lib/data/seed/categories.json";
import { CATEGORY_ICONS, categoryIcon, isCategoryIcon } from "@/lib/config/icons";

/**
 * The icons a card can draw, agreed in four places.
 *
 * THE OFFERED SET IS THE STORABLE SET IS THE RENDERABLE SET. A picker offering a name
 * the check constraint rejects loses the whole edit in the statement that saves it; a
 * constraint allowing a name lucide does not export renders a blank tile on the grid
 * that is the first thing a customer sees; and a name with no entry in the component map
 * renders the WRONG icon, which is the one of the three that nothing used to catch.
 *
 * This file exists because `lib/config/icons.ts` and the migration both named it while
 * the assertions lived in `content-tiers.test.ts` — two comments pointing a reader at a
 * file that was not there.
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
   * THE ONE THAT WAS MISSING. Twenty names were offered and storable while
   * `lib/config/services.ts` mapped ten of them to components with `?? Wrench` behind
   * it, so picking any spare saved cleanly, passed the constraint, and drew a wrench on
   * the customer's grid. The map is the list now, which makes this unrepresentable
   * rather than merely tested — and the case stays, because the next person to add a
   * `?? fallback` beside a picker should find out here.
   */
  it("each render their own component, not the fallback", () => {
    const wrench = categoryIcon("Wrench");
    const drawingTheFallback = CATEGORY_ICONS.filter(
      (name) => name !== "Wrench" && categoryIcon(name) === wrench,
    );
    expect(drawingTheFallback, "these would draw a wrench").toEqual([]);
  });

  /*
   * THE CONSTRAINT IS WRITTEN FROM THE LIST, and this is what catches the drift. The
   * first version of that constraint was written from the seed file's opening rows with
   * the rest guessed, and Postgres refused it because `ac-servicing` is `AirVent` and
   * had been guessed as `Wind`. This fails before a migration reaches a database.
   */
  it("are all named in the check constraint", () => {
    const clause = MIGRATION.slice(MIGRATION.indexOf("categories_icon_known check"));
    const allowed = Array.from(
      clause.slice(0, clause.indexOf("));")).matchAll(/'([A-Za-z]+)'/g),
    ).map((m) => m[1]);
    expect([...CATEGORY_ICONS].sort()).toEqual([...allowed].sort());
  });

  /*
   * AND THE ROWS THAT EXIST ARE PICKABLE. The seed is what a fresh clone renders and
   * what every read falls back to, so an icon in it that the picker does not offer would
   * mean opening the editor on that category and being unable to save it without
   * changing its icon.
   */
  it("cover every category the seed authors", () => {
    const unoffered = (categorySeed as Array<{ slug: string; icon: string }>)
      .filter((c) => !isCategoryIcon(c.icon))
      .map((c) => `${c.slug}:${c.icon}`);
    expect(unoffered).toEqual([]);
  });

  it("recognises its own members and nothing else", () => {
    expect(isCategoryIcon("AirVent")).toBe(true);
    expect(isCategoryIcon("NotAnIcon")).toBe(false);
  });
});
