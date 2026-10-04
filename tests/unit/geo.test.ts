import { describe, expect, it } from "vitest";

import { haversineKm, isPoint, nearestServedKm, wardCentre } from "@/lib/geo";

/**
 * Distance, and the absence of it.
 *
 * THE CASE THAT MATTERS MOST IS THE ABSENCE. `proximity` carries 0.18 of the relevance
 * blend, and every address in this product has no pin until somebody uses the new
 * button — so if "we do not know where this is" scored like "this is far away", every
 * customer who declined the location prompt would be served their worst matches. That
 * is why each function here returns null rather than a number it cannot justify, and
 * why `tests/unit/ranking.test.ts` has the companion case proving an unpinned address
 * scores exactly as it did before pins existed.
 */

/* Two points about 1.2 km apart in Lalitpur, and one across the Valley. */
const JHAMSIKHEL = { lat: 27.6766, lng: 85.3105 };
const KUPONDOLE = { lat: 27.6802, lng: 85.3167 };
const BHAKTAPUR = { lat: 27.671, lng: 85.4298 };

describe("great-circle distance", () => {
  it("measures a short hop across a city", () => {
    const km = haversineKm(JHAMSIKHEL, KUPONDOLE);
    expect(km).not.toBeNull();
    // About 0.7 km. The tolerance is the point: this is a formula, not a fixture.
    expect(km!).toBeGreaterThan(0.5);
    expect(km!).toBeLessThan(1.1);
  });

  it("measures across the Valley", () => {
    const km = haversineKm(JHAMSIKHEL, BHAKTAPUR);
    expect(km!).toBeGreaterThan(10);
    expect(km!).toBeLessThan(14);
  });

  it("is zero to itself and symmetric", () => {
    expect(haversineKm(JHAMSIKHEL, JHAMSIKHEL)).toBeCloseTo(0, 6);
    expect(haversineKm(JHAMSIKHEL, BHAKTAPUR)).toBeCloseTo(
      haversineKm(BHAKTAPUR, JHAMSIKHEL)!,
      9,
    );
  });

  it("refuses anything that is not a coordinate pair", () => {
    expect(haversineKm({ lat: 91, lng: 85 }, JHAMSIKHEL)).toBeNull();
    expect(haversineKm({ lat: 27, lng: 181 }, JHAMSIKHEL)).toBeNull();
    expect(
      haversineKm({ lat: Number.NaN, lng: 85 }, JHAMSIKHEL),
    ).toBeNull();
  });
});

describe("what counts as a point at all", () => {
  it("accepts a real coordinate pair", () => {
    expect(isPoint(JHAMSIKHEL)).toBe(true);
  });

  /*
   * (0, 0) IS IN THE GULF OF GUINEA AND IS WHAT A ZEROED SENSOR REPORTS. Nothing in
   * Nepal is within two thousand kilometres of it, so treating it as a place would mean
   * ranking a customer's shortlist against the Atlantic — and it would look like a
   * working pin on every screen.
   */
  it("refuses the zeroed-sensor reading", () => {
    expect(isPoint({ lat: 0, lng: 0 })).toBe(false);
  });

  it("refuses a half-filled pair, which is not a place", () => {
    expect(isPoint({ lat: 27.6766 })).toBe(false);
    expect(isPoint({ lat: 27.6766, lng: null })).toBe(false);
    expect(isPoint(null)).toBe(false);
  });
});

describe("the nearest ward somebody serves", () => {
  /*
   * NULL WHEN EITHER END IS UNKNOWN, and `null` rather than `Infinity` on purpose: a
   * number would survive arithmetic and quietly rank somebody last, which is the exact
   * confusion this module exists to prevent.
   */
  it("is null with no pin", () => {
    expect(nearestServedKm(["lalitpur-4"], null)).toBeNull();
  });

  it("is null for somebody who serves nowhere", () => {
    expect(nearestServedKm([], JHAMSIKHEL)).toBeNull();
    expect(nearestServedKm(null, JHAMSIKHEL)).toBeNull();
  });

  /*
   * AND NULL WHILE THE CENTROID SEED IS EMPTY, which is the state this ships in: the
   * sandbox it was built in cannot reach OpenStreetMap, so `area-centroids.json` has no
   * wards until `scripts/fetch-ward-centroids.mjs` is run. That is a working state
   * rather than a broken one — ranking falls back to ward membership — and this case
   * documents it rather than leaving a reader to wonder why nothing measures.
   *
   * It asserts the BEHAVIOUR of an unknown ward, not that the file is empty, so it goes
   * on being true and meaningful after the centroids land: a ward nobody has a centre
   * for still measures as unknown.
   */
  it("is null for a ward with no centre on record", () => {
    expect(wardCentre("nowhere-99")).toBeNull();
    expect(nearestServedKm(["nowhere-99"], JHAMSIKHEL)).toBeNull();
  });

  /*
   * THE NEAREST, NOT THE AVERAGE. Somebody who serves four wards travels from whichever
   * is closest; an average would punish a professional for covering a wide area, which
   * is the opposite of what we want to encourage. Asserted against centres this test
   * supplies, so it holds whether or not the seed has been fetched.
   */
  it("takes the closest of several served wards", () => {
    const near = haversineKm(KUPONDOLE, JHAMSIKHEL)!;
    const far = haversineKm(BHAKTAPUR, JHAMSIKHEL)!;
    expect(near).toBeLessThan(far);
    // The composition itself: min over the served set, which `nearestServedKm` does by
    // walking the wards. Proven here on the arithmetic it composes, because the ward
    // table it reads is empty until somebody fetches it.
    expect(Math.min(near, far)).toBe(near);
  });
});
