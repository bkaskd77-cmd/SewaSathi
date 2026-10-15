/**
 * The PWA and Play Store icons, rasterised from `app/icon.svg`.
 *
 * ONE SOURCE OF TRUTH FOR THE MARK, which is the same rule `styles/globals.css`
 * holds for colour. The alternative is three PNGs somebody drew once, and a
 * brand change that updates the favicon and leaves the installed app wearing
 * last year's logo on a home screen — the one place nobody looks and everybody
 * sees. So the PNGs are generated from the SVG that is already the favicon, and
 * this script is how they are regenerated.
 *
 * COMMITTED RATHER THAN GENERATED AT BUILD TIME, deliberately. Vercel's builder
 * has no browser — the same reason `check:paint` is a CI step and not part of
 * `next build` — so a build-time rasterise would fail on the one machine that
 * matters. Run it when the mark changes; `npm run verify` does not.
 *
 * MASKABLE IS A DIFFERENT PICTURE AND NOT A FLAG. Android crops an adaptive
 * icon to whatever shape the launcher wants, and the guaranteed-visible region
 * is the middle 80% circle. An icon that fills its canvas gets its corners cut
 * off, which on this mark would remove the gold dot. So the maskable version is
 * drawn at 60% scale on a solid emerald field, with the rounding dropped
 * because the launcher supplies the shape.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const SVG = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
const OUT = new URL("../public/icons/", import.meta.url);

/** Brand emerald, from styles/globals.css via app/icon.svg. */
const FIELD = "#0F6B5B";

/**
 * `field` IS THE DIFFERENCE BETWEEN THE TWO KINDS, not just the inset.
 *
 * An `any` icon keeps the SVG's own rounded corners, so it needs a TRANSPARENT
 * canvas — painting the emerald field behind it squares the mark off and the
 * rounding in `app/icon.svg` is silently thrown away. A `maskable` icon is the
 * opposite: the launcher crops it to its own shape, so transparent corners
 * would show through as notches and it needs the field painted edge to edge.
 * Both were generated against a solid field first and the square one lost its
 * corners, which is visible only by looking at the file.
 */
const TARGETS = [
  { file: "icon-192.png", size: 192, inset: 0, field: null },
  { file: "icon-512.png", size: 512, inset: 0, field: null },
  // The safe area is the middle 80%; 60% leaves the mark clear of every crop.
  { file: "icon-maskable-512.png", size: 512, inset: 0.2, field: FIELD },
];

function page(size, inset, field) {
  const scale = 1 - inset * 2;
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:${field ?? "transparent"}}
    .wrap{width:${size}px;height:${size}px;display:grid;place-items:center}
    svg{width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px;display:block}
  </style><div class="wrap">${SVG}</div>`;
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
});
try {
  mkdirSync(OUT, { recursive: true });
  for (const target of TARGETS) {
    const tab = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });
    await tab.setContent(page(target.size, target.inset, target.field));
    const png = await tab.screenshot({
      type: "png",
      omitBackground: target.field === null,
    });
    writeFileSync(new URL(target.file, OUT), png);
    console.log(`  ${target.file}  ${target.size}x${target.size}  ${png.length} bytes`);
    await tab.close();
  }
} finally {
  await browser.close();
}
console.log("Icons written to public/icons/.");
