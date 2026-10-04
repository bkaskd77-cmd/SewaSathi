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
  | {
      ok: true;
      bytes: Uint8Array;
      width: number;
      height: number;
      /**
       * What the camera's own clock said, read out of EXIF before it was stripped.
       *
       * NULL IS "THE FILE DID NOT SAY", NEVER "JUST NOW" — rule 6. Plenty of
       * photographs have no EXIF at all: screenshots, anything that has been through
       * a messaging app, and our own browser compressor, which re-encodes through a
       * canvas and keeps nothing. A caller that treated null as the receipt time
       * would manufacture a perfect skew for every one of those.
       *
       * IT IS A WALL CLOCK WITH NO TIME ZONE. EXIF stores `YYYY:MM:DD HH:MM:SS` and
       * says nothing about where the phone was or what it was set to, so a comparison
       * against a server stamp is only as good as that assumption. That is precisely
       * why the caller stores a SKEW for a person to read and nothing in this product
       * gates on it.
       */
      takenAt: Date | null;
    }
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
 * The camera's own timestamp, out of the EXIF block, before that block is dropped.
 *
 * WHY READ SOMETHING WE ARE ABOUT TO THROW AWAY. A wasted-trip claim is funded now,
 * and a photograph of a locked gate is the strongest evidence a professional can
 * offer — but only if it was taken at the gate at the time of the visit. A picture
 * taken three hours earlier, or last week, is a different claim entirely. The
 * comparison is the evidence; the timestamp itself is not, so it is read here and
 * never stored. EXIF also carries the GPS of somebody's house, which is the reason
 * the whole block comes off.
 *
 * THE FORMAT, BRIEFLY. APP1 begins `Exif\0\0`, then a TIFF header — two bytes of
 * byte order (`II` little-endian, `MM` big), 0x002A, then a four-byte offset to the
 * first IFD. An IFD is a count followed by twelve-byte entries (tag, type, count,
 * value-or-offset). `DateTimeOriginal` (0x9003) lives in the EXIF sub-IFD, which
 * IFD0 points at through tag 0x8769; `DateTime` (0x0132) sits in IFD0 itself and is
 * the fallback, since it is the file's modification time rather than the shutter's.
 *
 * WRITTEN BY HAND, like `readJpeg` above and for the same reason: this is a parser
 * on bytes a stranger chose, every offset in it is attacker-controlled, and a
 * dependency here would be a supply chain in the one place we least want one. Every
 * read is bounds-checked and anything unexpected returns null — an unreadable
 * timestamp is simply a photograph with no timestamp, which is an ordinary case.
 */
function readExifTaken(bytes: Uint8Array, from: number, to: number): Date | null {
  // `Exif\0\0` then the TIFF header. Anything shorter cannot hold an IFD.
  if (to - from < 16) return null;
  const header = from + 6;

  const little = bytes[header] === 0x49 && bytes[header + 1] === 0x49;
  const big = bytes[header] === 0x4d && bytes[header + 1] === 0x4d;
  if (!little && !big) return null;

  const u16 = (at: number): number | null => {
    if (at < from || at + 1 >= to) return null;
    return little
      ? bytes[at] | (bytes[at + 1] << 8)
      : (bytes[at] << 8) | bytes[at + 1];
  };
  const u32 = (at: number): number | null => {
    if (at < from || at + 3 >= to) return null;
    return little
      ? (bytes[at] |
          (bytes[at + 1] << 8) |
          (bytes[at + 2] << 16) |
          (bytes[at + 3] << 24)) >>>
          0
      : ((bytes[at] << 24) |
          (bytes[at + 1] << 16) |
          (bytes[at + 2] << 8) |
          bytes[at + 3]) >>>
          0;
  };

  if (u16(header + 2) !== 0x002a) return null;
  const firstIfd = u32(header + 4);
  if (firstIfd === null) return null;

  /** The ASCII value of one tag in one IFD, plus any sub-IFD pointer we want. */
  function scan(
    ifdAt: number,
    wanted: number,
  ): { ascii: string | null; subIfd: number | null } {
    const out: { ascii: string | null; subIfd: number | null } = {
      ascii: null,
      subIfd: null,
    };
    const count = u16(ifdAt);
    if (count === null) return out;
    // A sane ceiling: a real IFD has tens of entries, and a count of 60,000 is
    // either corruption or somebody making us walk the whole segment.
    if (count > 512) return out;

    for (let n = 0; n < count; n += 1) {
      const entry = ifdAt + 2 + n * 12;
      const tag = u16(entry);
      if (tag === null) return out;

      if (tag === 0x8769) {
        const pointer = u32(entry + 8);
        if (pointer !== null) out.subIfd = header + pointer;
        continue;
      }
      if (tag !== wanted) continue;

      // ASCII (type 2) only. A date in any other type is not a date we trust.
      if (u16(entry + 2) !== 2) continue;
      const length = u32(entry + 4);
      if (length === null || length < 19 || length > 32) continue;

      // Up to four bytes live in the entry; more live at an offset.
      const valueAt =
        length <= 4 ? entry + 8 : header + ((u32(entry + 8) ?? -1) as number);
      if (valueAt < from || valueAt + 18 >= to) continue;

      let text = "";
      for (let i = 0; i < 19; i += 1) text += String.fromCharCode(bytes[valueAt + i]);
      out.ascii = text;
    }
    return out;
  }

  const ifd0 = scan(header + firstIfd, 0x0132);
  const original = ifd0.subIfd === null ? null : scan(ifd0.subIfd, 0x9003).ascii;

  /*
   * `DateTimeOriginal` first — the shutter — and `DateTime` only as a fallback,
   * because the latter is when the file was last written and a transfer or an edit
   * moves it.
   */
  return parseExifDate(original ?? ifd0.ascii);
}

