import { describe, expect, it } from "vitest";

import type { Provider } from "@/lib/data/providers";
import { pickAlternatives } from "@/lib/data/recommendations";
import { withdrawalPenalty, scoreProvider } from "@/lib/data/ranking";

/**
 * What a customer is offered when their professional pulls out.
 *
 * This is the recovery path, and the thing it must never do is offer somebody
 * back the person who just refused them. Everything else here is about the
 * second failure mode: an empty list. A customer whose ward has one plumber is
 * not helped by being shown one plumber, so the search widens — and says that
 * it has, because "twenty minutes away" is something to know before tapping.
 */

let seq = 0;

function provider(overrides: Partial<Provider> = {}): Provider {
  seq += 1;
  return {
    id: `p${seq}`,
    displayName: `Provider ${seq}`,
    bio: "",
    photoUrl: null,
    categories: ["plumbing"],
    serviceAreas: ["lalitpur-4"],
    yearsExperience: 5,
    isVerified: true,
    idDocumentStatus: "verified",
    checks: ["id"],
    availability: "now",
    baseRate: 800,
    stats: {
      ratingAvg: 4.6,
      ratingCount: 40,
      jobsCompleted: 60,
      completionRate: 96,
      avgResponseMinutes: 15,
      lastActiveMinutesAgo: 5,
      jobsAccepted: 60,
      withdrawals: 0,
    },
    ...overrides,
  };
}

describe("the person who just refused is never suggested back", () => {
  it("drops every excluded listing", () => {
    const refuser = provider();
    const other = provider();

    const picked = pickAlternatives([refuser, other], {
      area: "lalitpur-4",
      exclude: [refuser.id],
    });

    expect(picked.map((p) => p.provider.id)).toEqual([other.id]);
  });

  it("returns nothing rather than the refuser when they were the only one", () => {
    // The empty list is a real answer with its own screen — a phone number.
    // Filling it with the person who said no would be worse than empty.
    const refuser = provider();
    expect(pickAlternatives([refuser], { exclude: [refuser.id] })).toEqual([]);
  });
});

describe("the search widens rather than coming back empty", () => {
  it("puts the customer's own ward first", () => {
    const nearby = provider({ serviceAreas: ["lalitpur-9"] });
    const sameWard = provider({ serviceAreas: ["lalitpur-4"] });

    const picked = pickAlternatives([nearby, sameWard], { area: "lalitpur-4" });

    expect(picked[0].provider.id).toBe(sameWard.id);
    expect(picked[0].reach).toBe("ward");
    expect(picked[1].reach).toBe("city");
  });

  it("reaches into the rest of the city, then out of it, to fill three", () => {
    const ward = provider({ serviceAreas: ["lalitpur-4"] });
    const city = provider({ serviceAreas: ["lalitpur-12"] });
    const far = provider({ serviceAreas: ["bhaktapur-2"] });

    const picked = pickAlternatives([far, city, ward], { area: "lalitpur-4" });

    expect(picked.map((p) => p.reach)).toEqual(["ward", "city", "anywhere"]);
  });

  it("names how far each suggestion reaches", () => {
    // The label is not decoration: somebody choosing between a 4.9 an hour
    // away and a 4.5 on their street is making a different decision from the
    // one the score alone describes.
    const far = provider({ serviceAreas: ["bhaktapur-2"] });
    expect(pickAlternatives([far], { area: "lalitpur-4" })[0].reach).toBe(
      "anywhere",
    );
  });

  it("stops at three, however many could do it", () => {
    const many = Array.from({ length: 9 }, () => provider());
    expect(pickAlternatives(many, { area: "lalitpur-4" })).toHaveLength(3);
  });
});

describe("a habit of pulling out costs list position", () => {
  it("costs nothing when there is no history", () => {
    expect(withdrawalPenalty(provider().stats)).toBe(0);
  });

  it("barely registers for one withdrawal in a long record", () => {
    const seasoned = provider({
      stats: { ...provider().stats, jobsAccepted: 200, withdrawals: 1 },
    });
    expect(withdrawalPenalty(seasoned.stats)).toBeLessThan(0.02);
  });

  it("bites when one job in three is abandoned", () => {
    const flaky = provider({
      stats: { ...provider().stats, jobsAccepted: 30, withdrawals: 10 },
    });
    // The full penalty: more than double the verification bonus, so this
    // outweighs a badge rather than being cancelled by one.
    expect(withdrawalPenalty(flaky.stats)).toBeCloseTo(0.12, 5);
  });

  it("does not let a single data point condemn a new professional", () => {
    // One accepted job, one withdrawal, is a 100% rate and almost no evidence.
    // The prior is what keeps that from reading as the worst record on the
    // platform.
    const newcomer = provider({
      stats: { ...provider().stats, jobsAccepted: 1, withdrawals: 1 },
    });
    const flaky = provider({
      stats: { ...provider().stats, jobsAccepted: 30, withdrawals: 10 },
    });
    expect(withdrawalPenalty(newcomer.stats)).toBeLessThan(
      withdrawalPenalty(flaky.stats),
    );
  });

  it("moves the professional down the actual list, not just the number", () => {
    // The whole point. A penalty nothing reads is a comment.
    const steady = provider();
    const flaky = provider({
      stats: { ...steady.stats, jobsAccepted: 20, withdrawals: 8 },
    });

    expect(scoreProvider(flaky).score).toBeLessThan(
      scoreProvider(steady).score,
    );
    expect(
      pickAlternatives([flaky, steady], { area: "lalitpur-4" })[0].provider.id,
    ).toBe(steady.id);
  });
});
