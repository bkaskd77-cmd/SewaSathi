import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import {
  bandBounds,
  BAND_SOURCES,
  REQUESTABLE_BAND_SOURCES,
  canNameBand,
  canProposeCorrection,
  correctionFitsFloor,
} from "@/lib/booking";
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
  it("names every value the column may hold, in one place", () => {
    expect([...BAND_SOURCES]).toEqual([
      "model",
      "matcher",
      "customer",
      "inherited",
      "professional",
    ]);
  });

  /**
   * AND WHAT A BROWSER MAY CLAIM IS A SMALLER LIST, which is the lesson this
   * case learned the second time.
   *
   * These were one array, and `createBooking`'s enum was built from it. Adding
   * `inherited` for the COLUMN's sake — a guarantee visit copying the band of
   * the job it is putting right — would silently have let any browser assert
   * that its own fresh booking was inherited. Same shape as the bug the
   * comment above records, with the direction reversed: there a schema nobody
   * widened refused a real value, here a schema widened for free would have
   * accepted a false one.
   *
   * `inherited` is written by `lib/data/claims.ts` under the service role and
   * nowhere else. The actor comes from the session, never from the caller.
   */
  it("does not let a browser claim a source only the server writes", () => {
    expect([...REQUESTABLE_BAND_SOURCES]).toEqual([
      "model",
      "matcher",
      "customer",
    ]);
    expect(
      REQUESTABLE_BAND_SOURCES as readonly string[],
      "a booking request must never be able to assert inherited provenance",
    ).not.toContain("inherited");
    /*
     * `professional` is out for the same reason and not a weaker one: it is the
     * most trustworthy provenance the column has — somebody who stood in the
     * room after the work — and a booking POST claiming it would be a customer
     * asserting the best possible evidence about their own price.
     */
    expect(
      REQUESTABLE_BAND_SOURCES as readonly string[],
      "a booking request must never be able to assert a professional's reading",
    ).not.toContain("professional");
  });

  it("keeps the requestable set inside the column's domain", () => {
    for (const source of REQUESTABLE_BAND_SOURCES) {
      expect(BAND_SOURCES as readonly string[]).toContain(source);
    }
  });

  it("is what the booking schema validates against", () => {
    /*
     * `lib/data/bookings` cannot be imported here — it wraps reads in React's
     * cache(), which only exists in a server runtime, the same constraint
     * lib/ai/price-bands documents. So the agreement is asserted on the source:
     * the schema must build its enum FROM the array rather than restating it.
     */
    const src = readFileSync("lib/data/bookings.ts", "utf8");
    expect(src).toContain("z.enum(REQUESTABLE_BAND_SOURCES)");
    expect(src).not.toMatch(/z\.enum\(\s*\[\s*"model"/);
  });
});

/**
 * When the professional may name a job nobody classified.
 *
 * TWO HALVES, AND BOTH MATTER. Nobody named it — otherwise this would be a
 * record of who answered last rather than a provenance, and a professional who
 * thinks the product is WRONG has `canProposeCorrection`, which moves the band
 * and asks the customer because that is a question about money. And after the
 * work — before `in_progress` the professional is guessing from the same
 * description the customer wrote, which is exactly what the model already did.
 */
describe("the professional names a job nobody classified", () => {
  const job = { status: "completed", bandSlug: null, quoteModel: null };

  it("asks once the work has started, and not before", () => {
    for (const status of ["pending", "accepted", "en_route"]) {
      expect(canNameBand({ ...job, status })).toBe(false);
    }
    expect(canNameBand({ ...job, status: "in_progress" })).toBe(true);
    expect(canNameBand({ ...job, status: "completed" })).toBe(true);
  });

  /*
   * A FINISHED JOB STAYS OPEN, deliberately. This is the one chance: nothing
   * else will ever ask, and a classification does not go stale the way a price
   * does. The alternative — closing it at completion — means the answer is lost
   * if the professional puts the phone away before tapping.
   */
  it("still asks on a job that is over", () => {
    expect(canNameBand({ ...job, status: "completed" })).toBe(true);
  });

  it("never asks about a job that already has a product", () => {
    expect(canNameBand({ ...job, bandSlug: "leak" })).toBe(false);
    expect(
      canNameBand({ status: "in_progress", bandSlug: "leak", quoteModel: null }),
    ).toBe(false);
  });

  /* A survey trade sells no products, so there is nothing to choose between —
     the same exclusion `bandCoverage` makes from its denominator. */
  it("never asks on a survey job", () => {
    expect(canNameBand({ ...job, quoteModel: "survey" })).toBe(false);
  });

  /*
   * THE TWO WINDOWS DO NOT OVERLAP, and that is what keeps the two panels from
   * both appearing on one card. A correction argues with a stated product and
   * runs before work starts; naming needs a null product and runs after.
   */
  it("never opens at the same time as a price correction", () => {
    for (const status of [
      "pending",
      "accepted",
      "en_route",
      "in_progress",
      "completed",
    ]) {
      for (const bandSlug of [null, "leak"]) {
        const naming = canNameBand({ status, bandSlug, quoteModel: null });
        const correcting = canProposeCorrection({
          status,
          state: "none",
          quoteModel: null,
        });
        expect(naming && correcting).toBe(false);
      }
    }
  });
});
