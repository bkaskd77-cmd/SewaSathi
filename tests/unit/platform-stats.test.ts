import { describe, expect, it } from "vitest";

import { STAT_FLOORS } from "@/lib/config/platform";
import { RATING_PRIOR_COUNT } from "@/lib/provider";

/**
 * The numbers on the front of the product.
 *
 * WHAT THESE EXIST TO STOP. The strip claimed "1,200+ ID-verified
 * professionals" and "Average rating 4.8 from 10,000+ households" against 28
 * fixtures and no completed bookings — the first thing on the page and the
 * specific claim the product asked to be trusted on.
 *
 * AND THE SECOND, SUBTLER FAILURE. Reading the live database while designing
 * this found that 26 of the 28 "verified" professionals were seeded. A floor of
 * 25 would have PASSED, and the page would have said "28 ID-verified
 * professionals" — a smaller lie, arrived at carefully. The filter has to come
 * before the floor, and this file is where that stays true.
 */

/** The same arithmetic `platformStats` does, against rows we control. */
function decide(rows: {
  providers: Array<{ verified: boolean; hasApplication: boolean; removed?: boolean }>;
  completedBookingCustomers: string[];
  rated: Array<{ avg: number; count: number }>;
}) {
  const professionals = rows.providers.filter(
    (p) => p.verified && p.hasApplication && !p.removed,
  ).length;
  const households = new Set(rows.completedBookingCustomers).size;
  const ratedJobs = rows.rated.reduce((n, r) => n + r.count, 0);
  const ratingTotal = rows.rated.reduce((n, r) => n + r.avg * r.count, 0);

  return {
    professionals:
      professionals >= STAT_FLOORS.professionals ? professionals : null,
    households: households >= STAT_FLOORS.households ? households : null,
    rating:
      ratedJobs >= STAT_FLOORS.ratedJobs && ratedJobs > 0
        ? Math.round((ratingTotal / ratedJobs) * 10) / 10
        : null,
  };
}

const seeded = (n: number) =>
  Array.from({ length: n }, () => ({ verified: true, hasApplication: false }));
const real = (n: number) =>
  Array.from({ length: n }, () => ({ verified: true, hasApplication: true }));

describe("a count includes only professionals who are real", () => {
  it("counts nobody who never came through an application", () => {
    /*
     * THE ASSERTION THAT WOULD HAVE CAUGHT IT. 28 seeded fixtures, all marked
     * verified, is above the floor of 25 — so without this filter the landing
     * page says "28 ID-verified professionals" and every one of them is
     * invented.
     */
    const out = decide({
      providers: seeded(28),
      completedBookingCustomers: [],
      rated: [],
    });
    expect(out.professionals).toBeNull();
  });

  it("counts the real ones when there are enough of them", () => {
    const out = decide({
      providers: [...seeded(28), ...real(30)],
      completedBookingCustomers: [],
      rated: [],
    });
    // The 28 fixtures contribute nothing; the 30 real ones clear the floor.
    expect(out.professionals).toBe(30);
  });

  it("still shows nothing when the real ones are below the floor", () => {
    // Today's live database: two real professionals among twenty-eight rows.
    const out = decide({
      providers: [...seeded(28), ...real(2)],
      completedBookingCustomers: [],
      rated: [],
    });
    expect(out.professionals).toBeNull();
  });

  it("drops somebody who has been removed", () => {
    const out = decide({
      providers: Array.from({ length: 30 }, () => ({
        verified: true,
        hasApplication: true,
        removed: true,
      })),
      completedBookingCustomers: [],
      rated: [],
    });
    expect(out.professionals).toBeNull();
  });
});

describe("households are households, not jobs", () => {
  it("counts one customer once however often they book", () => {
    // Counting completed bookings instead would be the same overstatement in a
    // different column — and it is the easier query, so it is the likely one.
    const out = decide({
      providers: [],
      completedBookingCustomers: Array.from({ length: 200 }, () => "anita"),
      rated: [],
    });
    expect(out.households).toBeNull();
  });

  it("counts distinct customers above the floor", () => {
    const out = decide({
      providers: [],
      completedBookingCustomers: Array.from({ length: 120 }, (_, i) => `c${i}`),
      rated: [],
    });
    expect(out.households).toBe(120);
  });
});

describe("the rating needs evidence before it is one", () => {
  it("borrows its floor from the prior rather than inventing one", () => {
    /*
     * `RATING_PRIOR_COUNT` is the point at which a professional's own average
     * outweighs the prior. "Is this evidence yet" is the same question whether
     * it is asked about one listing or about the whole platform, so it is one
     * constant asked twice — a second number here would drift from it.
     */
    expect(STAT_FLOORS.ratedJobs).toBe(RATING_PRIOR_COUNT);
  });

  it("shows nothing on a handful of ratings", () => {
    const out = decide({
      providers: [],
      completedBookingCustomers: [],
      rated: [{ avg: 5, count: 3 }],
    });
    expect(out.rating).toBeNull();
  });

  it("weights by how many ratings each professional has", () => {
    /*
     * A mean of the averages would let somebody with three 5.0s pull the
     * platform figure as hard as somebody with two hundred at 4.6 — the same
     * mistake `bayesianRating` exists to stop, one level up.
     */
    const out = decide({
      providers: [],
      completedBookingCustomers: [],
      rated: [
        { avg: 5, count: 3 },
        { avg: 4.0, count: 97 },
      ],
    });
    // Weighted: (15 + 388) / 100 = 4.03. A plain mean would say 4.5.
    expect(out.rating).toBe(4.0);
  });
});

describe("at today's volumes the strip carries no numbers at all", () => {
  it("returns nothing for every figure", () => {
    // 2 real professionals, 1 household, 0 rated jobs — read from the live
    // database. Empty is the correct answer, and the strip is built for it.
    const out = decide({
      providers: [...seeded(28), ...real(2)],
      completedBookingCustomers: ["anita"],
      rated: [],
    });
    expect(out).toEqual({
      professionals: null,
      households: null,
      rating: null,
    });
  });
});
