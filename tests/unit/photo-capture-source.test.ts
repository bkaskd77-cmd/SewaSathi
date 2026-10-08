import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";

import { readExifTaken } from "@/lib/photos/exif";

/**
 * One EXIF reader, read from both ends.
 *
 * WHY IT IS SHARED AT ALL. The server reads the capture time off the original bytes of an
 * arrival photograph; the browser has to read it off a booking photograph BEFORE the canvas
 * resize, because a canvas re-encode destroys EXIF. Two implementations of a byte parser
 * would drift, and the place it would show is a timestamp disagreeing with itself depending
 * on which end read it.
 *
 * THE TWO ARE STILL NOT WORTH THE SAME, which no test can fix and which is why
 * `booking_photos.taken_at_source` exists. Bytes the server parsed are bytes the server
 * saw; a timestamp the browser sends is a number the browser chose.
 */

/**
 * A JPEG carrying a real APP1/Exif block with DateTimeOriginal, big-endian.
 *
 * THE SUB-IFD IS BUILT PROPERLY, which the first version of this fixture did not do — it
 * put `DateTimeOriginal` straight into IFD0 and the reader returned null, correctly.
 * `DateTimeOriginal` (0x9003) lives in the EXIF sub-IFD that IFD0 points at through tag
 * 0x8769; only `DateTime` (0x0132) sits in IFD0. A fixture that skipped that would have
 * tested a layout no camera writes.
 */
function withCaptureTime(text: string) {
  const img = { data: new Uint8Array(32 * 32 * 4).fill(140), width: 32, height: 32 };
  const base = new Uint8Array(jpeg.encode(img, 85).data);

  const SUB_IFD_AT = 26; // right after IFD0: 8 + (2 + 12 + 4)
  const STRING_AT = 44; // right after the sub-IFD: 26 + (2 + 12 + 4)

  const body: number[] = [];
  body.push(0x45, 0x78, 0x69, 0x66, 0x00, 0x00); // "Exif\0\0"
  body.push(0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8); // big-endian TIFF header, IFD0 at 8

  // IFD0: one entry, the pointer to the EXIF sub-IFD.
  body.push(0, 1);
  body.push(0x87, 0x69, 0, 4, 0, 0, 0, 1, 0, 0, 0, SUB_IFD_AT);
  body.push(0, 0, 0, 0);

  // The sub-IFD: one entry, DateTimeOriginal as 20 ASCII bytes held at an offset.
  body.push(0, 1);
  body.push(0x90, 0x03, 0, 2, 0, 0, 0, 20, 0, 0, 0, STRING_AT);
  body.push(0, 0, 0, 0);

  for (const c of `${text}\0`) body.push(c.charCodeAt(0));

  const length = body.length + 2;
  const app1 = new Uint8Array([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...body]);
  const out = new Uint8Array(base.length + app1.length);
  out.set(base.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(base.subarray(2), 2 + app1.length);
  return out;
}

/** Find the APP1 segment the way both callers do, then read it. */
function captureTimeOf(bytes: Uint8Array): Date | null {
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xda) return null;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xe1) {
      const taken = readExifTaken(bytes, at + 4, at + 2 + length);
      if (taken) return taken;
    }
    at += 2 + length;
  }
  return null;
}

describe("reading a camera clock out of a photograph", () => {
  it("reads DateTimeOriginal", () => {
    const taken = captureTimeOf(withCaptureTime("2026:10:05 10:00:00"));
    expect(taken?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  /*
   * A CAMERA WITH NO CLOCK SET WRITES ZEROES, and that is not a time. Treating it as one
   * would put a 1970 timestamp against a photograph and make every freshness check on it
   * read "stale" for a reason that has nothing to do with the photograph.
   */
  it("refuses a date a camera with no clock wrote", () => {
    expect(captureTimeOf(withCaptureTime("0000:00:00 00:00:00"))).toBeNull();
  });

  it("returns null for a photograph that carries no EXIF at all", () => {
    const plain = new Uint8Array(
      jpeg.encode({ data: new Uint8Array(32 * 32 * 4).fill(90), width: 32, height: 32 }, 85)
        .data,
    );
    expect(captureTimeOf(plain)).toBeNull();
  });

  /*
   * EVERY OFFSET IN THAT PARSER IS ATTACKER-CONTROLLED, so a truncated segment must come
   * back null rather than reading past the end of the buffer.
   */
  it("survives a truncated EXIF block", () => {
    const full = withCaptureTime("2026:10:05 10:00:00");
    for (const cut of [40, 60, 80]) {
      expect(() => captureTimeOf(full.subarray(0, cut))).not.toThrow();
    }
  });
});
