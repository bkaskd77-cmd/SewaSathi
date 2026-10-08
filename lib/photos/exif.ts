/**
 * The capture time out of a JPEG's EXIF, shared by the browser and the server.
 *
 * ISOMORPHIC ON PURPOSE, AND THAT IS WHY THIS FILE EXISTS. The server reads it off the
 * original bytes of an arrival photograph; the browser has to read it off a booking
 * photograph BEFORE the canvas resize, because a canvas re-encode has no access to source
 * metadata and the timestamp is gone by the time the bytes reach us — measured in Chromium
 * rather than assumed. Two implementations of a byte parser would drift, and the one place
 * that would show is a timestamp disagreeing with itself depending on which end read it.
 *
 * THE TRUST IS NOT THE SAME AT THE TWO ENDS, AND NOTHING HERE CAN FIX THAT. Bytes the
 * server parsed are bytes the server saw; a timestamp the browser sends is a number the
 * browser chose, and anybody can choose a different one. That is why the booking path
 * labels it device-reported and why it gates nothing.
 */

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
export function readExifTaken(bytes: Uint8Array, from: number, to: number): Date | null {
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
export function parseExifDate(text: string | null): Date | null {
  if (text === null) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m.map(Number) as unknown as number[];
  // A camera with no clock set writes zeroes, and that is not a time.
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  return Number.isNaN(at.getTime()) ? null : at;
}

