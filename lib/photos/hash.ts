import "server-only";

import jpeg from "jpeg-js";

/**
 * A perceptual hash of a photograph, for catching one that has been used before.
 *
 * WHY THIS IS COMPUTED ON THE SERVER AND NOT IN THE BROWSER, which is the decision that
 * shaped everything else here. The browser already has the pixels — `lib/utils/image.ts`
 * resizes every upload on a canvas — so a hash from there would be free and need no
 * decoder at all. It would also be worthless: a hash the client computes is a hash the
 * client chooses, and anybody reusing a photograph would send a random one. A fraud gate
 * whose input is set by the person being gated is not a gate.
 *
 * SO A DECODER IS A DEPENDENCY WE TAKE, AND IT IS THE FIRST ONE TAKEN HERE FOR A JOB THIS
 * REPOSITORY COULD HAVE WRITTEN. The EXIF reader and the publish diff were both written by
 * hand because they are forty lines each; a baseline JPEG decoder is Huffman tables, an
 * inverse DCT and chroma upsampling, and writing one badly fails in the direction that
 * matters — a wrong hash is a wrongly refused customer. `jpeg-js` is pure JavaScript (no
 * native build on Vercel), BSD-3, and does one thing.
 *
 * dHash RATHER THAN aHash, because it compares each pixel with its neighbour instead of
 * with the image average, which makes it indifferent to brightness and to the exposure
 * difference between two phones photographing the same door.
 *
 * NULL IS "NOT COMPUTED", NEVER "NO MATCH". A PNG, a WebP, a HEIC, bytes that will not
 * decode, a file whose declared dimensions are a memory bomb — all return null, and a null
 * must never be compared to anything. Rule 6: the absence of a hash is not evidence that a
 * photograph is new, and a format we cannot read is never a reason to refuse somebody.
 *
 * THE DECODER IS BOUNDED, because a JPEG header is a promise about dimensions that the file
 * does not have to keep in bytes. A few kilobytes can declare 30,000 x 30,000 and a decoder
 * that believes it allocates gigabytes — the classic decompression bomb, and the reason a
 * parser running on bytes somebody else chose is never given free rein. `checkUploadedImage`
 * already refuses an edge over 4000 by reading the header itself, so these limits are the
 * second line rather than the first: comfortably above anything that passes that check, and
 * far below anything that would hurt. An oversize file is logged and goes unjudged.
 */

/** The grid dHash compares across. 9x8 differences give 64 bits. */
const WIDTH = 9;
const HEIGHT = 8;

/**
 * Above our own 4000px edge cap (16MP at square) with room, and far under a bomb.
 *
 * Two limits rather than one because they bound different things: a long thin image can be
 * modest in megapixels and large in memory, and a square one the reverse.
 */
const MAX_DECODE_MP = 20;
const MAX_DECODE_MB = 64;

/**
 * 64 bits as 16 hex characters, or null when the bytes could not be read.
 *
 * Luminance uses the Rec. 601 weights rather than a plain average: a red door and a blue
 * door of the same average brightness look different and should hash differently.
 */
export function perceptualHash(bytes: Uint8Array): string | null {
  let decoded: { width: number; height: number; data: Uint8Array };
  try {
    decoded = jpeg.decode(bytes, {
      useTArray: true,
      maxResolutionInMP: MAX_DECODE_MP,
      maxMemoryUsageInMB: MAX_DECODE_MB,
    });
  } catch (error) {
    /*
     * SAID OUT LOUD, because an unjudged photograph is a gate that did not run and the only
     * place that is visible is here. Not an error: a PNG, a HEIC from an iPhone and a file
     * that declares impossible dimensions all land in this branch, and none of them is
     * something going wrong for the person who sent it.
     */
    console.warn(
      `[photo-hash] not judged — ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  if (!decoded.width || !decoded.height) return null;

  /* Nearest-neighbour down to 9x8. The grid is tiny and the hash only has to be stable,
     not pretty — an interpolating resize would cost more and change nothing at 64 bits. */
  const grey = new Float64Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const sx = Math.min(decoded.width - 1, Math.floor((x * decoded.width) / WIDTH));
      const sy = Math.min(decoded.height - 1, Math.floor((y * decoded.height) / HEIGHT));
      const i = (sy * decoded.width + sx) * 4;
      grey[y * WIDTH + x] =
        0.299 * decoded.data[i] +
        0.587 * decoded.data[i + 1] +
        0.114 * decoded.data[i + 2];
    }
  }

  let bits = "";
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH - 1; x += 1) {
      bits += grey[y * WIDTH + x] < grey[y * WIDTH + x + 1] ? "1" : "0";
    }
  }

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** How many of the 64 bits differ. Null for anything that is not a pair of hashes. */
export function hammingDistance(a: string | null, b: string | null): number | null {
  if (!a || !b || a.length !== 16 || b.length !== 16) return null;

  let distance = 0;
  for (let i = 0; i < 16; i += 1) {
    const left = parseInt(a[i], 16);
    const right = parseInt(b[i], 16);
    if (Number.isNaN(left) || Number.isNaN(right)) return null;
    let diff = left ^ right;
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}
