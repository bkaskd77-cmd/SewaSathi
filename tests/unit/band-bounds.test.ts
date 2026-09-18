import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { bandBounds, BAND_SOURCES, correctionFitsFloor } from "@/lib/booking";
import { judgeFinalAmount } from "@/lib/payments/pricing";

/**
 * Which price is in force, and what the 2x ceiling is measured off.
 *
 * THE DEFECT THIS CLOSES. The triage card asks which product a job is and
 * prints that product's published range; the number was then lost at the first
 * link, because `/services/[slug]` rendered the trade's whole band and
 * `createBooking` froze `categories.base_price_max`. Somebody who answered "AC
 * repair" read 500-1,500 and was quoted 500-12,000, with the ceiling at 24,000.
 *
 * `judgeFinalAmount` is unchanged and never sees two bands. It takes one frozen
 * pair; everything here is about which pair reaches it.
 */

const PLUMBING = { low: 350, high: 6000 };
const LEAK = { slug: "leak", low: 500, high: 1200 };
const PIPE_WORK = { slug: "pipe-work", low: 1500, high: 3000 };
const INSPECTION = { slug: "inspection", low: 350, high: 600 };

describe("which band is in force", () => {
  it("falls back to the trade when nobody named a product", () => {
    expect(bandBounds({ category: PLUMBING })).toMatchObject({
      low: 350,
      high: 6000,
      source: "category",
    });
  });

  it("narrows to the product the customer named", () => {
    expect(
      bandBounds({
        category: PLUMBING,
        stated: LEAK,
        statedSource: "customer",
      }),
    ).toMatchObject({ low: 500, high: 1200, statedLow: 500, source: "stated" });
  });

  it("does NOT narrow for a band we guessed", () => {
    /*
     * `model` and `matcher` are both our reading of somebody's sentence.
     * Trusting the slug over the number the same model produced makes the price
     * WRONG rather than merely wide, and wide is the failure we already know
     * how to live with.
     */
    for (const source of ["model", "matcher"] as const) {
      expect(
        bandBounds({ category: PLUMBING, stated: LEAK, statedSource: source }),
      ).toMatchObject({ low: 350, high: 6000, source: "category" });
    }
  });

  it("ignores a correction nobody has agreed to", () => {
    expect(
      bandBounds({
        category: PLUMBING,
        stated: LEAK,
        statedSource: "customer",
        corrected: PIPE_WORK,
        correctionApproved: false,
      }),
    ).toMatchObject({ high: 1200, source: "stated" });
  });

  it("takes an agreed correction over the customer's own statement", () => {
    expect(
      bandBounds({
        category: PLUMBING,
        stated: LEAK,
        statedSource: "customer",
        corrected: PIPE_WORK,
        correctionApproved: true,
      }),
    ).toMatchObject({ low: 1500, high: 3000, source: "corrected" });
  });

  it("keeps the stated floor visible under an agreed correction", () => {
    // It is what the floor rule is measured against, so it survives the
    // correction rather than being replaced by it.
    expect(
      bandBounds({
        category: PLUMBING,
        stated: PIPE_WORK,
        statedSource: "customer",
        corrected: LEAK,
        correctionApproved: true,
      }).statedLow,
    ).toBe(1500);
  });
});

describe("what the 2x ceiling is measured off", () => {
  const ceiling = (bounds: { low: number; high: number }, amount: number) =>
    judgeFinalAmount(amount, { min: bounds.low, max: bounds.high }).outcome;

  it("was 24,000 on a trade band and is 2,400 on the product", () => {
    /*
     * THE WHOLE POINT, AS A NUMBER. 2x is chosen so an honest overrun fits and
     * a mistyped extra zero cannot. Measured off a 10-13x trade band it does
     * neither: on plumbing, 4,000 for a tap leak sailed through as
     * "within-band" and nobody was asked anything.
     */
    expect(ceiling(PLUMBING, 4000)).toBe("within-band");

    const narrowed = bandBounds({
      category: PLUMBING,
      stated: LEAK,
      statedSource: "customer",
    });
    expect(ceiling(narrowed, 4000)).toBe("blocked");
    expect(ceiling(narrowed, 1500)).toBe("needs-approval");
    expect(ceiling(narrowed, 1100)).toBe("within-band");
  });

  it("moves with an agreed correction, so an honest overrun stays approvable", () => {
    /*
     * The other direction, and it matters as much. A customer who understated
     * the product would otherwise put an honest professional above a ceiling
     * nothing could approve — which teaches everybody to settle off-platform.
     */
    const stated = bandBounds({
      category: PLUMBING,
      stated: LEAK,
      statedSource: "customer",
    });
    expect(ceiling(stated, 2800)).toBe("blocked");

    const agreed = bandBounds({
      category: PLUMBING,
      stated: LEAK,
      statedSource: "customer",
      corrected: PIPE_WORK,
      correctionApproved: true,
    });
    expect(ceiling(agreed, 2800)).toBe("within-band");
  });
});

describe("a correction cannot price the job under the customer's statement", () => {
  it("refuses one whose whole range sits below the stated floor", () => {
    // The fee is charged on max(final_amount, quoted_min). A correction that
    // could lower that floor lets a professional name a cheaper PRODUCT
    // instead of a smaller number.
    expect(correctionFitsFloor(INSPECTION, PIPE_WORK.low)).toBe(false);
  });

  it("allows one that overlaps it", () => {
    // A real disagreement about which product this is, rather than a move on
    // the commission basis.
    expect(correctionFitsFloor(PIPE_WORK, LEAK.low)).toBe(true);
    expect(correctionFitsFloor(LEAK, LEAK.low)).toBe(true);
  });
});

/**
 * The value the ask actually sends has to be one the booking accepts.
 *
 * A LIVE BUG, FOUND WHILE INSTRUMENTING THE ASK. The sub-band ask shipped
 * writing `bandSource=customer` into the booking query string, and
 * `createBooking`'s schema accepted only `model` and `matcher` — so the parse
 * failed and the booking came back as a validation error, on the one path the
 * ask exists to improve. Every guard AROUND the band held: the check constraint
 * admitted `customer`, the immutability trigger refused browser writes, the
 * bounds function narrowed correctly. The schema that decides whether the
 * booking happens at all was the one thing nobody widened.
 *
 * Pinned here because the two live in different files and nothing else makes
 * them agree.
 */
describe("every band source the product emits is one a booking accepts", () => {
  it("names all three, in one place", () => {
    // `createBooking`'s zod enum is built from this array and the card writes
    // one of its values, so they cannot disagree again.
    expect([...BAND_SOURCES]).toEqual(["model", "matcher", "customer"]);
  });

  it("is what the booking schema validates against", () => {
    /*
     * `lib/data/bookings` cannot be imported here — it wraps reads in React's
     * cache(), which only exists in a server runtime, the same constraint
     * lib/ai/price-bands documents. So the agreement is asserted on the source:
     * the schema must build its enum FROM the array rather than restating it.
     */
    const src = readFileSync("lib/data/bookings.ts", "utf8");
    expect(src).toContain("z.enum(BAND_SOURCES)");
    expect(src).not.toMatch(/z\.enum\(\s*\[\s*"model"/);
  });
});
