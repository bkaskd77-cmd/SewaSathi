import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A failed catalogue read must not serve the seed's price band.
 *
 * WHAT THIS IS GUARDING AND WHY IT IS A SOURCE TEST. `getCategories` reaches the
 * seed from four places: no Supabase keys, a query error, zero rows, and a throw.
 * Only the FIRST may serve the band — with no keys the seed IS the data and there
 * is no published band for it to disagree with. The other three are failures, and
 * `/admin/bands` moves a published band in the TABLE and never in the seed, so
 * what they used to serve was a figure that could be months out of date: on the
 * landing grid, on `/services`, on every category page, and inside
 * `createBooking`, where it is frozen as `quoted_max` and becomes the ceiling
 * `judgeFinalAmount` measures a 2x overcharge against.
 *
 * THE BEHAVIOUR CANNOT BE REACHED FROM A UNIT TEST. `getCategories` is wrapped in
 * React's `cache()` and builds a Supabase client; there is no seam to fail a
 * query through without mocking the client, and a mock of the client is a test of
 * the mock. What IS reachable is the arrangement — and the arrangement is the
 * thing that regresses, because the failure mode is somebody adding a fifth
 * fallback branch and reaching for the seed because that is what the others did.
 *
 * READ THROUGH THE TYPESCRIPT AST, NEVER A REGEX, which is `check:keys`' rule:
 * a text search for `CATEGORY_SEED` matches the import, the comments and the
 * blanking helper, and a checker that reports things that are fine gets skimmed.
 */

const FILE = "lib/data/categories.ts";
const SEED = "CATEGORY_SEED";
const BLANKED = "unreadableCatalogue";

/** Every `return <expr>` in the file, as source text, with its guard context. */
function seedReturns(text: string): { expr: string; underConfigGuard: boolean }[] {
  const source = ts.createSourceFile(
    FILE,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const out: { expr: string; underConfigGuard: boolean }[] = [];

  function visit(node: ts.Node) {
    if (ts.isReturnStatement(node) && node.expression) {
      const expr = node.expression.getText(source);
      /* A bare `return CATEGORY_SEED` — never `withoutBand(CATEGORY_SEED)` and
         never a property access that happens to mention it. */
      if (expr === SEED) {
        out.push({ expr, underConfigGuard: hasConfigGuard(node) });
      }
    }
    ts.forEachChild(node, visit);
  }

  /*
   * Walk up to the enclosing `if` and ask whether its condition is the
   * unconfigured check. That is the one branch allowed to serve the band, and
   * asking about the GUARD rather than the line number is what survives the file
   * being reordered.
   */
  function hasConfigGuard(node: ts.Node): boolean {
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
      if (ts.isIfStatement(at)) {
        if (at.expression.getText(source).includes("hasSupabaseConfig")) {
          return true;
        }
      }
    }
    return false;
  }

  visit(source);
  return out;
}

const text = readFileSync(
  fileURLToPath(new URL(`../../${FILE}`, import.meta.url)),
  "utf8",
);

