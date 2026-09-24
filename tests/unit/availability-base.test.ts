import { describe, expect, it } from "vitest";

import type { Provider } from "@/lib/data/providers";
import { scoreProvider } from "@/lib/data/ranking";

/**
 * What a professional's listing says when they have said nothing.
 *
 * `providers.availability` is the value underneath both self-declared stamps,
 * and it was carrying two meanings at once: "I deliberately book ahead", which
 * the seeded listings state on purpose, and "nobody has ever touched this",
 * which was every real approved professional from the day they were let in.
 * Rule 6 again — a column default being read as a fact — and the fact it was
 * read as was a near-bottom ranking score tied with a declared refusal.
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
      offersMade: 0,
      offersAnswered: 0,
    },
    ...overrides,
  };
}

const score = (availability: Provider["availability"]) =>
  scoreProvider(provider({ availability })).parts.availability;

describe("not having claimed is not the same as having refused", () => {
  it("ranks by appointment above a declared busy window", () => {
    // They were the same number, so somebody bookable on Thursday sat level
    // with somebody who had said "not taking work".
    expect(score("scheduled")).toBeGreaterThan(score("busy"));
  });

  it("still ranks it below somebody who works same day", () => {
    // Raising it is not promoting it. They have not said they come today.
    expect(score("scheduled")).toBeLessThan(score("today"));
  });

  it("keeps the order the whole scale depends on", () => {
    expect(score("now")).toBeGreaterThan(score("today"));
    expect(score("today")).toEqual(score("on_job"));
    expect(score("on_job")).toBeGreaterThan(score("scheduled"));
  });
});
