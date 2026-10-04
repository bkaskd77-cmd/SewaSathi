import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Provider } from "@/lib/data/providers";

/**
 * Proximity: real distance where both ends are known, ward membership where they are not.
 *
 * WHAT CHANGED AND WHY. `proximity` carries 0.18 of the relevance blend and had three
 * values — 1.0 inside the chosen ward, 0.6 elsewhere in the city, 0.25 otherwise. So
 * somebody two streets away across a ward line scored identically to somebody on the
 * far side of the Valley, which the weight exists precisely to distinguish.
 *
 * THE FIRST CASE IS THE ONE THAT MATTERS AND IT IS A REGRESSION TEST. Every address in
 * this product has no pin until a customer uses the new button, and the centroid seed is
 * empty until somebody runs the fetch script — so the overwhelmingly common path is
 * "no coordinates at either end". If that scored like "far away", every customer who
 * declined the location prompt would be served their worst matches. It must score
 * *exactly* as it did before this feature existed, which is what `toBe` on the old
 * constants asserts.
 *
 * `nearestServedKm` IS MOCKED RATHER THAN SEEDED, deliberately. The distance arithmetic
 * is proven against real coordinates in `geo.test.ts`; what is unproven here is the
 * BRANCH — whether `scoreParts` reads the measurement when there is one and falls back
 * when there is not. Mocking the measurement is what lets both branches be exercised
 * while `area-centroids.json` is still empty, and it keeps this file testing the
 * ranking rather than the ward table.
 */

const nearestServedKm = vi.fn<(areas: unknown, to: unknown) => number | null>();

vi.mock("@/lib/geo", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  nearestServedKm: (areas: unknown, to: unknown) => nearestServedKm(areas, to),
}));

let seq = 0;

function provider(serviceAreas: string[] = ["lalitpur-4"]): Provider {
  seq += 1;
  return {
    id: `p${seq}`,
    displayName: `Provider ${seq}`,
    bio: "",
    photoUrl: null,
    categories: ["plumbing"],
    serviceAreas,
    yearsExperience: 5,
    isVerified: true,
    idDocumentStatus: "verified",
    checks: ["id"],
    availability: "now",
    busyUntil: null,
    baseRate: 900,
    stats: {
      ratingAvg: 0,
      ratingCount: 0,
      jobsCompleted: 0,
      completionRate: 100,
      avgResponseMinutes: 120,
      responseSamples: 0,
      lastActiveMinutesAgo: 5,
      jobsAccepted: 0,
      withdrawals: 0,
      overbookOffers: 0,
      overbookMisses: 0,
      offersMade: 0,
      offersAnswered: 0,
    },
  };
}

beforeEach(() => {
  nearestServedKm.mockReset();
});

describe("an address with no pin scores exactly as it always did", () => {
  /*
   * THE THREE OLD VALUES, PINNED AS NUMBERS. Written as literals rather than imported
   * constants on purpose: a test that read the same constant the code reads would stay
   * green if somebody changed it, which is the blindness the activity-floor tests were
   * caught for. These three numbers are the behaviour customers have today.
   */
  it("gives 1.0 inside the chosen ward", async () => {
    nearestServedKm.mockReturnValue(null);
    const { scoreParts } = await import("@/lib/data/ranking");
    expect(
      scoreParts(provider(["lalitpur-4"]), { area: "lalitpur-4" }).proximity,
    ).toBe(1);
  });

  it("gives 0.6 elsewhere in the same city", async () => {
    nearestServedKm.mockReturnValue(null);
    const { scoreParts } = await import("@/lib/data/ranking");
    expect(
      scoreParts(provider(["lalitpur-10"]), { area: "lalitpur-4" }).proximity,
    ).toBe(0.6);
  });

  it("gives 0.25 in a different city", async () => {
    nearestServedKm.mockReturnValue(null);
    const { scoreParts } = await import("@/lib/data/ranking");
    expect(
      scoreParts(provider(["bhaktapur-4"]), { area: "lalitpur-4" }).proximity,
    ).toBe(0.25);
  });

  /*
   * AND NEUTRAL FOR EVERYBODY WITH NO WARD EITHER, which is what stops the term adding
   * noise to a list nobody has localised.
   */
  it("gives everyone 0.6 when nothing localises the search", async () => {
    nearestServedKm.mockReturnValue(null);
    const { scoreParts } = await import("@/lib/data/ranking");
    expect(scoreParts(provider(), {}).proximity).toBe(0.6);
  });
});

describe("a pinned address is scored on distance", () => {
  const AT = { lat: 27.6766, lng: 85.3105 };

  it("scores a near professional above a far one", async () => {
    const { scoreParts } = await import("@/lib/data/ranking");

    nearestServedKm.mockReturnValue(1);
    const near = scoreParts(provider(), { area: "lalitpur-4", at: AT }).proximity;

    nearestServedKm.mockReturnValue(12);
    const far = scoreParts(provider(), { area: "lalitpur-4", at: AT }).proximity;

    expect(near).toBeGreaterThan(far);
  });

  /*
   * THE CASE THAT CATCHES THE BUG WORTH CATCHING. Both of these professionals are
   * OUTSIDE the chosen ward, so ward membership scored them both 0.6 — the one two
   * streets away and the one across the Valley. Distance has to separate them, and the
   * near one has to beat what ward membership would have given either.
   */
  it("separates two professionals a ward boundary used to flatten", async () => {
    const { scoreParts } = await import("@/lib/data/ranking");

    nearestServedKm.mockReturnValue(0.8);
    const nextStreet = scoreParts(provider(["lalitpur-3"]), {
      area: "lalitpur-4",
      at: AT,
    }).proximity;

    nearestServedKm.mockReturnValue(13);
    const acrossTheValley = scoreParts(provider(["bhaktapur-4"]), {
      area: "lalitpur-4",
      at: AT,
    }).proximity;

    expect(nextStreet).toBeGreaterThan(0.6);
    expect(acrossTheValley).toBeLessThan(0.6);
  });

  /*
   * DISTANCE IS NEVER A FILTER. Somebody 40 km away still has a score — they still
   * appear, still rank and can still be booked. `jobFit` decides who is shown; this
   * decides only order, which is the same reason being outside the ward is deliberately
   * not a `jobFit` reason.
   */
  it("floors at zero rather than going negative", async () => {
    const { scoreParts } = await import("@/lib/data/ranking");
    nearestServedKm.mockReturnValue(400);
    expect(
      scoreParts(provider(), { area: "lalitpur-4", at: AT }).proximity,
    ).toBe(0);
  });

  /*
   * AND THE MEASUREMENT OUTRANKS THE WARD, which is the branch order. A professional
   * whose ward matches exactly but whose nearest served centre is 10 km from the pin
   * should not keep the free 1.0 that ward membership handed them.
   */
  it("does not let a ward match override a measured distance", async () => {
    const { scoreParts } = await import("@/lib/data/ranking");
    nearestServedKm.mockReturnValue(10);
    expect(
      scoreParts(provider(["lalitpur-4"]), { area: "lalitpur-4", at: AT })
        .proximity,
    ).toBeLessThan(1);
  });
});