describe("the catalogue fallback never publishes a price it cannot vouch for", () => {
  it("serves the seed's band from exactly one place", () => {
    const returns = seedReturns(text);
    expect(
      returns.length,
      "every `return CATEGORY_SEED` in lib/data/categories.ts, which must be " +
        "the unconfigured branch alone",
    ).toBe(1);
  });

  it("and that place is the unconfigured branch, not a failure", () => {
    for (const found of seedReturns(text)) {
      expect(
        found.underConfigGuard,
        "a `return CATEGORY_SEED` outside the `hasSupabaseConfig()` branch. A " +
          "FAILED read must return " +
          `${BLANKED}(…) — the seed's band may be months behind the table, and ` +
          "createBooking freezes it as quoted_max.",
      ).toBe(true);
    }
  });

  it("routes every failure through the one blanking helper", () => {
    /* Three failure branches — query error, zero rows, throw — and the count is
       asserted so a regex that stopped matching cannot make this pass over an
       empty list. */
    const calls = text.match(new RegExp(`return ${BLANKED}\\(`, "g")) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("still bites when a failure branch reaches for the seed", () => {
    /* A scanner that has quietly stopped scanning and a clean file print the
       same tick, which is `check:secrets`' rule. This runs the real analysis
       over a file shaped like the regression. */
    const regressed = `
      export const getCategories = cache(async () => {
        if (!hasSupabaseConfig()) {
          return CATEGORY_SEED;
        }
        try {
          const { data, error } = await read();
          if (error) {
            return CATEGORY_SEED;
          }
          return data.map(fromRow);
        } catch {
          return unreadableCatalogue("threw");
        }
      });
    `;
    const found = seedReturns(regressed);
    expect(found).toHaveLength(2);
    expect(found.filter((f) => !f.underConfigGuard)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * What the customer actually sees
 * ------------------------------------------------------------------ */

const BOOK = "app/[locale]/(app)/book/page.tsx";
const bookText = readFileSync(
  fileURLToPath(new URL(`../../${BOOK}`, import.meta.url)),
  "utf8",
);

/** The statements inside the `bandsUnreadable` branch, as source text. */
function unreadableBranch(text: string): string {
  const source = ts.createSourceFile(
    BOOK,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  let found = "";
  function visit(node: ts.Node) {
    if (
      ts.isIfStatement(node) &&
      node.expression.getText(source).includes("bandsUnreadable")
    ) {
      found = node.thenStatement.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

describe("/book declines with a screen, never a blank or an error", () => {
  const branch = unreadableBranch(bookText);

  it("finds the branch at all", () => {
    /* Without this, every assertion below passes over an empty string — which
       is how a renamed condition reads as a clean result. */
    expect(branch.length, "the bandsUnreadable branch in /book").toBeGreaterThan(
      200,
    );
  });

  it("returns a rendered page rather than a 404 or a redirect", () => {
    /*
     * THE THREE WRONG ANSWERS, NAMED. `notFound()` tells the customer the page
     * does not exist, which is false and unactionable; `redirect()` bounces them
     * somewhere they did not ask for; and `throw` is Next's error boundary,
     * which on this route is a blank screen with "Something went wrong". All
     * three read as a broken product for what is a transient read failure on our
     * side — and the one thing the customer needs to know is that it is ours and
     * worth retrying.
     */
    expect(branch).toContain("return (");
    expect(branch).not.toContain("notFound(");
    expect(branch).not.toContain("redirect(");
    expect(branch).not.toContain("throw ");
  });

  it("says prices could not load, and says whose fault it is", () => {
    expect(branch).toContain('t("pricesUnreadable")');
    /* The heading stays, so the page still reads as the booking page it is
       rather than as a bare sentence on a white background. */
    expect(branch).toContain('t("title")');
  });

  it("offers something to press, because 'try again' with no button is a dead end", () => {
    /*
     * `components/shared/empty-state.tsx`'s standing rule, applied to a failure
     * rather than an absence. The retry carries the intent the customer arrived
     * with — category, professional, description — so trying again does not
     * start them over.
     */
    expect(branch).toContain('t("tryAgain")');
    expect(branch).toContain("/book?${back.toString()}");
    expect(branch).toContain('t("browseInstead")');
  });

  it("still bites if the branch becomes a 404", () => {
    /* The real analysis over a file shaped like the regression — a scanner that
       has quietly stopped scanning prints the same tick as a clean file. */
    const regressed = `
      export default async function BookPage() {
        const categories = await getCategories();
        const bandsUnreadable = categories.some((c) => true);
        if (bandsUnreadable) {
          notFound();
        }
        return <div />;
      }
    `;
    const found = unreadableBranch(regressed);
    expect(found).toContain("notFound(");
    expect(found).not.toContain("return (");
  });
});
