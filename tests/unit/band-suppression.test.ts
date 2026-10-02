import { describe, expect, it } from "vitest";

import {
  MIN_PROPOSAL_SAMPLE,
  REJECTION_SAMPLE_GROWTH,
  proposalSuppressedBy,
  proposeBand,
  visitPriceIsMarketPrice,
} from "@/lib/data/band-proposal";

/**
 * What happens to a proposal somebody has already turned down.
 *
 * WHY THE RULE NEEDS PINNING AT ALL. A proposal is computed on demand from settled
 * jobs, so the same number comes back on every visit to `/admin/bands` — and a
 * number offered weekly is a number approved out of fatigue, which is the failure
 * `docs/PRICING-BANDS.md § 2` named before any of this was built. Suppression is
 * what stops that, and suppressing too eagerly is the opposite failure: a rejection
 * that meant "too soon" would hide the proposal for ever.
 *
 * WHAT THESE ASSERT AS BEHAVIOUR RATHER THAN AS A CONSTANT. The last case does the
 * arithmetic from `REJECTION_SAMPLE_GROWTH` because the threshold is what it is
 * testing; every other case uses literal samples, so lowering the growth factor to
 * nothing cannot leave the file green. That is the `ACTIVITY_FLOOR` lesson: a test
 * written entirely against a constant the code also reads asserts only that the
 * constant equals itself.
 */

const REJECTED = { proposedLow: 800, proposedHigh: 3400, sample: 40 };

describe("a rejected proposal", () => {
  it("is suppressed while the data says the same thing", () => {
    expect(
      proposalSuppressedBy(REJECTED, { low: 800, high: 3400, sample: 41 }),
    ).toBe(true);
  });

  /*
   * THE NUMBER MOVING IS THE MAIN ESCAPE HATCH, and it needs no margin: a proposal
   * is rounded outward to Rs 100 before anybody sees it, so two proposals are
   * either the same published pair or at least a hundred rupees apart. There is no
   * threshold here to pick, defend, or be suspicious of later.
   */
  it("comes back the moment either bound moves", () => {
    expect(
      proposalSuppressedBy(REJECTED, { low: 900, high: 3400, sample: 41 }),
    ).toBe(false);
    expect(
      proposalSuppressedBy(REJECTED, { low: 800, high: 3500, sample: 41 }),
    ).toBe(false);
  });

  /*
   * The second escape hatch, for a rejection that meant "come back with more
   * jobs". 40 jobs rejected, 60 needed: 59 is still the same conversation.
   */
  it("comes back on a materially larger sample, and not before", () => {
    expect(
      proposalSuppressedBy(REJECTED, { low: 800, high: 3400, sample: 59 }),
    ).toBe(true);
    expect(
      proposalSuppressedBy(REJECTED, { low: 800, high: 3400, sample: 60 }),
    ).toBe(false);
  });

  /*
   * MORE DATA SAYING THE SAME THING IS NOT AN ANSWER TO "THIS CATEGORY IS TWO
   * DIFFERENT JOBS" — but it is not an argument for hiding it for ever either,
   * which is why both conditions have to break and the sample one exists. This
   * case is the whole reason the rule is a conjunction rather than one clause.
   */
  it("needs both the pair AND the sample to be unchanged to stay hidden", () => {
    // Same pair, sample grown enough: shown.
    expect(
      proposalSuppressedBy(REJECTED, { low: 800, high: 3400, sample: 100 }),
    ).toBe(false);
    // Different pair, sample barely moved: shown.
    expect(
      proposalSuppressedBy(REJECTED, { low: 800, high: 3300, sample: 40 }),
    ).toBe(false);
  });

  /*
   * The threshold is ceiled so it cannot be cleared by rounding: at a sample of 31
   * the bar is 47, and 46 — which a floor or a round would have let through — is
   * still suppressed.
   */
  it("ceils the threshold rather than rounding it", () => {
    const odd = { proposedLow: 800, proposedHigh: 3400, sample: 31 };
    const bar = Math.ceil(31 * (1 + REJECTION_SAMPLE_GROWTH));
    expect(bar).toBe(47);

    expect(proposalSuppressedBy(odd, { low: 800, high: 3400, sample: 46 })).toBe(
      true,
    );
    expect(proposalSuppressedBy(odd, { low: 800, high: 3400, sample: bar })).toBe(
      false,
    );
  });
});

describe("against a real proposal", () => {
  /*
   * END TO END THROUGH `proposeBand`, because the rule's whole safety rests on a
   * property of that function's output — that it rounds — and a test that only ever
   * handed `proposalSuppressedBy` hand-written pairs would not notice if rounding
   * were removed and two proposals could differ by Rs 7.
   */
  const amounts = Array.from({ length: MIN_PROPOSAL_SAMPLE.high }, (_, i) =>
    1000 + i * 70,
  );

  it("suppresses its own output and nothing else", () => {
    const proposal = proposeBand({
      amounts,
      current: { low: 900, high: 4500 },
    })!;
    expect(proposal).not.toBeNull();

    const rejection = {
      proposedLow: proposal.low,
      proposedHigh: proposal.high,
      sample: proposal.sample,
    };
    expect(proposalSuppressedBy(rejection, proposal)).toBe(true);

    // Both bounds are multiples of 100, which is what makes exact comparison the
    // right test rather than a tolerance.
    expect(proposal.low % 100).toBe(0);
    expect(proposal.high % 100).toBe(0);
  });
});

describe("which settled jobs count as a market price", () => {
  /*
   * WHY THIS IS NOT "EXCLUDE EVERY RE-DO VISIT", which is what
   * `docs/PRICING-BANDS.md § 4` says in passing. The guarantee rules are more
   * specific and they are what decide who paid: a `sameFault` return is unpaid
   * labour and is no evidence of what a trade charges, while the other three
   * verdicts are — in the policy's own words — ordinary bookings at the ordinary
   * price. Excluding those would throw away real prices to honour a shorthand.
   */
  it("keeps a visit somebody actually paid for", () => {
    expect(visitPriceIsMarketPrice("differentProblem")).toBe(true);
    expect(visitPriceIsMarketPrice("nothingWrong")).toBe(true);
    expect(visitPriceIsMarketPrice("customerCaused")).toBe(true);
  });

  it("drops the unpaid return", () => {
    expect(visitPriceIsMarketPrice("sameFault")).toBe(false);
  });

  /*
   * RULE 6 FOR A SAMPLE. Nobody has said yet whether this was paid work, and a
   * null read as "paid" would let an unpaid visit set a floor. It rejoins the
   * sample the day a verdict is recorded, because the proposal is computed on
   * demand rather than stored.
   */
  it("drops a visit nobody has judged yet, rather than guessing", () => {
    expect(visitPriceIsMarketPrice(null)).toBe(false);
  });
});
