/**
 * Shrink a phone photo before it leaves the phone.
 *
 * An 8 MP camera JPEG is 3-5 MB. On a 3G connection in Kathmandu that is a
 * minute of uploading for a picture of a tap, and the model sees no more in it
 * than it would at 1500px. So: resize, re-encode, and only then send.
 *
 * Canvas, not a library — this is thirty lines and the landing page has a
 * bundle budget.
 */

export type PreparedImage = {
  mediaType: "image/jpeg";
  /** Base64 without the data: prefix — what the API wants. */
  data: string;
  /** data: URL for the thumbnail. Same bytes, so no second copy in memory. */
  previewUrl: string;
  bytes: number;
};

/** Anything past this is not a photo of a tap; refuse before decoding it. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Longest edge. Claude downsamples above ~1568px anyway. */
const MAX_EDGE = 1500;

/** Comfortably under the route's 1 MB ceiling, with room for base64 growth. */
const TARGET_BYTES = 700 * 1024;

/** Tried in order until one comes in under target. */
const ATTEMPTS: Array<{ edge: number; quality: number }> = [
  { edge: MAX_EDGE, quality: 0.72 },
  { edge: MAX_EDGE, quality: 0.6 },
  { edge: 1100, quality: 0.55 },
  { edge: 900, quality: 0.5 },
];

export class ImageRejected extends Error {}

async function decode(
  file: File,
): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari and some Android browsers refuse HEIC here. Fall through to
      // the <img> path, which sometimes manages it.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new ImageRejected("We couldn't read that photo. Try another."));
      image.src = url;
    });
  } finally {
    // Revoke after decode: the bitmap keeps its own copy of the pixels.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function encode(
  source: CanvasImageSource & { width: number; height: number },
  edge: number,
  quality: number,
): { dataUrl: string; bytes: number } | null {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  // JPEG has no alpha, and an unpainted canvas composites transparent pixels
  // to black — a PNG screenshot would arrive as a black rectangle.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;

  return { dataUrl, bytes: Math.floor((base64.length * 3) / 4) - padding };
}

/**
 * Validate, resize and re-encode. Throws `ImageRejected` with a sentence that
 * can be shown to the person as-is.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new ImageRejected("That's not an image. Photos only.");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageRejected("That photo is too big. Try one under 25 MB.");
  }

  const source = await decode(file);

  let best: { dataUrl: string; bytes: number } | null = null;
  for (const { edge, quality } of ATTEMPTS) {
    const attempt = encode(source, edge, quality);
    if (!attempt) break;
    best = attempt;
    if (attempt.bytes <= TARGET_BYTES) break;
  }

  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }

  if (!best) {
    throw new ImageRejected("We couldn't read that photo. Try another.");
  }

  return {
    mediaType: "image/jpeg",
    data: best.dataUrl.slice(best.dataUrl.indexOf(",") + 1),
    previewUrl: best.dataUrl,
    bytes: best.bytes,
  };
}
