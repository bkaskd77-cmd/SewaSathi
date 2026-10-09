import { describe, expect, it } from "vitest";

import {
  CLAIM_FRESHNESS_WINDOW_DAYS,
  CLAIM_FRESHNESS_WINDOW_MINUTES,
  MAX_CLAIM_PHOTOS,
  doubtsOnRow,
  inspectionRequired,
  judgeClaimEvidence,
  maxFailedChecksPerPeriod,
  type BookingPhotoMatch,
} from "@/lib/photos/evidence";
import type { DuplicateVerdict } from "@/lib/photos/duplicate";
import type { FreshnessVerdict } from "@/lib/photos/freshness";

/**
 * What a claim photograph is allowed to be, and what it is allowed to do.
 *
 * THE CASES ARE PHRASED AS WHAT SOMEBODY DID, not as inputs: "sent last month's
 * photograph", "sent a screenshot", "sent the same picture as the booking". A test that
 * reads as a truth table over four enums passes while the rule means something else.
 */

const prior = { hash: "0000000000000000", bookingId: "other", accountId: null };

function judge(input: {
  duplicate?: DuplicateVerdict;
  freshness?: FreshnessVerdict;
  before?: boolean | null;
  match?: BookingPhotoMatch;
}) {
  return judgeClaimEvidence({
    duplicate: input.duplicate ?? { kind: "unseen" },
    freshness: input.freshness ?? "fresh",
    takenBeforeCompletion: input.before === undefined ? false : input.before,
    bookingPhotoMatch: input.match ?? "different-picture",
  });
}

describe("the three hard rejects", () => {
  it("refuses a photograph we have already been sent on another job", () => {
    const verdict = judge({
      duplicate: { kind: "reject", distance: 2, match: prior },
    });
    expect(verdict).toEqual({ kind: "refused", reason: "alreadySent" });
  });

  it("refuses a photograph taken before the work finished", () => {
    expect(judge({ before: true })).toEqual({
      kind: "refused",
      reason: "beforeTheJob",
    });
  });

  it("refuses a file with no camera clock — a screenshot or a download", () => {
    expect(judge({ freshness: "no-capture-time", before: null })).toEqual({
      kind: "refused",
      reason: "noCameraTime",
    });
  });

  it("refuses a photograph it could not place against the job, rather than passing it", () => {
    /* Rule 6 on the money path: a capture time we have but a completion we do not means
       nothing was established, and a column saying otherwise would be manufactured. */
    expect(judge({ before: null })).toEqual({
      kind: "refused",
      reason: "notChecked",
    });
  });

  it("names the most specific finding when a photograph trips two of them", () => {
    /* Reused AND from before the job: "we have had this before" is the sentence that
       points at something, so it is the one given. The other is not extra evidence. */
    const verdict = judge({
      duplicate: { kind: "reject", distance: 0, match: prior },
      before: true,
      freshness: "no-capture-time",
    });
    expect(verdict).toEqual({ kind: "refused", reason: "alreadySent" });
  });
});

describe("the three doubts, which refuse nothing", () => {
  it("accepts a photograph whose camera clock is weeks out, and says so", () => {
    const verdict = judge({ freshness: "stale" });
    expect(verdict.kind).toBe("accepted");
    if (verdict.kind !== "accepted") return;
    expect(verdict.doubts).toEqual(["stale"]);
    expect(verdict.row.freshnessVerdict).toBe("stale");
  });

  it("accepts one near a photograph we hold, and keeps the distance as the evidence", () => {
    const verdict = judge({ duplicate: { kind: "flag", distance: 7, match: prior } });
    expect(verdict.kind).toBe("accepted");
    if (verdict.kind !== "accepted") return;
    expect(verdict.doubts).toEqual(["nearDuplicate"]);
    expect(verdict.row.duplicateDistance).toBe(7);
  });

  it("treats the booking's own photograph as a doubt, never a reject", () => {
    /* A dHash at distance 4 on a 9x8 grid is coarse enough that "the same tap, still
       dripping, photographed from the same spot" genuinely lands there. Refusing it would
       refuse the honest complaint that nothing changed. */
    const verdict = judge({ match: "same-picture" });
    expect(verdict.kind).toBe("accepted");
    if (verdict.kind !== "accepted") return;
    expect(verdict.doubts).toEqual(["sameAsBooking"]);
  });

  it("collects every doubt rather than stopping at the first", () => {
    const verdict = judge({
      freshness: "stale",
      duplicate: { kind: "flag", distance: 9, match: prior },
      match: "same-picture",
    });
    expect(verdict.kind).toBe("accepted");
    if (verdict.kind !== "accepted") return;
    expect(verdict.doubts).toEqual(["stale", "nearDuplicate", "sameAsBooking"]);
  });
});

