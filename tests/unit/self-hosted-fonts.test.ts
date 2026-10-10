import { describe, expect, it } from "vitest";

/**
 * The fonts are ours now, and the duplication that cost is checked.
 *
 * WHY SELF-HOSTED AT ALL. `next/font/google` fetches the CSS and the woff2 at
 * BUILD time, so Google Fonts was a build dependency. Twice in two days it
 * answered with something the loader could not parse — `TypeError: Cannot read
 * properties of null (reading '1')` in `@next/font/google/loader.js` — CI went
 * red, the deploy gate correctly refused to ship a red commit, and production
 * quietly kept serving an older build. The second one sat for five hours and
 * was found by a person reading `/api/version`.
 *
 * WHAT IT COST. `next/font` refuses a variable in a loader call — "Font loader
 * values must be explicitly written literals" — so the latin unicode-range is
 * written out TWICE in the layout, once for the sans and once for the display
 * face. One list written twice is the shape this repository has paid for in
 * `LOGGABLE_REASONS`, `CRON_JOBS` and `REFUSAL_REASON_CODES`, and the standard
 * answer is the same: write it twice and have a test compare the copies.
 *
 * `app/fonts/ranges.json` is the record `scripts/fetch-fonts.mjs` wrote from
 * what Google actually served. A range revised upstream, or a literal mistyped
 * here, fails below rather than silently serving a face for characters it has
 * no glyphs for — which would show as Devanagari text in the wrong face on a
 * Nepali page, a thing no local check would otherwise notice.
 */

async function read(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

async function layout(): Promise<string> {
  return read("app/[locale]/layout.tsx");
}

/** Every `unicode-range` literal in the layout, in source order. */
function ranges(source: string): string[] {
  return [
    ...source.matchAll(/prop:\s*"unicode-range",\s*value:\s*\n?\s*"([^"]+)"/g),
  ].map((m) => m[1]);
}

describe("the self-hosted faces", () => {
  it("loads them from disk and never from Google", async () => {
    const source = await layout();
    expect(source).toContain('from "next/font/local"');
    /* The IMPORT, not the name. The comment above the loader explains what this
       replaced and why, and naming a thing in order to warn about it is
       documentation — the same distinction `check:secrets` draws between a key
       in a comment and a key being read. */
    expect(
      source,
      "next/font/google makes Google Fonts a build dependency — that is what this replaced",
    ).not.toContain('from "next/font/google"');
  });

  it("ships every file the layout asks for", async () => {
    const { access } = await import("node:fs/promises");
    const source = await layout();
    const files = [...source.matchAll(/\.\.\/fonts\/([a-z0-9.-]+\.woff2)/g)].map(
      (m) => m[1],
    );
    expect(files.length, "no font files referenced").toBeGreaterThanOrEqual(5);

    for (const file of new Set(files)) {
      await expect(
        access(new URL(`../../app/fonts/${file}`, import.meta.url)),
        `${file} is referenced and not committed`,
      ).resolves.toBeUndefined();
    }
  });

  /**
   * THE DUPLICATION, CHECKED IN BOTH DIRECTIONS. The two latin literals must
   * agree with each other, and all of them must agree with what Google served.
   */
  it("writes the same latin range at both call sites", async () => {
    const found = ranges(await layout());
    const latin = found.filter((r) => r.startsWith("U+0000-00FF"));
    expect(latin.length, "expected the sans and the display face").toBe(2);
    expect(latin[0]).toBe(latin[1]);
  });

  it("matches the ranges the fetch script recorded", async () => {
    const recorded = JSON.parse(await read("app/fonts/ranges.json")) as Record<
      string,
      string
    >;
    const found = new Set(ranges(await layout()));

    for (const [subset, range] of Object.entries(recorded)) {
      expect(
        found.has(range),
        `the ${subset} range in the layout is not the one Google served — ` +
          `re-run scripts/fetch-fonts.mjs and copy it across`,
      ).toBe(true);
    }
  });

  /** The licence travels with the files, which the OFL requires. */
  it("carries the licence for all three families", async () => {
    const ofl = await read("app/fonts/OFL.txt");
    expect(ofl).toMatch(/SIL OPEN FONT LICENSE/i);
    /* Matched on the copyright line each project actually uses — Noto's reads
       "The Noto Project Authors", not the family name, which is what this
       caught on the first run. */
    for (const holder of [
      "Plus Jakarta Sans Project Authors",
      "Fraunces Project Authors",
      "Noto Project Authors",
    ]) {
      expect(ofl, `no copyright notice for ${holder} in OFL.txt`).toContain(holder);
    }
  });

  /**
   * THE DEVANAGARI FACE STAYS UNPRELOADED. It is ~100 kB across two weights and
   * an English page needs none of it — CLAUDE.md records mobile Lighthouse going
   * 90 → 97 on `/` when that stopped being downloaded to draw two glyphs in the
   * language toggle. Self-hosting must not quietly undo it.
   */
  it("does not preload the Devanagari face", async () => {
    const source = await layout();
    const nepali = source.slice(source.indexOf("const nepali"));
    expect(nepali.slice(0, nepali.indexOf("});"))).toContain("preload: false");
  });
});
