import { describe, expect, it } from "vitest";

import { standards } from "@/lib/content/pages/standards";

/**
 * The two halves of the enforcement ladder say the same things.
 *
 * WHY THIS EXISTS. `npm run check:messages` guards `en.json` against `ne.json`
 * because next-intl renders a missing key as its own dotted path — a failure
 * loud enough to spot. This page is not message keys: it is two long-form
 * documents in one file, and a section added to `en` and forgotten in `ne`
 * fails completely silently. A Nepali reader would simply never learn that
 * carrying a balance is not a signal, or that the debt ends after a year, and
 * nothing anywhere would say so.
 *
 * That is not hypothetical here. This page is the one place a professional can
 * read what the platform will do to them before they sign up, and the standing
 * rule is that deterrence nobody can read is a trap rather than a deterrent.
 * A protection published in one language only is the same trap for half the
 * people it was written for.
 *
 * SECTIONS AND SHAPE, NEVER WORDING. Nepali here is written rather than
 * translated — the sentences are deliberately not parallel, and a test that
 * compared counts of sentences would be enforcing the exact thing the language
 * rule forbids. So this checks that the same sections exist in the same order,
 * and that no block is empty.
 */
describe("the standards page exists in both languages", () => {
  const en = standards.en;
  const ne = standards.ne;

  it("has the same sections, in the same order", () => {
    expect(ne.sections.map((s) => s.id)).toEqual(en.sections.map((s) => s.id));
  });

  it("gives every section a heading in both", () => {
    for (const doc of [en, ne]) {
      for (const section of doc.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("leaves no section with nothing in it", () => {
    // An empty `blocks` renders a heading with silence under it, which reads
    // as a page that was cut off rather than one with nothing to say.
    for (const doc of [en, ne]) {
      for (const section of doc.sections) {
        expect(section.blocks.length).toBeGreaterThan(0);
      }
    }
  });

  it("carries the debt protections in both languages", () => {
    /*
     * The three facts item 2 published, asserted as PRESENT rather than as
     * particular wording: a quarter as the ceiling, twelve months as the end,
     * and the balance named in the never-a-signal list.
     *
     * Matched on the numerals each language actually uses — Devanagari in the
     * Nepali, because that is what a reader sees.
     */
    const enText = JSON.stringify(en.sections);
    const neText = JSON.stringify(ne.sections);

    expect(enText).toContain("quarter of any single payout");
    expect(enText).toContain("Twelve months with no completed job");
    expect(enText).toContain("Carrying a guarantee balance");

    expect(neText).toContain("एक चौथाइ");
    expect(neText).toContain("बाह्र महिना");
    expect(neText).toContain("ग्यारेन्टीको बाँकी रकम बोक्नु");
  });

  it("was updated on the same day in both", () => {
    // One half edited and the other not is the failure this file is about,
    // and a stale date is the first visible sign of it.
    expect(ne.updated).toBe(en.updated);
  });
});
