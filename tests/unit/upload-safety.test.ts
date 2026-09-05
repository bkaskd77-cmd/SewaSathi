import { describe, expect, it } from "vitest";

import {
  checkUploadedImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
} from "@/lib/security/image";

/**
 * What the server will accept as a photograph.
 *
 * The attack this defends against is not exotic: a server action takes base64
 * from the browser and stores it labelled `image/jpeg`. Everything that says
 * it is a photo — the file extension, the content type, the compressor that
 * produced it — is a thing the caller controls. The first bytes of the file
 * are not.
 *
 * And the quieter one: a photograph taken in somebody's kitchen carries the
 * GPS coordinates of that kitchen, and we hand it to a stranger who is about
 * to visit.
 */

/** A minimal but real JPEG: SOI, an APP1 block, a frame header, SOS, EOI. */
function jpeg(options: { width?: number; height?: number; exif?: boolean } = {}) {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const parts: number[] = [0xff, 0xd8];

  if (options.exif !== false) {
    // APP1 carrying "Exif\0\0" and a recognisable payload standing in for a
    // GPS block — this is the thing that must not survive.
    const payload = [
      ...[0x45, 0x78, 0x69, 0x66, 0x00, 0x00],
      ...Array.from("GPSLatitude 27.7172 GPSLongitude 85.3240").map((c) =>
        c.charCodeAt(0),
      ),
    ];
    const length = payload.length + 2;
    parts.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
  }

  // SOF0: length(2) precision(1) height(2) width(2) components(1) + 3 per comp
  parts.push(
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  );
  // SOS, then some entropy-coded nonsense, then EOI.
  parts.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  parts.push(0x12, 0x34, 0x56, 0x78, 0xff, 0xd9);

  return Buffer.from(Uint8Array.from(parts)).toString("base64");
}

const asBase64 = (bytes: number[]) =>
  Buffer.from(Uint8Array.from([...bytes, ...new Array(64).fill(0)])).toString(
    "base64",
  );

describe("the file has to actually be a photograph", () => {
  it("accepts a real JPEG and reads its size from the file itself", () => {
    const result = checkUploadedImage(jpeg({ width: 1200, height: 900 }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.width).toBe(1200);
    expect(result.ok && result.height).toBe(900);
  });

  it("refuses a PNG, however it was labelled", () => {
    // The bucket says image/jpeg and the uploader says image/jpeg. Neither of
    // them looked.
    const png = asBase64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(checkUploadedImage(png)).toEqual({
      ok: false,
      reason: "unsupportedFormat",
    });
  });

  it("refuses a GIF and a WebP for the same reason", () => {
    const gif = asBase64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const webp = asBase64([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(!checkUploadedImage(gif).ok).toBe(true);
    expect(!checkUploadedImage(webp).ok).toBe(true);
  });

  it("refuses something that is not an image at all", () => {
    // An HTML file stored under a .jpg path and served with a content type
    // somebody else's browser might sniff.
    const html = Buffer.from("<script>alert(1)</script>").toString("base64");
    expect(checkUploadedImage(html)).toEqual({
      ok: false,
      reason: "notAnImage",
    });
  });

  it("refuses a JPEG header with nothing behind it", () => {
    const truncated = Buffer.from(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    ).toString("base64");
    expect(!checkUploadedImage(truncated).ok).toBe(true);
  });
});

describe("size is checked before anything is allocated", () => {
  it("refuses an oversized payload by its length, not by decoding it", () => {
    // The point is that this returns rather than allocating 50MB first.
    const huge = "A".repeat(Math.ceil((MAX_IMAGE_BYTES / 3) * 4) + 4096);
    expect(checkUploadedImage(huge)).toEqual({ ok: false, reason: "tooLarge" });
  });

  it("refuses a picture with too many pixels even when the file is small", () => {
    // A 40-megapixel photograph of a flat wall compresses to nothing and still
    // takes a cheap phone's browser down when it renders.
    const enormous = jpeg({ width: MAX_IMAGE_EDGE + 1, height: 100 });
    expect(checkUploadedImage(enormous)).toEqual({
      ok: false,
      reason: "tooManyPixels",
    });
  });
});

describe("the location of somebody's kitchen does not get stored", () => {
  it("strips the EXIF block out of what is handed back", () => {
    const withExif = jpeg({ exif: true });
    const result = checkUploadedImage(withExif);

    expect(result.ok).toBe(true);
    const stored = Buffer.from(result.ok ? result.bytes : []).toString("latin1");
    expect(stored).not.toContain("Exif");
    expect(stored).not.toContain("GPSLatitude");
  });

  it("keeps the picture itself", () => {
    // Stripping metadata must not strip the image. The scan data after SOS is
    // the photograph, and it has to survive intact.
    const result = checkUploadedImage(jpeg({ exif: true }));
    const stored = Buffer.from(result.ok ? result.bytes : []);
    expect(stored[0]).toBe(0xff);
    expect(stored[1]).toBe(0xd8);
    expect(stored.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(stored.includes(Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true);
  });

  it("makes the stored file smaller than the one that arrived", () => {
    const withExif = jpeg({ exif: true });
    const result = checkUploadedImage(withExif);
    expect(result.ok && result.bytes.byteLength).toBeLessThan(
      Buffer.from(withExif, "base64").byteLength,
    );
  });
});
