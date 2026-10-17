import { describe, expect, it } from "vitest";

import { heldReasonFor } from "@/lib/payments/destination";
import {
  ENFORCEMENT_STEPS,
  blocksDirectBooking,
  canLift,
  closesOpenPool,
  forcesDigitalSettlement,
  hidesListing,
  holdsPayout,
  isEnforcementStep,
  isRemoved,
} from "@/lib/provider";

/**
 * What each step costs, asserted against the sentence that publishes it.
 *
 * THE DISTINCTIONS ARE THE WHOLE VALUE HERE. Any of these rules written as a
 * bare `step >= n` is right until somebody reads the page differently, and the
 * two that actually bite are both about step 3: it closes the open pool and it
 * does NOT hide the listing, because `/providers/standards` promises "customers
 * who ask for you by name still reach you". A step 3 that hid the listing would
 * be step 4 wearing step 3's label, and the professional would accept it and
 * find their repeat customers unable to reach them.
 */
describe("step 3 — the open pool, and nothing more", () => {
  it("closes the open pool and forces digital settlement", () => {
    expect(closesOpenPool(3)).toBe(true);
    expect(forcesDigitalSettlement(3)).toBe(true);
  });

  /*
   * THE PUBLISHED PROMISE, AS AN ASSERTION. This is the one a future "simplify
   * these to one predicate" would quietly break.
   */
  it("leaves the listing visible and the by-name route open", () => {
    expect(hidesListing(3)).toBe(false);
    expect(blocksDirectBooking(3)).toBe(false);
  });

  it("does not touch the money already earned", () => {
    expect(holdsPayout(3)).toBe(false);
    expect(heldReasonFor(5000, { readiness: { ok: true } }, 3)).toBeNull();
  });
});

describe("step 4 — the listing and the payout", () => {
  it("includes everything step 3 does", () => {
    expect(closesOpenPool(4)).toBe(true);
    expect(forcesDigitalSettlement(4)).toBe(true);
  });

  it("hides the listing and blocks the by-name route", () => {
    expect(hidesListing(4)).toBe(true);
    expect(blocksDirectBooking(4)).toBe(true);
  });

  it("holds the payout under its own reason", () => {
    expect(holdsPayout(4)).toBe(true);
    expect(heldReasonFor(5000, { readiness: { ok: true } }, 4)).toBe(
      "under_review",
    );
  });

  /*
   * A WEEK THEY OWE US STILL OUTRANKS IT. Nothing is drafted for a negative
   * week, so reporting a review would describe a payout that does not exist.
   */
  it("does not displace a negative week", () => {
    expect(heldReasonFor(-100, { readiness: { ok: true } }, 4)).toBe("negative");
  });

  /*
   * AND IT OUTRANKS EVERY DESTINATION REASON, because a review is ours and a
   * cooling account is theirs: telling somebody under review to go and confirm
   * their bank details sends them to fix a thing that is not stopping the money.
   */
  it("outranks a destination that is not ready", () => {
    expect(
      heldReasonFor(5000, { readiness: { ok: false, reason: "cooling" } }, 4),
    ).toBe("under_review");
  });
});

describe("step 5 — permanent, and that is a rule rather than a habit", () => {
  it("is everything step 4 is", () => {
    expect(closesOpenPool(5)).toBe(true);
    expect(hidesListing(5)).toBe(true);
    expect(holdsPayout(5)).toBe(true);
  });

  it("is removed", () => {
    expect(isRemoved(5)).toBe(true);
    expect(isRemoved(4)).toBe(false);
  });

  /*
   * REFUSED IN THE RULE, NOT IN THE SCREEN, so the write and the button cannot
   * disagree about what is permanent. The page says removal is permanent and
   * says what happens instead: somebody who should come back re-applies, which
   * records the second decision beside the first.
   */
  it("cannot be lifted, where every other step can", () => {
    expect(canLift(3)).toBe(true);
    expect(canLift(4)).toBe(true);
    expect(canLift(5)).toBe(false);
  });
});

describe("no step in force", () => {
  it("costs nothing at all", () => {
    for (const rule of [
      closesOpenPool,
      forcesDigitalSettlement,
      hidesListing,
      holdsPayout,
      isRemoved,
      blocksDirectBooking,
    ]) {
      expect(rule(null), rule.name).toBe(false);
    }
    expect(canLift(null)).toBe(false);
    expect(heldReasonFor(5000, { readiness: { ok: true } }, null)).toBeNull();
  });

  /*
   * STEPS 1 AND 2 ARE NOT STORED AND MUST NOT BECOME STORABLE. Step 1 is a
   * private message; step 2 is list position, already derived from
   * `provider_stats` by `withdrawalRankingPenalty`. A step 2 somebody could set
   * by hand would be a ranking penalty with no measurement behind it.
   */
  it("knows only the three steps that carry state", () => {
    expect([...ENFORCEMENT_STEPS]).toEqual([3, 4, 5]);
    expect(isEnforcementStep(2)).toBe(false);
    expect(isEnforcementStep(6)).toBe(false);
    expect(isEnforcementStep("3")).toBe(false);
  });
});
