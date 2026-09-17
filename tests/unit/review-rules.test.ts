import { describe, expect, it } from "vitest";

import {
  CUSTOMER_FLAGS,
  REVIEW_WINDOW_DAYS,
  canEdit,
  canReply,
  countsTowardAverage,
  isCustomerFlag,
  published,
  reviewWindowFrom,
  sealed,
  type ReviewPair,
} from "@/lib/reviews";
import { bayesianRating } from "@/lib/data/ranking";

/**
 * Who may say what about whom, and when anybody reads it.
 *
 * The four decisions this file pins are product decisions, not implementation
 * details — each one has a failure mode that only shows up in somebody's real
 * life, which is why they are written down here rather than left to whoever
 * next edits the form.
 */

const finished = new Date("2026-09-01T06:00:00Z");
const closes = reviewWindowFrom(finished);

function pair(overrides: Partial<ReviewPair> = {}): ReviewPair {
  return {
    customer: null,
    provider: null,
    windowClosesAt: closes.toISOString(),
    ...overrides,
  };
}

const submitted = { submittedAt: finished.toISOString() };

describe("neither side reads the other first", () => {
  it("stays sealed while only the customer has written", () => {
    expect(sealed(pair({ customer: submitted }), finished)).toBe(true);
  });

  it("stays sealed while only the professional has", () => {
    /*
     * THE DIRECTION THAT COSTS A REAL PERSON THE MOST. Double-blind is usually
     * argued for reciprocal inflation, but the case that matters here is a
     * professional reading a two-star and then ticking `abusive`. The flags
     * are never public, and the seal still has to hold both ways.
     */
    expect(sealed(pair({ provider: submitted }), finished)).toBe(true);
  });

  it("opens the moment both are in", () => {
    const both = pair({ customer: submitted, provider: submitted });
    expect(published(both, finished)).toBe(true);
  });

  it("opens when the window closes, whatever is in", () => {
    // A review nobody answered is still the customer's account. Withholding it
    // would punish them for the other side's silence.
    const one = pair({ customer: submitted });
    expect(sealed(one, new Date(closes.getTime() - 1))).toBe(true);
    expect(sealed(one, closes)).toBe(false);
  });

  it("holds the window open for exactly the published fortnight", () => {
    expect(closes.getTime() - finished.getTime()).toBe(
      REVIEW_WINDOW_DAYS * 24 * 60 * 60_000,
    );
  });
});

describe("a published review is fixed", () => {
  it("can be changed while sealed", () => {
    expect(canEdit(pair({ customer: submitted }), finished)).toBe(true);
  });

  it("cannot be changed once it is public", () => {
    /*
     * THIS CLOSES A CHANNEL. A review editable after the subject has read it is
     * not a review, it is an opening position — and the negotiation it invites
     * is "do this for free and I'll change my score".
     */
    const both = pair({ customer: submitted, provider: submitted });
    expect(canEdit(both, finished)).toBe(false);
  });
});

describe("the professional may answer once", () => {
  const both = pair({ customer: submitted, provider: submitted });

  it("allows a reply on a published review", () => {
    expect(
      canReply({ pair: both, alreadyReplied: false, disputeOpen: false, now: finished }),
    ).toEqual({ ok: true });
  });

  it("refuses a second one", () => {
    // One paragraph answers. A thread argues, in public, with somebody whose
    // house they have been to.
    const out = canReply({
      pair: both,
      alreadyReplied: true,
      disputeOpen: false,
      now: finished,
    });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe("alreadyReplied");
  });

  it("refuses one while a dispute or claim is open", () => {
    // There is already a process for that question, and the reply would
    // outlive whatever the process found.
    const out = canReply({
      pair: both,
      alreadyReplied: false,
      disputeOpen: true,
      now: finished,
    });
    expect(!out.ok && out.reason).toBe("disputeOpen");
  });

  it("refuses one before the review is even public", () => {
    const out = canReply({
      pair: pair({ customer: submitted }),
      alreadyReplied: false,
      disputeOpen: false,
      now: finished,
    });
    expect(!out.ok && out.reason).toBe("notPublished");
  });
});

