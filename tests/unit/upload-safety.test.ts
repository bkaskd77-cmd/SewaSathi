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

describe("the data URL prefix", () => {
  /**
   * THE BUG THIS SUITE MISSED, AND THE REASON IT MISSED IT.
   *
   * Every document upload in the application form was rejected as "not an
   * image". `Buffer.from(x, "base64")` does not throw on a data URL — it drops
   * the characters outside the base64 alphabet and decodes the rest, and most
   * of `data:image/jpeg;base64,` is inside that alphabet. The result was
   * fifteen bytes of junk ahead of the real file, so the magic-byte check read
   * those and said no.
   *
   * Every test here fed it bare base64, because that is what the hero sends.
   * The capture component sends the whole data URL, and the function's own
   * documentation promised to take either. Two producers, one validator, and a
   * contract only one of them kept.
   */
  it("accepts the same photograph with or without the prefix", () => {
    const bare = jpeg();
    const asDataUrl = `data:image/jpeg;base64,${bare}`;

    const plain = checkUploadedImage(bare);
    const prefixed = checkUploadedImage(asDataUrl);

    expect(plain.ok).toBe(true);
    expect(prefixed.ok).toBe(true);
    // Not merely both accepted — byte-identical, or the prefix is still
    // leaking into what gets stored.
    if (plain.ok && prefixed.ok) {
      expect(Buffer.from(prefixed.bytes)).toEqual(Buffer.from(plain.bytes));
      expect(prefixed.width).toBe(plain.width);
    }
  });

  it("decodes the prefix to junk if it is left on, which is why it comes off", () => {
    // The mechanism, pinned. If this ever stops being true the strip is
    // unnecessary; while it is true, the strip is load-bearing.
    const junk = Buffer.from("data:image/jpeg;base64,", "base64");
    expect(junk.length).toBeGreaterThan(0);
  });

  it("tolerates the prefix variants a browser can produce", () => {
    for (const prefix of [
      "data:image/jpeg;base64,",
      "data:image/jpg;base64,",
      "data:;base64,",
    ]) {
      expect(checkUploadedImage(`${prefix}${jpeg()}`).ok).toBe(true);
    }
  });

  it("strips whitespace, because wrapped base64 is still base64", () => {
    const wrapped = jpeg().replace(/(.{40})/g, "$1\n");
    expect(checkUploadedImage(wrapped).ok).toBe(true);
  });

  it("still refuses a PNG sent as a data URL", () => {
    // The strip must not become a way past the format check.
    const png = asBase64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = checkUploadedImage(`data:image/png;base64,${png}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupportedFormat");
  });
});

/* ------------------------------------------------------------------ *
 * The camera's own clock
 * ------------------------------------------------------------------ */

/**
 * A JPEG carrying a genuine EXIF block with a `DateTimeOriginal`.
 *
 * BUILT PROPERLY RATHER THAN FAKED, which is the lesson `classifyProviderError`
 * paid for: a hand-rolled stand-in proves a branch the real thing never reaches.
 * So this is an actual TIFF header, an actual IFD0 with a sub-IFD pointer, and an
 * actual EXIF IFD with tag 0x9003 as ASCII — little-endian, the way every phone
 * writes it.
 */
function jpegWithTaken(
  taken: string | null,
  options: { tagInIfd0?: boolean } = {},
): string {
  const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n: number) => [
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >> 24) & 0xff,
  ];

  // Offsets below are from the start of the TIFF header, as EXIF requires.
  const tiff: number[] = [0x49, 0x49, ...le16(0x002a), ...le32(8)];

  const ascii = taken === null ? [] : Array.from(taken).map((c) => c.charCodeAt(0));
  // 20 bytes: nineteen characters and the NUL the format expects.
  const valueLength = ascii.length === 0 ? 0 : ascii.length + 1;

  if (options.tagInIfd0) {
    // IFD0 holding DateTime (0x0132) itself, no sub-IFD at all. The fallback path.
    const ifd0Start = 8;
    const valueAt = ifd0Start + 2 + 12 + 4;
    tiff.push(
      ...le16(1),
      ...le16(0x0132), ...le16(2), ...le32(valueLength), ...le32(valueAt),
      ...le32(0),
      ...ascii, 0x00,
    );
  } else {
    // IFD0 with one entry: the EXIF sub-IFD pointer. Then the sub-IFD.
    const ifd0Start = 8;
    const subStart = ifd0Start + 2 + 12 + 4;
    const valueAt = subStart + 2 + 12 + 4;
    tiff.push(
      ...le16(1),
      ...le16(0x8769), ...le16(4), ...le32(1), ...le32(subStart),
      ...le32(0),
      // the EXIF sub-IFD
      ...le16(1),
      ...le16(0x9003), ...le16(2), ...le32(valueLength), ...le32(valueAt),
      ...le32(0),
      ...ascii, 0x00,
    );
  }

  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = payload.length + 2;

  const parts: number[] = [0xff, 0xd8];
  parts.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
  parts.push(
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    0x02, 0x58, 0x03, 0x20,
    0x01, 0x01, 0x11, 0x00,
  );
  parts.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  parts.push(0x12, 0x34, 0x56, 0x78, 0xff, 0xd9);

  return Buffer.from(Uint8Array.from(parts)).toString("base64");
}

describe("the camera's own clock is read before EXIF is dropped", () => {
  it("reads DateTimeOriginal out of the EXIF sub-IFD", () => {
    const result = checkUploadedImage(jpegWithTaken("2026:10:04 14:35:09"));
    expect(result.ok).toBe(true);
    expect(result.ok && result.takenAt?.toISOString()).toBe(
      "2026-10-04T14:35:09.000Z",
    );
  });

  /*
   * The fallback, and it matters: a photograph that has been through an editor often
   * keeps DateTime and loses DateTimeOriginal.
   */
  it("falls back to IFD0's DateTime when the shutter time is absent", () => {
    const result = checkUploadedImage(
      jpegWithTaken("2026:10:01 08:00:00", { tagInIfd0: true }),
    );
    expect(result.ok && result.takenAt?.toISOString()).toBe(
      "2026-10-01T08:00:00.000Z",
    );
  });

  /*
   * NULL IS "THE FILE DID NOT SAY", AND THIS IS THE CASE THAT MATTERS MOST — rule 6
   * one level down. Our own browser compressor re-encodes through a canvas and keeps
   * no EXIF at all, so most photographs reaching this product arrive with nothing. A
   * reader that returned "now" for those would hand every one of them a perfect skew.
   */
  it("says nothing rather than guessing when there is no timestamp", () => {
    /* Hoisted rather than called twice inside the assertion: two calls are two
       values and TypeScript cannot narrow the second from the first. */
    const stub = checkUploadedImage(jpeg());
    expect(stub.ok && stub.takenAt).toBe(null);
    const noExif = checkUploadedImage(jpeg({ exif: false }));
    expect(noExif.ok && noExif.takenAt).toBe(null);
  });

  /* A camera with no clock set writes zeroes, and that is not a time. */
  it("refuses a zeroed clock and a malformed string", () => {
    const zeroed = checkUploadedImage(jpegWithTaken("0000:00:00 00:00:00"));
    expect(zeroed.ok && zeroed.takenAt).toBe(null);
    const junk = checkUploadedImage(jpegWithTaken("not a date at all!!"));
    expect(junk.ok && junk.takenAt).toBe(null);
  });

  /*
   * AND IT STILL COMES OFF. Reading the timestamp must not become a reason to keep
   * the block that carries the GPS of somebody's house — the whole point of stripping.
   */
  it("still strips the block it read the timestamp from", () => {
    const result = checkUploadedImage(jpegWithTaken("2026:10:04 14:35:09"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = Buffer.from(result.bytes).toString("latin1");
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("2026:10:04");
  });
});
