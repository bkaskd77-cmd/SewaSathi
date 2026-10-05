import type { Block, ProseDocument, Section } from "@/lib/content/types";

/**
 * A section's blocks as plain text, and back.
 *
 * WHY A FORMAT AT ALL. A `ProseDocument` is structured — paragraphs, bulleted lists and
 * term/detail tables — and the editing screen has to put it in front of somebody who is
 * not going to edit JSON. A field per block was the alternative: a textarea for every
 * paragraph, paired inputs for every row of a table, and add/remove/reorder controls, on
 * documents that run to twelve sections. That is the largest screen in the admin panel
 * and most of it is chrome. One textarea per section, in a format somebody can type, is
 * the smaller thing that does the same job.
 *
 * THE TWO MARKERS WERE CHOSEN BY CHECKING, NOT BY TASTE. A blank line separates blocks,
 * `- ` at the start of every line makes a list, and ` :: ` on every line makes a
 * term/detail table. Neither marker occurs anywhere in `lib/content/` today, which
 * `tests/unit/prose-text.test.ts` asserts, so the format cannot silently eat an existing
 * sentence. `::` rather than a colon for exactly that reason: a colon is ordinary prose.
 *
 * THE INVARIANT IS A LOSSLESS ROUND TRIP, asserted over all eight documents in both
 * languages before the editor existed. The privacy and refunds documents carry their
 * windows and their data tables as `dl` blocks, and a format that dropped those would
 * lose them on the first publish with nothing to notice — a legal page quietly missing
 * its table.
 *
 * A MALFORMED CHUNK IS REFUSED, NEVER REINTERPRETED. A chunk where only some lines start
 * with `- ` could be read as a paragraph beginning with a dash or as a half-written list,
 * and guessing on a document somebody agrees to is not a thing to do: the parse returns
 * the reason and names the chunk, and the screen shows it.
 */

const LIST = /^- /;
/** What a row is written with. */
const PAIR = " :: ";
/*
 * What a row is RECOGNISED by, which is the shorter half: lines are trimmed before they
 * are read, so `Repairs :: ` arrives as `Repairs ::` and looking for the full ` :: ` would
 * read a half-typed row as an ordinary paragraph instead of saying it is half-typed.
 */
const PAIR_MARK = " ::";

/** Blocks to text. Each block is one chunk; chunks are separated by a blank line. */
export function serializeBlocks(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if ("p" in block) return block.p;
      if ("ul" in block) return block.ul.map((item) => `- ${item}`).join("\n");
      return block.dl.map((row) => `${row.term}${PAIR}${row.detail}`).join("\n");
    })
    .join("\n\n");
}

export type ParseResult =
  | { ok: true; blocks: Block[] }
  | { ok: false; error: string };

/** Text to blocks, or the reason it could not be read. */
export function parseBlocks(text: string): ParseResult {
  const chunks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  const blocks: Block[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    const bullets = lines.filter((line) => LIST.test(line)).length;
    const pairs = lines.filter((line) => line.includes(PAIR_MARK)).length;
    const where = `"${lines[0].slice(0, 40)}…"`;

    if (bullets > 0 && bullets < lines.length) {
      return {
        ok: false,
        error: `${where} mixes list lines with ordinary ones. Put a blank line between the paragraph and the list.`,
      };
    }

    if (bullets === lines.length) {
      blocks.push({ ul: lines.map((line) => line.replace(LIST, "").trim()) });
      continue;
    }

    if (pairs > 0 && pairs < lines.length) {
      return {
        ok: false,
        error: `${where} mixes "::" lines with ordinary ones. Put a blank line between the paragraph and the table.`,
      };
    }

    if (pairs === lines.length) {
      const dl = lines.map((line) => {
        const at = line.indexOf(PAIR_MARK);
        return {
          term: line.slice(0, at).trim(),
          detail: line.slice(at + PAIR_MARK.length).trim(),
        };
      });
      if (dl.some((row) => row.term.length === 0 || row.detail.length === 0)) {
        return {
          ok: false,
          error: `${where} has a "::" line missing its term or its detail.`,
        };
      }
      blocks.push({ dl });
      continue;
    }

    // A paragraph typed across several lines is one paragraph. Joining here is what makes
    // the round trip lossless, because a `p` always serialises to a single line.
    blocks.push({ p: lines.join(" ") });
  }

  return { ok: true, blocks };
}

/**
 * A whole document as lines, for the diff.
 *
 * ONE DIRECTION ONLY, deliberately. This is never parsed back — the editor keeps the
 * title, the lead, the review-notice flag and each section's id and heading as their own
 * fields, so nothing has to read a heading out of a line of text. That frees this to be
 * as readable as a person comparing two versions needs, rather than as strict as a
 * parser needs.
 */
export function documentLines(doc: ProseDocument): string[] {
  const out = [doc.title, "", doc.lead, ""];
  if (doc.draft) out.push("[not reviewed by a lawyer]", "");
  for (const section of doc.sections) {
    out.push(`## ${section.heading}  (#${section.id})`, "");
    out.push(...serializeBlocks(section.blocks).split("\n"), "");
  }
  return out;
}

/** The sections of a document as editable text, in order. */
export function editableSections(
  doc: ProseDocument,
): Array<{ id: string; heading: string; body: string }> {
  return doc.sections.map((section) => ({
    id: section.id,
    heading: section.heading,
    body: serializeBlocks(section.blocks),
  }));
}

/** The reverse: fields back into sections, or the first reason one could not be read. */
export function sectionsFromFields(
  fields: Array<{ id: string; heading: string; body: string }>,
): { ok: true; sections: Section[] } | { ok: false; error: string } {
  const sections: Section[] = [];
  for (const field of fields) {
    const id = field.id.trim();
    const heading = field.heading.trim();
    if (id.length === 0 || heading.length === 0) {
      return { ok: false, error: `A section is missing its anchor or its heading.` };
    }
    const parsed = parseBlocks(field.body);
    if (!parsed.ok) return { ok: false, error: `${heading}: ${parsed.error}` };
    sections.push({ id, heading, blocks: parsed.blocks });
  }
  if (sections.length === 0) return { ok: false, error: "A document needs a section." };

  const ids = sections.map((s) => s.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) {
    return {
      ok: false,
      error: `Two sections share the anchor "${duplicate}". A link can only point at one of them.`,
    };
  }
  return { ok: true, sections };
}
