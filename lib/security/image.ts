/**
 * What we will accept as a photograph, decided on the server.
 *
 * The browser compresses a photo before it is sent (`lib/utils/image.ts`) and
 * the storage bucket is declared `image/jpeg` — and neither of those is a
 * check. The bucket believes the content type the uploader states, the
 * compressor is code the caller controls, and `uploadBookingPhoto` was
 * labelling whatever arrived as `image/jpeg` and storing it. A server that
 * takes the client's word about a file's type has not validated the file.
 *
 * THREE THINGS, IN THIS ORDER:
 *
 *   1. SIZE, before decoding. Base64 arrives as a string, and a caller who
 *      sends fifty megabytes of it should be refused by a length comparison
 *      rather than by the allocator.
 *   2. MAGIC BYTES, not the extension and not the content type. Both of those
 *      are things the caller says; the first bytes of the file are what it
 *      is.
 *   3. DIMENSIONS, read out of the file's own header. A 40-megapixel JPEG can
 *      compress to well under the size limit and still take a phone's browser
 *      down when it renders.
 *
 * AND THEN EXIF COMES OFF. A photograph of a leaking pipe, taken on a phone
 * in somebody's kitchen, carries the GPS coordinates of that kitchen. It is
 * handed to a professional and it sits in our storage. Nothing in this product
 * needs it, so it does not get stored — which is the same rule as the data
 * inventory: do not hold what you do not use.
 *
 * JPEG ONLY, deliberately. It is what the compressor produces and what the
 * bucket accepts, and every extra format is another parser to be careful
 * about. PNG and WebP are refused with a sentence rather than silently
 * mangled.
 */

/** 2 MB of actual bytes, matching the bucket's own limit. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Base64 is 4 characters per 3 bytes; a little slack for padding. */
const MAX_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES / 3) * 4) + 1024;
/** Generous for a photograph of a tap, far below what breaks a cheap phone. */
export const MAX_IMAGE_EDGE = 4000;

export type ImageCheck =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; reason: ImageRejection };

export type ImageRejection =
  | "tooLarge"
  | "notAnImage"
  | "unsupportedFormat"
  | "tooManyPixels"
  | "corrupt";

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  );
}

function isGif(bytes: Uint8Array): boolean {
  return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  );
}

/**
 * Walk a JPEG's segments once, reading the size and dropping the metadata.
 *
 * A JPEG is a marker stream: 0xFF then a marker byte, then for most markers a
 * two-byte length and that many bytes of payload. The dimensions live in a
 * start-of-frame marker (SOF0-SOF15, minus the four that are not frames), and
 * EXIF, XMP, ICC and comments live in APP0-APP15 and COM.
 *
 * Written by hand rather than pulled from a dependency: it is thirty lines,
 * this is a parser running on attacker-supplied bytes, and a dependency here
 * would be a supply chain in the one place we least want one.
 */
function readJpeg(
  bytes: Uint8Array,
): { width: number; height: number; stripped: Uint8Array } | null {
  const keep: Array<[number, number]> = [];
  let width = 0;
  let height = 0;
  let i = 2; // past the SOI

  keep.push([0, 2]);

  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) return null;

    let marker = bytes[i + 1];
    // Fill bytes: any number of 0xFF may precede a marker.
    let markerAt = i + 1;
    while (marker === 0xff && markerAt < bytes.length - 1) {
      markerAt += 1;
      marker = bytes[markerAt];
    }

    // Start of scan: the entropy-coded image data runs to the end. Nothing
    // after this is a segment we need to look inside.
    if (marker === 0xda) {
      keep.push([markerAt - 1, bytes.length]);
      break;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i = markerAt + 1;
      continue;
    }

    const lengthAt = markerAt + 1;
    if (lengthAt + 1 >= bytes.length) return null;
    const length = (bytes[lengthAt] << 8) | bytes[lengthAt + 1];
    if (length < 2) return null;

    const segmentStart = markerAt - 1;
    const segmentEnd = lengthAt + length;
    if (segmentEnd > bytes.length) return null;

    const isFrame =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrame) {
      // SOF payload: precision(1), height(2), width(2)
      height = (bytes[lengthAt + 3] << 8) | bytes[lengthAt + 4];
      width = (bytes[lengthAt + 5] << 8) | bytes[lengthAt + 6];
    }

    // APP0-APP15 and COM go. Everything else — quantisation tables, Huffman
    // tables, restart intervals, the frame itself — is the picture.
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) keep.push([segmentStart, segmentEnd]);

    i = segmentEnd;
  }

  if (width === 0 || height === 0) return null;

  const size = keep.reduce((n, [from, to]) => n + (to - from), 0);
  const stripped = new Uint8Array(size);
  let at = 0;
  for (const [from, to] of keep) {
    stripped.set(bytes.subarray(from, to), at);
    at += to - from;
  }

  return { width, height, stripped };
}

/**
 * Decide whether this is a photograph we will store, and hand back a clean
 * copy of it.
 *
 * Pure and synchronous, so every rejection above has a test rather than a
 * comment.
 */
export function checkUploadedImage(base64: string): ImageCheck {
  if (base64.length > MAX_BASE64_LENGTH) return { ok: false, reason: "tooLarge" };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    return { ok: false, reason: "notAnImage" };
  }

  if (bytes.byteLength < 12) return { ok: false, reason: "notAnImage" };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: "tooLarge" };

  if (isPng(bytes) || isWebp(bytes) || isGif(bytes)) {
    return { ok: false, reason: "unsupportedFormat" };
  }
  if (!isJpeg(bytes)) return { ok: false, reason: "notAnImage" };

  const read = readJpeg(bytes);
  if (!read) return { ok: false, reason: "corrupt" };
  if (read.width > MAX_IMAGE_EDGE || read.height > MAX_IMAGE_EDGE) {
    return { ok: false, reason: "tooManyPixels" };
  }

  return {
    ok: true,
    bytes: read.stripped,
    width: read.width,
    height: read.height,
  };
}
