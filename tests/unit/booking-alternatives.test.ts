import { describe, expect, it } from "vitest";

import type { Provider } from "@/lib/data/providers";
import { needsReplacement, pickAlternatives } from "@/lib/data/recommendations";
import { withdrawalRankingPenalty, scoreProvider } from "@/lib/data/ranking";

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
    busyUntil: null,
    baseRate: 800,
    stats: {
      ratingAvg: 4.6,
      ratingCount: 40,
      jobsCompleted: 60,
      completionRate: 96,
      avgResponseMinutes: 15,
      responseSamples: 40,
      lastActiveMinutesAgo: 5,
      jobsAccepted: 60,
      withdrawals: 0,
      overbookOffers: 0,
      overbookMisses: 0,
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
    expect(withdrawalRankingPenalty(provider().stats)).toBe(0);
  });

  it("barely registers for one withdrawal in a long record", () => {
    const seasoned = provider({
      stats: { ...provider().stats, jobsAccepted: 200, withdrawals: 1 },
    });
    expect(withdrawalRankingPenalty(seasoned.stats)).toBeLessThan(0.02);
  });

  it("bites when one job in three is abandoned", () => {
    const flaky = provider({
      stats: { ...provider().stats, jobsAccepted: 30, withdrawals: 10 },
    });
    // The full penalty: more than double the verification bonus, so this
    // outweighs a badge rather than being cancelled by one.
    expect(withdrawalRankingPenalty(flaky.stats)).toBeCloseTo(0.12, 5);
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
    expect(withdrawalRankingPenalty(newcomer.stats)).toBeLessThan(
      withdrawalRankingPenalty(flaky.stats),
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

describe("the chooser is shown only while there is nobody to do the job", () => {
  const waiting = { status: "pending", providerId: null, refusalCount: 1 };

  it("offers replacements after a refusal", () => {
    expect(needsReplacement(waiting)).toBe(true);
  });

  it("stops the moment the customer has picked somebody", () => {
    // The bug this exists for: the pick succeeded, the chooser stayed on
    // screen, and the obvious second tap was answered with "somebody has
    // already taken this job" — about a booking the customer had just fixed.
    expect(needsReplacement({ ...waiting, providerId: "p1" })).toBe(false);
  });

  it("stops once somebody accepts", () => {
    expect(
      needsReplacement({ ...waiting, status: "accepted", providerId: "p1" }),
    ).toBe(false);
  });

  it("is not shown on an ordinary wait, where nobody has refused anything", () => {
    expect(needsReplacement({ ...waiting, refusalCount: 0 })).toBe(false);
  });
});

describe("an emergency is only ever offered people who can come now", () => {
  it("drops the professional who is on another job", () => {
    // The withdrawal panel is read by somebody already let down once. A name
    // they tap that the server then refuses is a second failure inside a
    // minute, so the list never contains one.
    const engaged = provider({ availability: "on_job" });
    const free = provider({ availability: "now" });

    const picked = pickAlternatives([engaged, free], {
      area: "lalitpur-4",
      urgency: "emergency",
    });

    expect(picked.map((p) => p.provider.id)).toEqual([free.id]);
  });

  it("drops somebody inside their own declared busy window", () => {
    const busy = provider({
      availability: "busy",
      busyUntil: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    });
    const free = provider({ availability: "now" });

    const picked = pickAlternatives([busy, free], { urgency: "emergency" });
    expect(picked.map((p) => p.provider.id)).toEqual([free.id]);
  });

  it("returns nothing rather than somebody who cannot come", () => {
    // Empty is the honest answer, and the panel answers it with a phone
    // number. A name that cannot help at 2am is worse than no name.
    const engaged = provider({ availability: "on_job" });
    expect(pickAlternatives([engaged], { urgency: "emergency" })).toEqual([]);
  });
});

describe("nothing else is filtered, because being busy now is not being gone", () => {
  it("keeps a professional on a job for a routine booking", () => {
    // On a job at 11am says nothing about Thursday. Dropping them here would
    // take work from exactly the people the platform runs on.
    const engaged = provider({ availability: "on_job" });

    const picked = pickAlternatives([engaged], { urgency: "routine" });
    expect(picked.map((p) => p.provider.id)).toEqual([engaged.id]);
  });

  it("keeps a professional whose busy window ends before the chosen slot", () => {
    const busy = provider({
      availability: "busy",
      busyUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    });

    const picked = pickAlternatives([busy], {
      urgency: "routine",
      scheduledFor: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
    });
    expect(picked.map((p) => p.provider.id)).toEqual([busy.id]);
  });

  it("drops a professional whose busy window covers the chosen slot only when it is an emergency", () => {
    // `busyThen` is a real refusal, but it is still not a stop: the booking
    // goes through, the professional is told, and the customer can widen it.
    // Only the urgency decides, and this pins that the two differ.
    const busyUntil = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    const busy = provider({ availability: "busy", busyUntil });
    const slot = new Date(Date.now() + 48 * 60 * 60_000).toISOString();

    expect(
      pickAlternatives([busy], { urgency: "routine", scheduledFor: slot }),
    ).toHaveLength(1);
    // An emergency ignores the slot entirely — it is always "now".
    expect(
      pickAlternatives([busy], { urgency: "emergency", scheduledFor: slot }),
    ).toHaveLength(0);
  });
});

describe("a replacement whose window is already taken is not a replacement", () => {
  /*
   * This list is read by somebody who has already been let down once. Offering
   * a second name that also cannot be booked spends the last of their patience
   * on a tap that fails — so a full window drops them at EVERY urgency, unlike
   * every other refusal here.
   */

  it("drops them from a routine job as well as an emergency", () => {
    const taken = provider();
    const slot = new Date(Date.now() + 48 * 60 * 60_000).toISOString();

    for (const urgency of ["routine", "soon", "emergency"]) {
      expect(
        pickAlternatives([taken], {
          urgency,
          scheduledFor: slot,
          full: new Set([taken.id]),
        }),
      ).toHaveLength(0);
    }
  });

  it("keeps everybody else in the same list", () => {
    const taken = provider();
    const free = provider();

    const picked = pickAlternatives([taken, free], {
      urgency: "routine",
      full: new Set([taken.id]),
    });
    expect(picked.map((p) => p.provider.id)).toEqual([free.id]);
  });

  it("changes nothing when the caller does not ask", () => {
    // Omitting `full` is every caller from before capacity existed. It reads
    // as "nobody asked", never as "everybody is busy" — the database still
    // refuses the booking, and a list that silently emptied would be worse.
    const anyone = provider();
    expect(pickAlternatives([anyone], { urgency: "routine" })).toHaveLength(1);
  });
});
