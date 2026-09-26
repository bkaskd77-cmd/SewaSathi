import { describe, expect, it } from "vitest";

import { topShare } from "@/lib/config/exposure";

/**
 * How concentrated the work is, reported before any mechanism exists.
 *
 * With a handful of real professionals a score ranking is winner-take-all:
 * whoever is top gets the jobs, gets the ratings, and the priors become
 * self-confirming. Rotation among near-ties is the likely answer and the margin
 * it needs is a number nobody has — so this counts, and stops.
 */

describe("a share needs something to be a share of", () => {
  it("is null with no offers at all, never zero", () => {
    // A category nobody has booked is not 0% concentrated. It is unread, and
    // printing 0% would read as the good news this screen exists to question.
    expect(topShare(0, 0)).toBeNull();
  });

  it("computes the share when there is a denominator", () => {
    expect(topShare(7, 10)).toBe(70);
    expect(topShare(1, 4)).toBe(25);
  });

  /*
   * ONE OUT OF ONE IS ARITHMETICALLY 100% AND MEANS NOTHING. The function still
   * returns it — refusing to would be a threshold, and this screen has none —
   * and the denominator travels beside it so the reader can see the figure rests
   * on a single booking. Same rule as every other rate in this product.
   */
  it("returns 100 on a single booking, and the caller shows the n", () => {
    expect(topShare(1, 1)).toBe(100);
  });

  it("never exceeds 100 or drops below 0 for sane inputs", () => {
    for (const [top, total] of [
      [0, 5],
      [3, 5],
      [5, 5],
    ] as const) {
      const share = topShare(top, total)!;
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(100);
    }
  });
});
