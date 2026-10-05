import { describe, expect, it } from "vitest";

import { LEGAL_DOCUMENTS } from "@/lib/content/legal";
import { INFO_PAGE_SLUGS, infoPage } from "@/lib/content/pages";
import {
  editableSections,
  parseBlocks,
  sectionsFromFields,
  serializeBlocks,
} from "@/lib/content/prose-text";
import type { Block, ProseDocument } from "@/lib/content/types";

/**
 * The format the document editor puts in front of a person.
 *
 * THE INVARIANT IS THE LOSSLESS ROUND TRIP, and it is written before the editor so the
 * format is proved against the real documents rather than against examples chosen to
 * suit it. If `parseBlocks(serializeBlocks(x))` is not `x` for every section of every
 * document in both languages, then publishing through the editor silently alters a
 * document — and the thing most likely to be lost is a `dl`, which is how the privacy
 * document carries its data tables and how the refunds document carries the guarantee
 * windows. A legal page quietly missing its table is exactly the failure nobody notices.
 */

function everyDocument(): Array<{ name: string; doc: ProseDocument }> {
  const out: Array<{ name: string; doc: ProseDocument }> = [];
  for (const locale of ["en", "ne"] as const) {
    for (const slug of Object.keys(LEGAL_DOCUMENTS) as Array<
      keyof typeof LEGAL_DOCUMENTS
    >) {
      out.push({ name: `${slug}.${locale}`, doc: LEGAL_DOCUMENTS[slug][locale] });
    }
    for (const slug of INFO_PAGE_SLUGS) {
      const doc = infoPage(slug, locale);
      if (doc) out.push({ name: `${slug}.${locale}`, doc });
    }
  }
  return out;
}

describe("the document text format", () => {
  const documents = everyDocument();

  it("covers every document in both languages", () => {
    // 3 legal + 5 info pages, twice. A document added without a locale would show here.
    expect(documents.length).toBe(16);
  });

  it("round-trips every section of every document", () => {
    const lost: string[] = [];
    for (const { name, doc } of documents) {
      for (const section of doc.sections) {
        const back = parseBlocks(serializeBlocks(section.blocks));
        if (!back.ok || JSON.stringify(back.blocks) !== JSON.stringify(section.blocks)) {
          lost.push(`${name}#${section.id}`);
        }
      }
    }
    expect(lost, "these sections would change on their first publish").toEqual([]);
  });

  /*
   * THE MARKERS HAVE TO BE ABSENT FROM THE PROSE, which is why they were chosen by
   * checking rather than by taste. A `::` in an existing sentence would turn that
   * paragraph into a term/detail table the moment somebody opened the editor and saved.
   */
  it("uses markers that appear in no document already", () => {
    const offenders: string[] = [];
    for (const { name, doc } of documents) {
      for (const section of doc.sections) {
        const text = serializeBlocks(section.blocks);
        for (const block of section.blocks) {
          if ("p" in block && (block.p.includes(" :: ") || block.p.startsWith("- "))) {
            offenders.push(`${name}#${section.id}`);
          }
        }
        if (text.includes("\n\n\n")) offenders.push(`${name}#${section.id} blank runs`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads a paragraph, a list and a table", () => {
    const text = [
      "An ordinary paragraph.",
      "",
      "- first",
      "- second",
      "",
      "Repairs :: 30 days.",
      "Painting :: 90 days.",
    ].join("\n");

    const parsed = parseBlocks(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.blocks).toEqual([
      { p: "An ordinary paragraph." },
      { ul: ["first", "second"] },
      {
        dl: [
          { term: "Repairs", detail: "30 days." },
          { term: "Painting", detail: "90 days." },
        ],
      },
    ] satisfies Block[]);
  });

  /* A paragraph somebody typed across two lines is one paragraph, which is what keeps the
     round trip lossless: a `p` always serialises back to a single line. */
  it("joins a paragraph wrapped over several lines", () => {
    const parsed = parseBlocks("one line\nand its continuation");
    expect(parsed.ok && parsed.blocks).toEqual([{ p: "one line and its continuation" }]);
  });

  /*
   * REFUSED, NEVER GUESSED AT. A chunk with one bullet and one plain line could be a
   * half-written list or a paragraph that happens to start with a dash, and picking one
   * on a document somebody agrees to is not a thing to do quietly.
   */
  it("refuses a chunk that mixes a list with prose", () => {
    const parsed = parseBlocks("Here is why:\n- because");
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toContain("blank line");
  });

  it("refuses a half-written table row", () => {
    const parsed = parseBlocks("Repairs :: ");
    expect(parsed.ok).toBe(false);
  });

  it("refuses two sections sharing an anchor", () => {
    const result = sectionsFromFields([
      { id: "same", heading: "One", body: "a" },
      { id: "same", heading: "Two", body: "b" },
    ]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("point at one");
  });

  it("refuses a section with no heading, and a document with no sections", () => {
    expect(sectionsFromFields([{ id: "x", heading: " ", body: "a" }]).ok).toBe(false);
    expect(sectionsFromFields([]).ok).toBe(false);
  });

  /* The editor's two directions, composed: what it shows and what it saves. */
  it("takes a real document out to fields and back unchanged", () => {
    const doc = LEGAL_DOCUMENTS.refunds.en;
    const result = sectionsFromFields(editableSections(doc));
    expect(result.ok).toBe(true);
    expect(result.ok && result.sections).toEqual(doc.sections);
  });
});