/**
 * `YYYY:MM:DD HH:MM:SS` to a Date, read as UTC.
 *
 * READ AS UTC DELIBERATELY, although the string is a local wall clock. The caller
 * compares it against a server instant to produce a skew in minutes, and doing the
 * arithmetic in one frame keeps that number meaningful for a phone whose clock agrees
 * with ours. A phone set to another zone shows up as a skew of whole hours, which is
 * exactly the kind of thing the reviewer should see rather than have corrected for
 * them by a guess about where the photograph was taken.
 */
function parseExifDate(text: string | null): Date | null {
  if (text === null) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m.map(Number) as unknown as number[];
  // A camera with no clock set writes zeroes, and that is not a time.
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  return Number.isNaN(at.getTime()) ? null : at;
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
): {
  width: number;
  height: number;
  stripped: Uint8Array;
  takenAt: Date | null;
} | null {
  let takenAt: Date | null = null;
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
    /*
     * APP1 IS READ ON ITS WAY OUT. The timestamp is wanted and the block is not, so
     * the one chance to see it is here — before the copy below leaves it behind.
     * Anything unreadable stays null, which is an ordinary photograph with no EXIF.
     */
    if (
      marker === 0xe1 &&
      takenAt === null &&
      lengthAt + 7 < bytes.length &&
      bytes[lengthAt + 2] === 0x45 &&
      bytes[lengthAt + 3] === 0x78 &&
      bytes[lengthAt + 4] === 0x69 &&
      bytes[lengthAt + 5] === 0x66
    ) {
      takenAt = readExifTaken(bytes, lengthAt + 2, segmentEnd);
    }
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

  return { width, height, stripped, takenAt };
}

/**
 * Decide whether this is a photograph we will store, and hand back a clean
 * copy of it.
 *
 * Pure and synchronous, so every rejection above has a test rather than a
 * comment.
 */
export function checkUploadedImage(input: string): ImageCheck {
  /*
   * THE `data:image/jpeg;base64,` PREFIX HAS TO COME OFF FIRST, AND FOR A
   * LONG TIME IT DID NOT.
   *
   * Every document upload in the application form was rejected as "not an
   * image". `Buffer.from(x, "base64")` does not fail on a data URL — it
   * silently ignores the characters outside the base64 alphabet and decodes
   * the rest, and most of that prefix (`data`, `image`, `jpeg`, `base`, `64`,
   * the slash) *is* in the alphabet. So it decoded to fifteen bytes of junk
   * ahead of the real file, the magic-byte check looked at those, and the
   * answer was a confident no.
   *
   * The two callers disagreed and nothing made them agree: the hero strips the
   * prefix before sending, the capture component sends the whole data URL, and
   * this function's own doc comment promised to accept either. A validator
   * that is the single place two producers meet has to honour the looser
   * contract, so it does that here rather than asking both callers to
   * remember.
   *
   * Whitespace goes too — base64 in a textarea or an email arrives wrapped.
   */
  const base64 = input.replace(/^data:[^;,]*(;[^,]*)?,/, "").replace(/\s+/g, "");

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
    takenAt: read.takenAt,
  };
}
