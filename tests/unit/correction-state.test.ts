import { describe, expect, it } from "vitest";

import { canProposeCorrection, correctionState } from "@/lib/booking";

/**
 * Where a price correction has got to, and who may start one.
 *
 * Deliberately not `quoteState`. The two have the same four shapes and
 * different facts, and the database keeps them apart for a reason it states:
 * a banded booking that grows a survey stamp means some other path has started
 * treating it as a survey.
 */
describe("where a correction has got to", () => {
  it("is none when nobody has said anything", () => {
    expect(correctionState({})).toBe("none");
  });

  it("waits on the customer once the professional has spoken", () => {
    expect(
      correctionState({
        providerBandSlug: "pipe-work",
        providerBandAt: "2026-09-19T04:00:00Z",
      }),
    ).toBe("awaiting-answer");
  });

  it("reads the customer's answer either way", () => {
    const said = {
      providerBandSlug: "pipe-work",
      providerBandAt: "2026-09-19T04:00:00Z",
    };
    expect(
      correctionState({ ...said, bandChangeApprovedAt: "2026-09-19T04:05:00Z" }),
    ).toBe("agreed");
    expect(
      correctionState({ ...said, bandChangeDeclinedAt: "2026-09-19T04:05:00Z" }),
    ).toBe("refused");
  });

  it("survives the product being retired from the catalogue", () => {
    /*
     * THE STAMP IS THE EXISTENCE TEST, NOT THE SLUG.
     * `bookings_provider_band_slug_fkey` is `on delete set null`, so retiring a
     * product clears the slug and leaves the stamp. An answered correction must
     * not silently become "none" because somebody tidied a price list months
     * later — the answer is the record, and the money moved on it.
     */
    expect(
      correctionState({
        providerBandSlug: null,
        providerBandAt: "2026-09-19T04:00:00Z",
        bandChangeApprovedAt: "2026-09-19T04:05:00Z",
      }),
    ).toBe("agreed");
  });
});

describe("who may propose one", () => {
  const ok = { status: "accepted", state: "none" } as const;

  it("allows it once accepted and after setting off", () => {
    expect(canProposeCorrection(ok)).toBe(true);
    expect(canProposeCorrection({ ...ok, status: "en_route" })).toBe(true);
  });

  it("refuses it once work has started", () => {
    /*
     * The floor is already up. A price correction at that point is a support
     * call, not a tap — the same line lib/booking/cancellation.ts draws, and
     * `enforce_price_correction` refuses in_progress on an unanswered one
     * whatever this says.
     */
    expect(canProposeCorrection({ ...ok, status: "in_progress" })).toBe(false);
    expect(canProposeCorrection({ ...ok, status: "completed" })).toBe(false);
    expect(canProposeCorrection({ ...ok, status: "pending" })).toBe(false);
  });

  it("refuses a second one while the first is unanswered", () => {
    // Two questions and two prices on one booking.
    expect(canProposeCorrection({ ...ok, state: "awaiting-answer" })).toBe(false);
  });

  it("refuses one after an answer, either way", () => {
    expect(canProposeCorrection({ ...ok, state: "agreed" })).toBe(false);
    // Refused means the job is ending; there is nothing left to correct.
    expect(canProposeCorrection({ ...ok, state: "refused" })).toBe(false);
  });

  it("refuses one on a survey job", () => {
    // Its whole price arrives after the visit and it has no band to correct.
    expect(canProposeCorrection({ ...ok, quoteModel: "survey" })).toBe(false);
  });
});
