import { describe, expect, it, beforeEach } from "vitest";
import jpeg from "jpeg-js";
import "fake-indexeddb/auto";

import { readExifTaken } from "@/lib/photos/exif";
import {
  QUEUED_PHOTO_TTL_DAYS,
  discardPhoto,
  freshEnough,
  hasQueuedPhoto,
  queuePhoto,
  takeQueuedPhoto,
} from "@/lib/pwa/photo-queue";

/**
 * A photograph taken with no signal survives the wait, with its camera clock.
 *
 * THE ONE ASSERTION THAT MATTERS IS THE EXIF. `lib/photos/evidence.ts` REFUSES a
 * photograph with no camera time — `noCameraTime`, one of its three refusals —
 * so a queue that re-encoded on the way in, or stored the pixels rather than
 * the file, would hold something our own gate then rejects. The professional
 * would believe they had sent evidence of a wasted trip and would have sent
 * nothing. So the bytes are put through the queue and the capture time is read
 * out of what comes back, rather than the blob merely being compared for size.
 */

/**
 * A JPEG carrying a real APP1/Exif block with DateTimeOriginal, big-endian.
 *
 * The same construction as `tests/unit/photo-capture-source.test.ts`, and
 * deliberately a real one: `DateTimeOriginal` (0x9003) lives in the EXIF
 * sub-IFD that IFD0 points at through tag 0x8769, so a fixture that put it in
 * IFD0 would test a layout no camera writes.
 */
function withCaptureTime(text: string): Uint8Array<ArrayBuffer> {
  const img = { data: new Uint8Array(32 * 32 * 4).fill(140), width: 32, height: 32 };
  const base = new Uint8Array(jpeg.encode(img, 85).data);

  const SUB_IFD_AT = 26;
  const STRING_AT = 44;

  const body: number[] = [];
  body.push(0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  body.push(0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8);
  body.push(0, 1);
  body.push(0x87, 0x69, 0, 4, 0, 0, 0, 1, 0, 0, 0, SUB_IFD_AT);
  body.push(0, 0, 0, 0);
  body.push(0, 1);
  body.push(0x90, 0x03, 0, 2, 0, 0, 0, 20, 0, 0, 0, STRING_AT);
  body.push(0, 0, 0, 0);
  for (const c of `${text}\0`) body.push(c.charCodeAt(0));

  const length = body.length + 2;
  const app1 = new Uint8Array([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...body]);
  const out = new Uint8Array(new ArrayBuffer(base.length + app1.length));
  out.set(base.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(base.subarray(2), 2 + app1.length);
  return out;
}

/** Find the APP1 segment the way the server does, then read it. */
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

const BOOKING = "9f1c2d3e-0000-4000-8000-000000000000";

describe("a photograph held on the device", () => {
  beforeEach(async () => {
    await discardPhoto(BOOKING);
  });

  it("comes back with the camera clock it went in with", async () => {
    const bytes = withCaptureTime("2026:10:05 10:00:00");
    // The fixture is only worth anything if the reader can read it to begin
    // with — otherwise "null after the queue" would pass for the wrong reason.
    expect(captureTimeOf(bytes)?.toISOString()).toBe("2026-10-05T10:00:00.000Z");

    await queuePhoto(BOOKING, new Blob([bytes], { type: "image/jpeg" }));
    const back = await takeQueuedPhoto(BOOKING);
    expect(back).not.toBeNull();

    const returned = new Uint8Array(await back!.arrayBuffer());
    expect(captureTimeOf(returned)?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("returns the bytes unchanged, not merely a readable image", () => {
    /*
     * BYTE-FOR-BYTE, because "it still has EXIF" is satisfied by a re-encode
     * that happens to copy the tag across, and the duplicate-detection hash in
     * `lib/photos/hash.ts` is over the file. A photograph that changed on the
     * way through would stop matching itself.
     */
    const bytes = withCaptureTime("2026:10:05 10:00:00");
    return queuePhoto(BOOKING, new Blob([bytes], { type: "image/jpeg" }))
      .then(() => takeQueuedPhoto(BOOKING))
      .then(async (back) => {
        const returned = new Uint8Array(await back!.arrayBuffer());
        expect(returned.length).toBe(bytes.length);
        expect(Array.from(returned)).toEqual(Array.from(bytes));
      });
  });

  it("keeps one photograph per booking, the latest", async () => {
    // Somebody who retakes the picture before the connection returns means the
    // second one. Two stored would send two photographs for one arrival.
    await queuePhoto(BOOKING, new Blob([withCaptureTime("2026:10:05 10:00:00")], { type: "image/jpeg" }));
    await queuePhoto(BOOKING, new Blob([withCaptureTime("2026:10:05 11:30:00")], { type: "image/jpeg" }));

    const back = await takeQueuedPhoto(BOOKING);
    const returned = new Uint8Array(await back!.arrayBuffer());
    expect(captureTimeOf(returned)?.toISOString()).toBe("2026-10-05T11:30:00.000Z");
  });

  it("is forgotten once it has been sent", async () => {
    await queuePhoto(BOOKING, new Blob([withCaptureTime("2026:10:05 10:00:00")], { type: "image/jpeg" }));
    expect(await hasQueuedPhoto(BOOKING)).toBe(true);
    await discardPhoto(BOOKING);
    expect(await hasQueuedPhoto(BOOKING)).toBe(false);
    expect(await takeQueuedPhoto(BOOKING)).toBeNull();
  });

  it("holds nothing for a booking nobody queued one for", async () => {
    expect(await takeQueuedPhoto("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("how long it is worth holding", () => {
  /*
   * THE WINDOW IS TESTED BY THE NUMBER RATHER THAN AGAINST THE CONSTANT, which
   * is `ACTIVITY_FLOOR`'s lesson: a case written as `TTL - 1` stays green when
   * the window is changed to an hour and asserts only that the window is the
   * window. What the rule actually says is that a week-old photograph is still
   * worth sending and a fortnight-old one is not.
   */
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 9, 15);

  it("holds one for a week", () => {
    expect(freshEnough(now - 6 * day, now)).toBe(true);
    expect(freshEnough(now - 7 * day + 1000, now)).toBe(true);
  });

  it("drops one older than that", () => {
    /*
     * It is refused at the far end anyway — `CLAIM_FRESHNESS_WINDOW_DAYS` is 7,
     * so a photograph whose own clock puts it more than a week before the claim
     * is declined. Holding it longer is holding bytes the server will reject.
     */
    expect(freshEnough(now - 8 * day, now)).toBe(false);
    expect(freshEnough(now - 30 * day, now)).toBe(false);
  });

  it("matches the claim window it is anchored to", () => {
    expect(QUEUED_PHOTO_TTL_DAYS).toBe(7);
  });

  it("treats a future stamp as now rather than as fresh for ever", () => {
    // A phone whose clock is set years ahead must not buy an unlimited hold.
    expect(freshEnough(now + 400 * day, now)).toBe(true);
    expect(freshEnough(Number.NaN, now)).toBe(false);
  });

  it("drops an expired photograph on the way out", async () => {
    const booking = "11111111-0000-4000-8000-000000000000";
    await queuePhoto(booking, new Blob([withCaptureTime("2026:01:01 10:00:00")], { type: "image/jpeg" }));
    const later = Date.now() + 30 * day;
    expect(await takeQueuedPhoto(booking, later)).toBeNull();
    // And it is gone rather than merely refused, so it stops taking up room.
    expect(await takeQueuedPhoto(booking)).toBeNull();
  });
});
