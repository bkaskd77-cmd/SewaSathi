import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One rating figure, enforced on the source itself.
 *
 * WHAT THE BEHAVIOURAL TESTS CANNOT SEE. `tests/unit/rating-recency.test.ts`
 * proves the composition — that a stale 5.0 lands near the prior, that an
 * uncomputed pair falls back, that the ranking gets the prior for an unrated
 * listing. What it cannot prove is the thing this design turns on: that **no
 * surface forms its own opinion**. `bayesianRating(stats.ratingAvg,
 * stats.ratingCount)` still compiles, still reads as careful code, and is now
 * quietly the WRONG PAIR — it would print a flat figure beside a list ordered on
 * the decayed one, which is the card-versus-ranking split `displayRating` was
 * written to end, re-opened by a new column rather than by a second
 * implementation.
 *
 * It had already happened twice without the columns. `displayRating` shipped,
 * the catalogue card and the booking flow were fixed, and the public profile
 * page and the withdrawal replacement list kept printing `stats.ratingAvg` —
 * two screens a customer reads to decide who comes to their house, disagreeing
 * with the list that ranked them. Both were found by reading for this test, not
 * by a failure. So the arrangement is asserted, the `check:secrets` reasoning:
 * a behavioural test sees a divergence that has already reached somebody, and a
 * source pass sees the shape before it can.
 *
 * THE FILE LIST IS DERIVED, never maintained. `coverageGaps`' rule — a surface
 * nobody listed gets no assertion made about it, and that looks exactly like
 * success.
 *
 * TO SEE IT BITE: print `{stats.ratingAvg.toFixed(1)}` on any card, or render
 * `ratingRecentWeight` in the brackets beside a figure.
 */

/**
 * Code, not prose — `provider-money-one-source`'s rule, and it bit here too.
 *
 * Three of these files carry a comment naming the raw average in order to warn
 * the next reader off it, and the whole value of those notes is that nobody
 * reintroduces the read. A scanner that punished the warning would delete the
 * warning.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/**
 * A field being handed on, rather than read.
 *
 * `ratingAvg: provider.stats.ratingAvg,` is a screen passing the whole record
 * to something that knows the rule; `ratingAvg: number;` is a type saying it
 * carries one. Neither is a figure on a screen. `stats.ratingAvg.toFixed(1)`
 * is, and it is what survives this.
 */
function reads(source: string, field: string): boolean {
  const carried = new RegExp(`\\b${field}\\s*\\??:[^\\n]*`, "g");
  return new RegExp(`\\b${field}\\b`).test(code(source).replace(carried, ""));
}

/**
 * Every file that renders something, walked rather than listed.
 *
 * `readdirSync` and not a glob package: the repository has no direct glob
 * dependency and `revalidate-paths.test.ts` walks the same tree the same way.
 */
function surfaces(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) surfaces(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

const SURFACES = [
  ...surfaces(path.join(process.cwd(), "app")),
  ...surfaces(path.join(process.cwd(), "components")),
];

/** The raw columns. None of these is the figure anybody should print. */
const RAW_FIELDS = ["ratingAvg", "ratingRecentAvg", "ratingRecentWeight"];

describe("every surface prints the one composed figure", () => {
  it("found the surfaces to check", () => {
    // A glob that silently matched nothing would pass every case below.
    expect(SURFACES.length).toBeGreaterThan(40);
  });

  it("reads no raw rating column anywhere a person can see one", () => {
    const offenders = SURFACES.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return RAW_FIELDS.filter((field) => reads(source, field)).map(
        (field) => `${path} reads ${field}`,
      );
    });

    expect(
      offenders,
      "a screen is composing its own rating. `displayRating` is the one figure.",
    ).toEqual([]);
  });

  it("names the count in brackets and never the weight", () => {
    /*
     * THE TWO NUMBERS ANSWER DIFFERENT QUESTIONS, and only one of them is
     * checkable by the person reading it. `rating_recent_weight` is an
     * EFFECTIVE count — twelve two-year-old reviews are worth three — so
     * "4.6 (3)" over a page listing twelve reviews is a figure that contradicts
     * what is underneath it, and one that falls on a profile where nothing
     * happened. The count stays `ratingCount`, which is why `hasRating` still
     * reads it and nothing in `measured.ts` touches it.
     */
    const bracketed = SURFACES.filter((path) =>
      /\(\s*\{\s*(?:[\w.]+\.)?ratingRecentWeight/.test(
        code(readFileSync(path, "utf8")),
      ),
    );

    expect(bracketed, "the weight is confidence, not evidence").toEqual([]);
  });

  it("has a rule that still catches a surface printing the raw average", () => {
    // The scanner self-tests, like `check:messages` and `check:contacts`: a
    // pattern that has quietly stopped matching reads exactly like a clean tree.
    expect(reads(`<dd>{stats.ratingAvg.toFixed(1)}</dd>`, "ratingAvg")).toBe(true);
    expect(
      reads(`ratingLabel: \`\${p.stats.ratingRecentAvg}\``, "ratingRecentAvg"),
    ).toBe(true);
  });

  it("does not flag a surface that carries the record or asks the function", () => {
    // The other direction: a rule that fires on correct code gets switched off,
    // and three real files in this product do exactly these two things.
    expect(
      reads(`{ ratingAvg: provider.stats.ratingAvg, ratingCount: 3 }`, "ratingAvg"),
    ).toBe(false);
    expect(reads(`  ratingRecentAvg: number | null;`, "ratingRecentAvg")).toBe(
      false,
    );
    expect(
      reads(`<dd>{displayRating(stats)?.toFixed(1)}</dd>`, "ratingAvg"),
    ).toBe(false);
  });
});

describe("the ranking composes nothing of its own", () => {
  const source = code(readFileSync("lib/data/ranking.ts", "utf8"));

  it("asks rankedRating rather than building the pair itself", () => {
    expect(source).toMatch(/\brankedRating\(/);
    expect(
      /bayesianRating\s*\(/.test(source),
      "the rating term and the sort must go through rankedRating, not compose a pair",
    ).toBe(false);
  });

  it("still re-exports bayesianRating for the callers that want the primitive", () => {
    // Not a ban on the import — the archetype is public and the tests use it.
    // The ban is on CALLING it here, which is what chooses a pair.
    expect(readFileSync("lib/data/ranking.ts", "utf8")).toContain(
      'export { bayesianRating } from "@/lib/provider";',
    );
  });
});
