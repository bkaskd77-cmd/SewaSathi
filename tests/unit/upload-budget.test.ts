import { describe, expect, it } from "vitest";

import { TARGET_BYTES } from "@/lib/utils/image";

/**
 * The ceiling that broke every document upload, written down as a number.
 *
 * A server action argument is a request body and Next caps it. Base64 inflates
 * bytes by a third, so the budget and the ceiling are not the same number and
 * the gap between them is the whole safety margin. The application form
 * encoded at a fixed quality with no budget at all, so the framework refused
 * each upload before any of our code ran — nothing logged, no validation
 * message, just "that did not save".
 *
 * These assertions are about the arithmetic rather than the canvas, because
 * the canvas is not the part that was wrong.
 */

/** Must match `experimental.serverActions.bodySizeLimit` in next.config.mjs. */
const BODY_SIZE_LIMIT = 2 * 1024 * 1024;

/** Base64 is 4 bytes out for every 3 in. */
const base64Size = (bytes: number) => Math.ceil(bytes / 3) * 4;

describe("the upload byte budget", () => {
  it("fits inside the server action ceiling once base64 encoded", () => {
    expect(base64Size(TARGET_BYTES)).toBeLessThan(BODY_SIZE_LIMIT);
  });

  it("leaves room for the rest of the payload, not just the image", () => {
    // The action also carries an application id, a kind, a capture score and
    // an expiry date. A budget that only just fits is one bad phone away from
    // failing again.
    const headroom = BODY_SIZE_LIMIT - base64Size(TARGET_BYTES);
    expect(headroom).toBeGreaterThan(512 * 1024);
  });

  it("would have exceeded the old 1 MB default", () => {
    // The regression in one line: this is why it failed before the ceiling was
    // raised AND the budget applied. Either fix alone leaves it marginal.
    const oldDefault = 1024 * 1024;
    expect(base64Size(1_400_000)).toBeGreaterThan(oldDefault);
  });

  it("keeps a document photograph large enough to read", () => {
    // The opposite failure: compressing until a citizenship number is
    // illegible defeats the upload. 700 KB at 1600px is generous for a JPEG.
    expect(TARGET_BYTES).toBeGreaterThanOrEqual(500 * 1024);
  });
});
