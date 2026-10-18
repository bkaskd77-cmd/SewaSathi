import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `pricing_note` explains a price to US, and must not reach a browser.
 *
 * WHAT THIS IS ACTUALLY GUARDING. Both band writers in `lib/data/bands.ts` put
 * text an admin typed into `categories.pricing_note` — the computed path appends
 * the approval's reason, and the stated path deliberately does not, writing a
 * provenance line instead. `lib/data/categories.ts` maps that column onto the
 * `Category` object that EVERY public surface reads: the landing grid,
 * `/services`, each category page. Nothing renders it to a customer today, and
 * the only reason it stays out of the page source is that the booking flow takes
 * a narrow `CategoryOption` projection rather than the whole row.
 *
 * SO THE INVARIANT IS THE PROJECTION, AND A COMMENT CLAIMING IT IS NOT ENOUGH.
 * `lib/data/bands.ts` says in writing that the projection is what keeps the note
 * private; a sentence describing behaviour nothing enforces is the failure this
 * repository keeps recording. One widening of `CategoryOption` — a reasonable
 * change, made for an unrelated reason — puts an internal note about a price into
 * the RSC payload of the booking page, where it is readable by anybody, and
 * nothing would fail.
 *
 * READ THROUGH THE TYPESCRIPT AST, NEVER A REGEX, which is `check:keys`' rule and
 * the same reason: a grep for the word would be defeated by a rename and would
 * also match the comment that warns about it.
 *
 * IT IS THE BOUNDARY RATHER THAN A LIST OF SCREENS. Server Components may read
 * the whole `Category` freely — they run on the server and render what they
 * choose. What crosses into the bundle is one type, so that is what is pinned.
 */

/** Fields that exist on `Category` and have no business crossing to a browser. */
const PRIVATE_TO_US = ["pricingNote", "pricingCheckedAt", "pricingConfidence"];

const BOUNDARY = "components/booking/step-problem.tsx";
const TYPE = "CategoryOption";

function members(path: string, typeName: string): string[] {
  const file = fileURLToPath(new URL(`../../${path}`, import.meta.url));
  const source = ts.createSourceFile(
    path,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  const out: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (statement.name.text !== typeName) continue;
    if (!ts.isTypeLiteralNode(statement.type)) continue;
    for (const member of statement.type.members) {
      if (member.name && ts.isIdentifier(member.name)) out.push(member.name.text);
    }
  }
  return out;
}

describe("the price provenance columns stay on the server", () => {
  const fields = members(BOUNDARY, TYPE);

  it("finds the projection at all", () => {
    /* The check that stops every assertion below passing over an empty list,
       which is how a type that was renamed or moved reads as a clean result. */
    expect(fields.length).toBeGreaterThan(3);
    expect(fields).toContain("slug");
    expect(fields).toContain("priceMin");
  });

  it("does not carry a note an admin typed about a price", () => {
    for (const field of PRIVATE_TO_US) {
      expect(
        fields,
        `${TYPE} would ship ${field} to the browser. ` +
          "pricing_note holds free text an admin typed when moving a band; the " +
          "reason for a band change lives in category_price_revisions and in " +
          "security_events, both admin-only, and belongs nowhere else.",
      ).not.toContain(field);
    }
  });

  it("still bites when the whole row is handed over", () => {
    /* A scanner that has quietly stopped scanning and a clean tree print the
       same tick, which is `check:secrets`' rule. This runs the real analysis
       over a widened copy of the type. */
    const source = ts.createSourceFile(
      "fake.tsx",
      `export type CategoryOption = {
         slug: string;
         label: string;
         priceMin: number | null;
         priceMax: number | null;
         pricingNote: string | null;
       };`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const widened: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isTypeAliasDeclaration(statement)) continue;
      if (!ts.isTypeLiteralNode(statement.type)) continue;
      for (const member of statement.type.members) {
        if (member.name && ts.isIdentifier(member.name)) {
          widened.push(member.name.text);
        }
      }
    }
    expect(widened).toContain("pricingNote");
  });
});
