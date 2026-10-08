import { describe, expect, it } from "vitest";

import {
  MAX_PHOTOS_PER_REQUEST,
  MAX_REJECTED_PHOTOS,
  hasSomethingToTriage,
  judgePhoto,
  photosFull,
} from "@/lib/ai/photo-retake";

/**
 * Asking for a better photo, and knowing when to stop.
 *
 * THE CASE THAT MATTERS MOST IS THE ONE THAT ASSERTS NOTHING HAPPENS. A photo verdict
 * must never block a booking and must never change an answer — it arrives beside the
 * triage result, not inside it — so the shape of this module is "ask, then stop asking",
 * and `closed` is a state in which the customer carries on with no photo at all.
 */
describe("asking for another photo", () => {
  const fresh = { rejected: 0 };

  it("keeps a photo that shows the problem, and forgets earlier refusals", () => {
    const after = judgePhoto({ relevance: "related", reason: null }, { rejected: 1 });
    expect(after.decision.kind).toBe("keep");
    // A customer who got it right has not been uncooperative.
    expect(after.next.rejected).toBe(0);
  });

  /*
   * SILENCE IS NOT A REJECTION. Null is "no photo, or nobody looked" — the fallback
   * answered, the call failed, the model said nothing. Making somebody retake a perfectly
   * good photo because our key expired is rule 6's shape for a judgement: not recorded is
   * not a finding.
   */
  it("keeps a photo nobody judged", () => {
    expect(judgePhoto(null, fresh).decision.kind).toBe("keep");
    expect(judgePhoto(undefined, fresh).decision.kind).toBe("keep");
  });

  it("asks again on the first unrelated photo, carrying the model's own reason", () => {
    const after = judgePhoto(
      { relevance: "unrelated", reason: "this looks like a window, not a tap" },
      fresh,
    );
    expect(after.decision).toEqual({
      kind: "retake",
      relevance: "unrelated",
      reason: "this looks like a window, not a tap",
    });
    expect(after.next.rejected).toBe(1);
  });

  /*
   * TWO TRIES, THEN THE OFFER CLOSES. A third "that is not it" is an argument with
   * somebody trying to report a broken tap, and the professional's on-site correction
   * already fixes a misleading photo.
   */
  it("closes the offer on the second, and the booking carries on", () => {
    const first = judgePhoto({ relevance: "unrelated", reason: "a receipt" }, fresh);
    const second = judgePhoto({ relevance: "unclear", reason: "too dark" }, first.next);

    expect(first.decision.kind).toBe("retake");
    expect(second.decision.kind).toBe("closed");
    expect(MAX_REJECTED_PHOTOS).toBe(2);
  });

  /*
   * `unclear` COUNTS AND IS STILL TOLD APART FROM `unrelated`. Both cost the same two
   * attempts, because the alternative is an unbounded loop with somebody in a dim
   * bathroom — but "I cannot tell what this shows" and "this is a different thing" ask
   * for different photos, and collapsing them would tell somebody with a dark photo that
   * they had photographed the wrong tap.
   */
  it("counts an unclear photo but keeps it distinguishable", () => {
    const after = judgePhoto({ relevance: "unclear", reason: "too dark to read" }, fresh);
    expect(after.decision.kind).toBe("retake");
    expect(after.decision.kind === "retake" && after.decision.relevance).toBe("unclear");
    expect(after.next.rejected).toBe(1);
  });

  it("lets a request carry three photos and no more", () => {
    expect(photosFull(MAX_PHOTOS_PER_REQUEST - 1)).toBe(false);
    expect(photosFull(MAX_PHOTOS_PER_REQUEST)).toBe(true);
    expect(MAX_PHOTOS_PER_REQUEST).toBe(3);
  });
});

/**
 * Whether there is anything to triage, which the banana found out the hard way.
 *
 * A customer attached a photograph of fruit, typed nothing, and the product answered
 * "Plumbing · Needed soon · Rs 900 – Rs 4,000". The photo check had worked and said so on
 * screen; the priced recommendation sat underneath it anyway, because `TriageResult`
 * requires a category and `GENERIC_RULE` is plumbing.
 */
describe("whether there is anything to triage", () => {
  const unrelated = { relevance: "unrelated" as const, reason: "bananas in a bag" };
  const unclear = { relevance: "unclear" as const, reason: "too dark" };
  const related = { relevance: "related" as const, reason: null };

  it("shows nothing priced for an unrelated photo and no words", () => {
    expect(
      hasSomethingToTriage({ text: "", verdict: unrelated, urgency: "soon" }),
    ).toBe(false);
  });

  it("treats an unreadable photo with no words the same way", () => {
    expect(
      hasSomethingToTriage({ text: "   ", verdict: unclear, urgency: "routine" }),
    ).toBe(false);
  });

  /* Words are evidence. The photograph being wrong does not make the sentence wrong. */
  it("still answers when the customer typed something", () => {
    expect(
      hasSomethingToTriage({ text: "tap is leaking", verdict: unrelated, urgency: "soon" }),
    ).toBe(true);
  });

  it("answers from a photo that showed the problem", () => {
    expect(hasSomethingToTriage({ text: "", verdict: related, urgency: "soon" })).toBe(true);
  });

  /*
   * NOBODY JUDGED IT IS NOT THE SAME AS JUDGED BADLY. The fallback answered, the key
   * expired, the model said nothing — none of those is evidence that the photograph was
   * useless, and withholding the answer would punish a customer for our outage.
   */
  it("answers when no verdict was recorded at all", () => {
    expect(hasSomethingToTriage({ text: "", verdict: null, urgency: "soon" })).toBe(true);
  });

  /*
   * THE ONE THAT MUST NEVER BE SUPPRESSED. Somebody photographing a sparking board and
   * typing nothing is exactly what the photo hazard read exists for. An unrelated verdict
   * must not hide an emergency.
   */
  it("never hides an emergency, whatever the photo was judged to be", () => {
    expect(
      hasSomethingToTriage({ text: "", verdict: unrelated, urgency: "emergency" }),
    ).toBe(true);
    expect(
      hasSomethingToTriage({ text: "", verdict: unclear, urgency: "emergency" }),
    ).toBe(true);
  });
});