describe("a disputed job's review is published and averaged by default", () => {
  it("counts unless a person excluded it", () => {
    expect(countsTowardAverage({ excludedFromAverageAt: null })).toBe(true);
  });

  it("stops counting when one did", () => {
    expect(
      countsTowardAverage({ excludedFromAverageAt: finished.toISOString() }),
    ).toBe(false);
  });

  it("has no state that hides a review while anybody decides", () => {
    /*
     * The shape of the rule IS the guarantee here. There is no "pending" and no
     * "under review": suppressing a bad review while we investigate would put
     * us in the business of deciding which ones see daylight, and the disputed
     * job is precisely the one a future customer most wants to read.
     * Exclusion moves it out of the AVERAGE and never off the page.
     */
    const rule = countsTowardAverage.toString();
    expect(rule).toContain("excludedFromAverageAt");
    expect(rule).not.toMatch(/pending|hidden|visible/i);
  });
});

describe("what a professional may record about a customer", () => {
  it("cannot express a price disagreement, in any flag", () => {
    /*
     * THE CONSTRAINT THAT MAKES RETALIATION UNEXPRESSIBLE RATHER THAN POLICED.
     * A customer declining a surveyed quote or refusing an over-band final
     * amount is exercising a right this product gives them; charging under the
     * band is already published as never-a-signal. So there is no flag for it,
     * and there is not going to be one.
     */
    for (const flag of CUSTOMER_FLAGS) {
      expect(flag).not.toMatch(
        /price|pay|cost|quote|amount|discount|cheap|money|rate|fee|haggl/i,
      );
    }
  });

  it("is a closed list, so prose cannot arrive through the side door", () => {
    expect(isCustomerFlag("abusive")).toBe(true);
    expect(isCustomerFlag("refused_to_pay")).toBe(false);
    expect(isCustomerFlag("difficult")).toBe(false);
  });

  it("carries no score of any kind", () => {
    // A number about a private individual, held indefinitely and never shown
    // to them, is prose with fewer characters: it cannot be checked, answered
    // or explained. Every flag is a fact about the visit.
    for (const flag of CUSTOMER_FLAGS) {
      expect(flag).not.toMatch(/rating|stars|score|good|bad|poor/i);
    }
  });
});

describe("one bad job, at both ends of a record", () => {
  /*
   * The prior is `bayesianRating` — 20 phantom ratings at 4.5 — and it has to
   * hold at BOTH ends. It is easy to check that 200 good jobs absorb one bad
   * one and forget that the same arithmetic is what stops three jobs and one
   * bad one from ending somebody.
   */

  const avg = (ratings: number[]) =>
    ratings.reduce((a, b) => a + b, 0) / ratings.length;

  it("moves a long record barely at all", () => {
    const many = Array(200).fill(4.9);
    const before = bayesianRating(avg(many), many.length);
    const after = bayesianRating(avg([...many, 1]), many.length + 1);
    expect(before - after).toBeLessThan(0.05);
  });

  it("does not end a short one", () => {
    // Three jobs, one of them a 1. The raw average is 3.67 — which on a card
    // reads as "avoid this person" — and the honest figure is 4.4.
    const raw = avg([5, 5, 1]);
    expect(raw).toBeLessThan(3.7);
    expect(bayesianRating(raw, 3)).toBeGreaterThan(4.3);
  });

  it("does not flatter a short one either, which is the same rule", () => {
    /*
     * The prior pulls BOTH ways and that is what makes it fair rather than
     * generous. Three perfect jobs are not a 5.0, and a card that prints one
     * is making the same mistake in the professional's favour.
     */
    expect(bayesianRating(avg([5, 5, 5]), 3)).toBeLessThan(4.7);
  });
});