describe("what is never a doubt", () => {
  it("does not hold our own missing booking photograph against the customer", () => {
    const verdict = judge({ match: "no-reference" });
    expect(verdict.kind).toBe("accepted");
    if (verdict.kind !== "accepted") return;
    expect(verdict.doubts).toEqual([]);
    expect(verdict.row.bookingPhotoMatch).toBe("no-reference");
  });

  it("does not turn a failed comparison into a doubt, and does not call it clean either", () => {
    /* `not-compared` is stored and shown, so nobody reads it as "we looked and it was
       new" — but it is our read that failed, so it cannot cost the customer a visit. */
    const verdict = judge({
      duplicate: { kind: "not-compared" },
      match: "not-compared",
    });
    expect(verdict.kind).toBe("accepted");
    if (verdict.kind !== "accepted") return;
    expect(verdict.doubts).toEqual([]);
    expect(verdict.row.duplicateVerdict).toBe("not-compared");
    expect(verdict.row.bookingPhotoMatch).toBe("not-compared");
  });

  it("treats the same picture twice on one job as a retry, not a reuse", () => {
    const verdict = judge({ duplicate: { kind: "retry", distance: 0 } });
    expect(verdict.kind).toBe("accepted");
    if (verdict.kind !== "accepted") return;
    expect(verdict.doubts).toEqual([]);
    expect(verdict.row.duplicateVerdict).toBe("retry");
  });
});

describe("reading the doubts back off a stored row", () => {
  it("is the same list the judgement produced, so a screen cannot form a second opinion", () => {
    const verdict = judge({
      freshness: "stale",
      duplicate: { kind: "flag", distance: 6, match: prior },
    });
    expect(verdict.kind).toBe("accepted");
    if (verdict.kind !== "accepted") return;
    expect(doubtsOnRow(verdict.row)).toEqual(verdict.doubts);
  });

  it("reads a row from before these columns as carrying no doubt we established", () => {
    /* Null is "not checked". It cannot gate money, because nothing was measured — and it
       is not printed as clean either; the screen says `not-compared` out loud. */
    expect(
      doubtsOnRow({
        duplicateVerdict: null,
        freshnessVerdict: null,
        bookingPhotoMatch: null,
      }),
    ).toEqual([]);
  });
});

describe("the one thing a doubt does", () => {
  it("asks for the visit before money goes back", () => {
    const gate = inspectionRequired({
      doubts: ["stale"],
      verdict: null,
      status: "open",
    });
    expect(gate).toEqual({ required: true, doubts: ["stale"] });
  });

  it("is satisfied by the in-person verdict and nothing else", () => {
    expect(
      inspectionRequired({
        doubts: ["stale"],
        verdict: "sameFault",
        status: "resolved",
      }).required,
    ).toBe(false);

    /* A verdict without the resolution, and a resolution without the verdict, are both
       short of somebody having been and found the same fault. */
    expect(
      inspectionRequired({
        doubts: ["stale"],
        verdict: "sameFault",
        status: "attended",
      }).required,
    ).toBe(true);
    expect(
      inspectionRequired({
        doubts: ["stale"],
        verdict: null,
        status: "resolved",
      }).required,
    ).toBe(true);
  });

  it("is not satisfied by a verdict that found something else", () => {
    for (const verdict of ["differentProblem", "nothingWrong", "customerCaused"] as const) {
      expect(
        inspectionRequired({ doubts: ["nearDuplicate"], verdict, status: "resolved" })
          .required,
      ).toBe(true);
    }
  });

  it("leaves a claim with no doubtful photograph exactly as it was", () => {
    /* The gate is conditional on the doubt, which is what keeps it narrow. A claim with
       no photograph at all — every claim before this phase — is untouched. */
    const gate = inspectionRequired({ doubts: [], verdict: null, status: "open" });
    expect(gate).toEqual({ required: false, doubts: [] });
  });

  it("does not repeat a doubt that two photographs both carried", () => {
    const gate = inspectionRequired({
      doubts: ["stale", "stale", "nearDuplicate"],
      verdict: null,
      status: "open",
    });
    expect(gate.doubts).toEqual(["stale", "nearDuplicate"]);
  });
});

describe("the numbers, stated rather than implied", () => {
  it("keeps the window in two units that cannot disagree", () => {
    expect(CLAIM_FRESHNESS_WINDOW_DAYS).toBe(7);
    expect(CLAIM_FRESHNESS_WINDOW_MINUTES).toBe(
      CLAIM_FRESHNESS_WINDOW_DAYS * 24 * 60,
    );
  });

  it("leaves the repeat-pattern rule unarmed", () => {
    /* `maxPaidClaimsPerPeriod`'s shape. Two claims exist in the whole history of this
       product and no photograph has ever been refused, so a number here would freeze a
       guess into the codebase as a standard. */
    expect(maxFailedChecksPerPeriod).toBeNull();
  });

  it("caps a claim at three photographs", () => {
    expect(MAX_CLAIM_PHOTOS).toBe(3);
  });
});
