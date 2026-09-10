/**
 * Judging a photograph of a document before it is uploaded.
 *
 * A HUMAN REVIEWER'S TIME IS THE SCARCE RESOURCE. At launch there are tens of
 * providers and one or two people looking at their paperwork, and the fastest
 * way to waste that is a queue of citizenship certificates photographed at an
 * angle in a dark room. Every unreadable capture rejected on the phone is a
 * review that never has to happen and, more importantly, a rejection the
 * applicant can act on IN THE MOMENT — while the document is still in their
 * hand, rather than three days later by SMS.
 *
 * IT RUNS IN THE BROWSER AND UPLOADS NOTHING TO DECIDE. The measurement is
 * arithmetic over pixels already on the device. Sending a photograph of
 * somebody's citizenship certificate to a server to be told it is blurry would
 * mean transmitting and storing the very thing we are about to reject, on a
 * mobile connection they are paying for by the megabyte.
 *
 * THE THRESHOLDS ARE HONEST GUESSES AND ARE MARKED AS SUCH. They are chosen to
 * be forgiving, because the cost of the two errors is not symmetric: a bad
 * capture waved through costs a reviewer thirty seconds, and a good capture
 * wrongly rejected costs a tradesperson on a cheap phone their patience and
 * possibly the application. Calibrate against real captures once there are
 * any — `CAPTURE_THRESHOLDS` is one object for exactly that reason.
 *
 * Pure and dependency-free: it takes the pixels, not a canvas, so it is
 * testable without a browser.
 */

export type CaptureMeasurement = {
  /** Variance of the Laplacian. Higher is sharper. */
  sharpness: number;
  /** Fraction of pixels blown out to near-white — a flash on a laminated card. */
  glare: number;
  /** Mean luma, 0–255. */
  brightness: number;
  /** How much of the frame the document occupies, 0–1. */
  fill: number;
};

export type CaptureProblem = "blurry" | "glare" | "dark" | "tooFar";

export type CaptureVerdict =
  | { ok: true; measurement: CaptureMeasurement }
  | { ok: false; problem: CaptureProblem; measurement: CaptureMeasurement };

/**
 * Deliberately forgiving. See the note above about which error costs more.
 */
export const CAPTURE_THRESHOLDS = {
  /** Below this the text will not be readable at any zoom. */
  minSharpness: 80,
  /** A fifth of the frame blown out means the flash has erased part of the text. */
  maxGlare: 0.2,
  /** Under-exposed to the point where the darker script disappears. */
  minBrightness: 55,
  /** Over-exposed overall, which is glare across the whole card. */
  maxBrightness: 235,
  /** The document should be most of the frame; less means the numbers are a few pixels tall. */
  minFill: 0.35,
} as const;

/** Rec. 601 luma. Cheap, and correct enough for a legibility judgement. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Measure one frame.
 *
 * `data` is RGBA in row-major order — exactly what `CanvasRenderingContext2D`
 * hands back — so the caller downscales to something like 480px on the long
 * edge first. Measuring the full 12-megapixel frame would take a second on the
 * phones this is written for and tell us nothing more.
 */
export function measureCapture(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): CaptureMeasurement {
  if (width < 3 || height < 3) {
    return { sharpness: 0, glare: 1, brightness: 0, fill: 0 };
  }

  const grey = new Float32Array(width * height);
  let brightnessTotal = 0;
  let blownOut = 0;

  for (let i = 0, p = 0; i < grey.length; i += 1, p += 4) {
    const value = luma(data[p], data[p + 1], data[p + 2]);
    grey[i] = value;
    brightnessTotal += value;
    if (value >= 250) blownOut += 1;
  }

  /*
   * The Laplacian's variance is the standard cheap sharpness measure: a blurred
   * image has almost no second derivative anywhere, so the responses cluster
   * near zero and the variance collapses. Computed in one pass with the
   * bounding box below, because two passes over a megapixel on a budget phone
   * is a visible pause.
   */
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  // Strong edges bound the document within the frame.
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const EDGE = 24;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const response =
        grey[i - width] +
        grey[i + width] +
        grey[i - 1] +
        grey[i + 1] -
        4 * grey[i];

      sum += response;
      sumSquares += response * response;
      count += 1;

      if (response > EDGE || response < -EDGE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const mean = sum / count;
  const sharpness = sumSquares / count - mean * mean;

  const fill =
    maxX < 0
      ? 0
      : ((maxX - minX + 1) * (maxY - minY + 1)) / (width * height);

  return {
    sharpness,
    glare: blownOut / (width * height),
    brightness: brightnessTotal / (width * height),
    fill,
  };
}

/**
 * One measurement to a verdict, worst problem first.
 *
 * ORDERED SO THE ADVICE IS ACTIONABLE: light, then focus, then framing.
 *
 * A dark, blurry photograph is dark first. Telling somebody to hold the phone
 * steadier when the real problem is an unlit corridor sends them round the
 * same loop twice.
 *
 * FOCUS BEFORE FRAMING, and a test is what settled that. `fill` is measured
 * from where the strong edges are, so a completely out-of-focus frame has no
 * edges anywhere and reads as a document too small to see — which produced
 * "move closer" for a smudged lens. You cannot judge the framing of an image
 * you cannot resolve, so sharpness is answered first and `tooFar` is left to
 * the case it can actually describe: a sharp document that is genuinely small
 * in the frame.
 */
export function judgeCapture(measurement: CaptureMeasurement): CaptureVerdict {
  const t = CAPTURE_THRESHOLDS;

  if (measurement.brightness < t.minBrightness) {
    return { ok: false, problem: "dark", measurement };
  }
  if (measurement.glare > t.maxGlare || measurement.brightness > t.maxBrightness) {
    return { ok: false, problem: "glare", measurement };
  }
  if (measurement.sharpness < t.minSharpness) {
    return { ok: false, problem: "blurry", measurement };
  }
  if (measurement.fill < t.minFill) {
    return { ok: false, problem: "tooFar", measurement };
  }
  return { ok: true, measurement };
}

/**
 * A capture's contribution to `documentQuality` in the risk score, 0–1.
 *
 * Sharpness is the axis that actually decides whether a reviewer can read a
 * number, so it carries the scale; the rest are pass or fail and have already
 * been enforced. Capped at three times the threshold, past which extra
 * sharpness is a better camera rather than a better photograph.
 */
export function captureQuality(measurement: CaptureMeasurement): number {
  const ceiling = CAPTURE_THRESHOLDS.minSharpness * 3;
  const raw = measurement.sharpness / ceiling;
  return Math.max(0, Math.min(1, raw));
}
