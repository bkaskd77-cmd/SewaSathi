import { describe, expect, it } from "vitest";

import { changedLines, diffCount, diffLines } from "@/lib/content/diff";
import { LEGAL_DOCUMENTS } from "@/lib/content/legal";
import { documentLines } from "@/lib/content/prose-text";

/**
 * What a publish would change, shown before it happens.
 *
 * A document version is append-only and `bookings.terms_version` points at the one a
 * customer agreed to, so publishing cannot be undone — only superseded. A confirmation
 * box is not a safeguard against that; seeing the change is.
 */
describe("the publish diff", () => {
  it("says nothing changed when nothing changed", () => {
    const lines = documentLines(LEGAL_DOCUMENTS.refunds.en);
    const diff = diffLines(lines, lines);
    expect(diff.every((l) => l.kind === "same")).toBe(true);
    // Empty, so the screen can say "nothing would change" rather than render a blank box.
    expect(changedLines(diff)).toEqual([]);
    expect(diffCount(diff)).toEqual({ added: 0, removed: 0 });
  });

  it("shows a reworded line as a removal and an addition, not a replaced document", () => {
    const before = ["one", "two", "three"];
    const after = ["one", "two and a half", "three"];
    const diff = diffLines(before, after);

    expect(diff).toEqual([
      { kind: "same", text: "one" },
      { kind: "removed", text: "two" },
      { kind: "added", text: "two and a half" },
      { kind: "same", text: "three" },
    ]);
    expect(diffCount(diff)).toEqual({ added: 1, removed: 1 });
  });

  it("keeps an inserted line without reporting the rest as changed", () => {
    const diff = diffLines(["a", "b"], ["a", "new", "b"]);
    expect(diffCount(diff)).toEqual({ added: 1, removed: 0 });
  });

  it("handles a document going from nothing and to nothing", () => {
    expect(diffCount(diffLines([], ["a", "b"]))).toEqual({ added: 2, removed: 0 });
    expect(diffCount(diffLines(["a", "b"], []))).toEqual({ added: 0, removed: 2 });
  });

  /*
   * THE REAL SHAPE: one sentence changed inside a real legal document. A diff that
   * reported four hundred lines for a one-word fix would be a screen nobody reads, and a
   * screen nobody reads is the same safeguard as no screen.
   */
  it("narrows a four-hundred-line document to the part that moved", () => {
    const doc = LEGAL_DOCUMENTS.terms.en;
    const before = documentLines(doc);
    const after = [...before];
    const at = after.findIndex((line) => line.length > 80);
    after[at] = `${after[at]} One more sentence.`;

    const shown = changedLines(diffLines(before, after));
    expect(diffCount(diffLines(before, after))).toEqual({ added: 1, removed: 1 });
    // Two changed lines plus a line of context either side.
    expect(shown.length).toBeLessThanOrEqual(4);
    expect(shown.some((l) => l.kind === "added")).toBe(true);
  });
});
