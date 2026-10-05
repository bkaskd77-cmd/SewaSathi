/**
 * Whether a photograph's own clock puts it near the moment it was meant to be taken.
 *
 * THE WALL CLOCK IS COMPARED TO A WALL CLOCK, AND GETTING THAT WRONG WOULD HAVE FLAGGED
 * EVERY HONEST PHOTOGRAPH. EXIF stores `DateTimeOriginal` as a local wall clock with no
 * timezone at all, and `parseExifDate` reads it as UTC — deliberately, so the arithmetic
 * happens in one frame. A phone in Kathmandu therefore reads 5 hours 45 minutes AHEAD of
 * the instant it was taken, every time. Compared naively against a server instant, every
 * real arrival photograph in Nepal shows a skew of +345 minutes, and any window tight
 * enough to be useful would call all of them stale.
 *
 * So the server instant is moved into the same frame before subtracting. The product
 * serves the Kathmandu valley and nowhere else — `areas.json` is three cities inside it —
 * so Nepal time is the frame, and a phone set to another zone shows up as a skew of whole
 * hours, which is exactly what a reviewer should see rather than have guessed away.
 *
 * `exif_skew_minutes` WAS STORED UNCORRECTED UNTIL NOW, which means it was systematically
 * 345 minutes wrong for every photograph a Nepali phone would have taken. Nothing has seen
 * it because no real arrival photograph exists yet. It is corrected here rather than left
 * for a reviewer to subtract in their head.
 *
 * NOTHING HERE REFUSES ANYTHING. A stale photograph routes a no-show claim to a person; it
 * never rejects an arrival and never withholds a payment on its own.
 */

/**
 * Nepal is UTC+5:45 and has no daylight saving, so one constant covers it.
 *
 * Written here rather than derived from a timezone database because it is used to correct
 * a clock, not to render a date: a library would be a dependency for a number that has not
 * changed since 1986.
 */
export const NEPAL_UTC_OFFSET_MINUTES = 345;

/**
 * How far a camera clock may sit from the tap before it is worth a second look.
 *
 * TWO HOURS, AND IT IS GENEROUS ON PURPOSE. A phone clock set by hand drifts, a traveller's
 * phone may still be on another zone, and the cost of being wrong here is somebody's
 * wasted-trip payment going to a person to check rather than being paid. A tight window
 * would send honest professionals to a queue; a loose one still catches yesterday's
 * photograph, which is the case this exists for.
 */
export const ARRIVAL_FRESHNESS_WINDOW_MINUTES = 120;

export type FreshnessVerdict = "fresh" | "stale" | "no-capture-time" | "not-checked";

export type Freshness = {
  verdict: FreshnessVerdict;
  /** Minutes between the camera clock and the tap, in one frame. Null when unknown. */
  skewMinutes: number | null;
};

/**
 * `takenAt` is the EXIF wall clock parsed as UTC; `at` is the real instant of the tap.
 *
 * NO CAPTURE TIME IS ITS OWN ANSWER, not a stale one. A screenshot, a download and a file
 * stripped by a messaging app all arrive with no camera data — which is a different fact
 * from a photograph taken yesterday, and the two lead to different conversations.
 */
export function judgeFreshness(input: {
  takenAt: Date | null;
  at: Date;
  windowMinutes?: number;
}): Freshness {
  if (input.takenAt === null) {
    return { verdict: "no-capture-time", skewMinutes: null };
  }

  /* The tap, expressed as a Nepal wall clock, so both sides are wall clocks. */
  const tapAsWallClock =
    input.at.getTime() + NEPAL_UTC_OFFSET_MINUTES * 60_000;

  const skewMinutes = Math.round(
    (input.takenAt.getTime() - tapAsWallClock) / 60_000,
  );

  const window = input.windowMinutes ?? ARRIVAL_FRESHNESS_WINDOW_MINUTES;
  return {
    verdict: Math.abs(skewMinutes) <= window ? "fresh" : "stale",
    skewMinutes,
  };
}

/**
 * A photograph taken BEFORE the work finished cannot show that work failing.
 *
 * Separate from the window and sharper than it: this needs no tuning, because it is not a
 * judgement about how long ago something was taken but about the order of two events. It
 * is the rule for guarantee-claim evidence; an arrival photograph has no completion to be
 * before.
 *
 * NULL ON EITHER SIDE MEANS NOT CHECKED. No capture time, or no completion recorded — and
 * neither is evidence that the photograph is good.
 */
export function takenBeforeCompletion(input: {
  takenAt: Date | null;
  completedAt: Date | null;
}): boolean | null {
  if (!input.takenAt || !input.completedAt) return null;
  const takenAsInstant =
    input.takenAt.getTime() - NEPAL_UTC_OFFSET_MINUTES * 60_000;
  return takenAsInstant < input.completedAt.getTime();
}
