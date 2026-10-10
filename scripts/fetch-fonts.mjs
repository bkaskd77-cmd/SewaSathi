#!/usr/bin/env node
/**
 * Fetch the font files this product self-hosts, from Google Fonts, once.
 *
 * WHY SELF-HOST AT ALL. `next/font/google` fetches the CSS and the woff2 at
 * BUILD time, so Google Fonts is a build dependency — and on 2026-10-09 and
 * again on 2026-10-10 it answered with something the loader could not parse:
 *
 *   app/[locale]/layout.tsx
 *   An error occurred in `next/font`.
 *   TypeError: Cannot read properties of null (reading '1')
 *       at @next/font/dist/google/loader.js:122:78
 *
 * Both times CI went red, the deploy gate correctly refused to ship a red
 * commit, and production quietly kept serving an older build. The second one
 * sat for five hours and was found by a person reading `/api/version`. A
 * third-party outage that blocks a deploy is a dependency nobody chose.
 *
 * WHY A SCRIPT RATHER THAN A HAND DOWNLOAD. Five files that nobody can
 * reproduce is five files nobody can update — the licence, the version and the
 * subset would live only in somebody's memory. This records all three, and
 * re-running it is how the fonts get refreshed.
 *
 * WHAT IT TAKES, AND IT IS EXACTLY WHAT WAS BEING FETCHED BEFORE. The same
 * three families, the same subsets, the same weights, so nothing about the
 * rendering changes:
 *
 *   Plus Jakarta Sans  latin       variable 200..800   --font-sans
 *   Fraunces           latin       600, 700            --font-display
 *   Noto Sans Devanagari devanagari 400, 600           --font-nepali
 *
 * Fraunces and Noto are served by Google as STATIC instances at those weights,
 * not as variable files — checked rather than assumed, because declaring a
 * variable range over a static file is how you end up with synthesised bold,
 * which CLAUDE.md records as a type decision this product has already refused.
 *
 * All three are SIL Open Font License 1.1, which permits redistribution with
 * the licence; OFL.txt sits beside the files.
 *
 *   node scripts/fetch-fonts.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/* A real browser UA, or the API answers with the TTF-era CSS and no woff2. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const OUT = join(process.cwd(), "app", "fonts");

/** family: the css2 `family=` value. subset: the comment Google labels it with. */
const WANTED = [
  {
    family: "Plus+Jakarta+Sans:wght@200..800",
    subset: "latin",
    file: "plus-jakarta-sans-latin.woff2",
  },
  { family: "Fraunces:wght@600", subset: "latin", file: "fraunces-latin-600.woff2" },
  { family: "Fraunces:wght@700", subset: "latin", file: "fraunces-latin-700.woff2" },
  {
    family: "Noto+Sans+Devanagari:wght@400",
    subset: "devanagari",
    file: "noto-sans-devanagari-400.woff2",
  },
  {
    family: "Noto+Sans+Devanagari:wght@600",
    subset: "devanagari",
    file: "noto-sans-devanagari-600.woff2",
  },
];

/**
 * The woff2 URL for one subset, read out of the CSS.
 *
 * Google labels each block with a `/* subset *\/` comment immediately before
 * it, so the subset is found by walking the comments rather than by matching
 * the unicode-range — which would mean hard-coding ranges that Google revises.
 */
function blockFor(css, subset) {
  const blocks = css.split("/*").slice(1);
  for (const block of blocks) {
    const label = block.slice(0, block.indexOf("*/")).trim();
    if (label === subset) return block;
  }
  return null;
}

function urlFor(css, subset) {
  const blocks = css.split("/*").slice(1);
  for (const block of blocks) {
    const label = block.slice(0, block.indexOf("*/")).trim();
    if (label !== subset) continue;
    const url = /src:\s*url\((https:\/\/[^)]+\.woff2)\)/.exec(block);
    if (url) return url[1];
  }
  return null;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  /**
   * The unicode-ranges Google serves, recorded as they were found.
   *
   * `next/font` REFUSES A VARIABLE in a loader call — "Font loader values must
   * be explicitly written literals" — so the latin range is written out twice
   * in `app/[locale]/layout.tsx`, once for the sans and once for the display
   * face. That is one list written twice, which this repository has paid for
   * often enough to have a standard answer: write it twice and have a test
   * compare the copies. `tests/unit/self-hosted-fonts.test.ts` reads this file
   * and the layout, so a range Google revises fails there rather than silently
   * serving a font for characters it has no glyphs for.
   */
  const ranges = {};

  for (const { family, subset, file } of WANTED) {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
    const css = await (await fetch(cssUrl, { headers: { "user-agent": UA } })).text();

    const block = blockFor(css, subset);
    if (!block) throw new Error(`no ${subset} block in ${cssUrl}`);

    const url = urlFor(css, subset);
    if (!url) throw new Error(`no ${subset} woff2 in ${cssUrl}`);

    const range = /unicode-range:\s*([^;]+);/.exec(block);
    if (!range) throw new Error(`no ${subset} unicode-range in ${cssUrl}`);
    ranges[subset] = range[1].trim();

    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(join(OUT, file), bytes);
    console.log(`  ${file.padEnd(34)} ${(bytes.length / 1024).toFixed(1)} kB`);
  }

  await writeFile(
    join(OUT, "ranges.json"),
    `${JSON.stringify(ranges, null, 2)}\n`,
    "utf8",
  );

  console.log(`\n${WANTED.length} files in app/fonts/, ranges recorded.`);
}

await main();
