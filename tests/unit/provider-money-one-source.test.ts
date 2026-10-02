import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * One source for the professional's money, enforced on the source itself.
 *
 * WHY A TEST THAT READS FILES. `tests/db/provider-money.test.ts` proves the
 * arithmetic — that a cash job is not money we owe, that a payout brings the
 * balance down, that a held quarter is not due yet. What it cannot prove is the
 * thing the design turns on: that **neither screen computes any of it**. Both
 * render one `providerMoney()` result, and a summary that quietly grew its own sum
 * would keep every arithmetic case green while telling a professional two different
 * figures for one week's work. That is exactly how the old `owedRupees` came to
 * exist beside the ledger in the first place.
 *
 * So this asserts the arrangement rather than the output, the same reasoning
 * `check:secrets`' third pass uses: the bundle passes can only see a leak that has
 * already happened, and the source pass sees the shape before it can.
 *
 * TO SEE IT BITE: add a `reduce` over `provider_earning` to either page, or drop
 * the `providerMoney` import from one of them, and the matching case fails.
 */

/**
 * Code, not prose — the `check:contacts` rule, and it bit immediately.
 *
 * The first version of this file flagged both pages, because each carries a comment
 * explaining that `owedRupees` used to sum `provider_earning` and why it no longer
 * does. Naming a thing in order to warn about it is documentation; the whole value
 * of those notes is that the next person does not reintroduce the sum, and a
 * scanner that punishes the warning would delete the warning. Same distinction
 * `check:secrets` makes about a key named in a comment.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

const PAGES = {
  "the money view": "app/[locale]/(work)/provider/payouts/page.tsx",
  "the dashboard summary": "app/[locale]/(work)/provider/page.tsx",
} as const;

/** Arithmetic that would mean a screen formed its own opinion about money. */
const OWN_ARITHMETIC = [
  /provider_earning/,
  /payout_holdback_rupees/,
  /provider_balance/,
  /provider_outstanding/,
  /\.reduce\(/,
];

describe("both provider money surfaces read the same function", () => {
  for (const [what, path] of Object.entries(PAGES)) {
    const source = code(readFileSync(path, "utf8"));

    it(`${what} reads providerMoney rather than a table`, () => {
      expect(
        source.includes("providerMoney"),
        `${path} must get its figures from providerMoney()`,
      ).toBe(true);
      expect(
        source.includes("waitFor"),
        `${path} must ask waitFor() why this week is waiting, not re-derive it`,
      ).toBe(true);
    });

    it(`${what} does no money arithmetic of its own`, () => {
      const found = OWN_ARITHMETIC.filter((pattern) => pattern.test(source)).map(
        (pattern) => String(pattern),
      );
      expect(
        found,
        `${path} is computing money itself. Every figure belongs to providerMoney().`,
      ).toEqual([]);
    });
  }

  it("has a rule that still catches a screen doing its own sum", () => {
    /*
     * THE SCANNER SELF-TESTS, like `check:messages` and `check:contacts`. A pattern
     * list that has quietly stopped matching anything reads exactly like a tree with
     * nothing wrong in it, and this one guards a number somebody is paid against.
     */
    const smells = `const owed = rows.reduce((t, r) => t + r.provider_earning, 0);`;
    const caught = OWN_ARITHMETIC.filter((pattern) => pattern.test(smells));
    expect(caught.length, "the rule no longer flags a known-bad line").toBeGreaterThan(0);
  });

  it("does not flag a page that correctly reads the function", () => {
    // The other direction: a rule that fires on correct code gets switched off.
    const fine = `const money = await providerMoney(id);\nreturn <MoneySummary money={money} wait={waitFor(money)} />;`;
    expect(OWN_ARITHMETIC.filter((pattern) => pattern.test(fine))).toEqual([]);
  });
});

describe("the dashboard's data layer no longer carries money", () => {
  it("has no owedRupees or outstandingRupees on ProviderDashboard", () => {
    /*
     * The fields are gone and the note explaining why is in their place. If somebody
     * adds them back, the dashboard has two sources again and the summary stops
     * being a rendering of the money view.
     */
    const source = code(readFileSync("lib/data/provider-profile.ts", "utf8"));

    expect(source).not.toMatch(/^\s*owedRupees:/m);
    expect(source).not.toMatch(/^\s*outstandingRupees:/m);
    expect(
      source.includes("provider_earning"),
      "the booking-derived sum is gone from the code, not merely unused",
    ).toBe(false);
  });
});
