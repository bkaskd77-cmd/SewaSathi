import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import ne from "../../messages/ne.json";

/**
 * The band screen shows its evidence, enforced on the source.
 *
 * WHY A TEST THAT READS A FILE. `tests/db/band-approval.test.ts` proves the
 * behaviour that matters most — a published band moves forward only, and the history
 * cannot be rewritten. What it cannot prove is the thing the approve button's
 * honesty rests on: that an owner is shown what the data actually said before they
 * press it. The dangerous version of this screen is not one that computes wrongly,
 * it is one that computes correctly and prints a bare pair of numbers.
 *
 * THREE THINGS HAVE TO REACH THE PIXEL and each hides a different mistake:
 *
 *   the sample      a proposal from 30 jobs and from 300 are different facts, and
 *                   the whole point of `MIN_PROPOSAL_SAMPLE` is lost if the count
 *                   is not beside the number it produced.
 *   the winsorised  the tell that one band is the wrong shape. 15 of 84 jobs capped
 *     count         at the fence means the answer is sub-bands, not a wider band —
 *                   `docs/PRICING-BANDS.md § 4` says so, and nothing says it to the
 *                   person deciding unless this is on screen.
 *   the cap         the easiest to leave out and the most misleading to omit. A
 *                   proposal `MAX_REVISION_MOVE` held back is one whose data asked
 *                   for MORE; printed alone it reads as "the data says this", so
 *                   somebody approves a step believing it is the answer.
 *
 * TO SEE IT BITE: delete the `row.proposal.capped` block from the page, or the
 * `uncapped` figure inside it, and the matching case fails.
 */

/** Code, not prose — the `check:contacts` rule, so a warning comment cannot pass for a read. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

const PAGE = code(
  readFileSync("app/[locale]/(admin)/admin/bands/page.tsx", "utf8"),
);

describe("the proposal is never shown bare", () => {
  it("renders the sample and the winsorised count", () => {
    expect(PAGE).toMatch(/proposal\.sample/);
    expect(PAGE).toMatch(/proposal\.winsorised/);
  });

  it("says when the movement cap bound the result, and what was asked for", () => {
    expect(PAGE).toMatch(/proposal\.capped/);
    expect(PAGE).toMatch(/proposal\.uncapped/);
    expect(PAGE).toMatch(/cappedNote/);
  });

  /*
   * The cap note must name the limit rather than hardcoding "20%": the constant is a
   * product decision in one place, and a screen repeating the number is how the two
   * drift — the `perf-budget` lesson, where this file's standing notes said 155 kB
   * and the script said 158.
   */
  it("reads the cap from the constant rather than printing its own", () => {
    expect(PAGE).toMatch(/MAX_REVISION_MOVE/);
  });

  /*
   * RULE 6 ON THE SCREEN. Below the minimum sample there is no proposal, and the row
   * has to say so as a count — "12 of 30" — rather than falling back to the
   * published band, which would read as an endorsement nobody computed.
   */
  it("says how far short the sample is when there is no proposal", () => {
    expect(PAGE).toMatch(/tooFew/);
    expect(PAGE).toMatch(/sample\.needed/);
  });

  /*
   * A suppressed proposal is not a hidden one. Both catalogues have to carry the
   * sentence, because next-intl renders a missing key as its own dotted path and the
   * reader most likely to meet that is the one least likely to be checked.
   */
  it("explains a suppressed proposal in both languages", () => {
    expect(PAGE).toMatch(/suppressedBody/);
    for (const [name, catalogue] of [
      ["en", en],
      ["ne", ne],
    ] as const) {
      const bands = (catalogue as { admin: { bands: Record<string, unknown> } })
        .admin.bands;
      expect(
        typeof bands.suppressedBody === "string" &&
          (bands.suppressedBody as string).length > 10,
        `${name} is missing the suppressed sentence`,
      ).toBe(true);
      expect(
        typeof bands.suppressedReturns === "string",
        `${name} does not say what brings it back`,
      ).toBe(true);
    }
  });

  /*
   * And the screen states the thing a person most needs to know before pressing:
   * nothing already quoted changes. The database guarantees it
   * (`tests/db/band-approval.test.ts`); this is whether anybody is told.
   */
  it("tells the reader that no existing booking changes", () => {
    expect(PAGE).toMatch(/forwardOnly/);
  });
});
