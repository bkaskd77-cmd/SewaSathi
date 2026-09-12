/**
 * What a professional may charge, and the band they may not leave.
 *
 * THE "FROM" PRICE IS A PROMISE MADE BEFORE ANYBODY HAS SEEN THE JOB. It sits
 * on a directory card next to a name, and a customer reads it as "this is
 * roughly what this costs". So it cannot be a free number: a professional who
 * lists Rs 200 to win the tap and then quotes 4,000 on the doorstep has used
 * our card to get into somebody's house, and a professional who lists 9,000 for
 * the same work makes the whole category look expensive.
 *
 * CLAMPED TO THE PUBLISHED BAND, THE SAME BAND THE TRIAGE QUOTE USES. That is
 * not a coincidence and it is the whole reason this rule exists: the customer
 * has already been shown a range for their problem, and a "from" price outside
 * that range contradicts a number the product gave them ten seconds earlier.
 * One source, one band — see `lib/ai/price-bands.ts`.
 *
 * IT CLAMPS RATHER THAN REFUSING, and that is a deliberate difference from the
 * reference rules in `lib/verification`. A reference typed wrong is somebody's
 * mistake to fix in five seconds. A rate outside the band is usually somebody
 * pricing honestly for work we have banded badly — a mover quoting a whole flat,
 * a painter who only does big jobs — and refusing them teaches them the product
 * is wrong about their trade. So we take the nearest legal figure, say what
 * happened, and count it: a whole category bunching at a bound is OUR
 * mispricing, exactly as `category_pricing_signals` treats under-reporting.
 * Never read per person, for the same reason.
 */

export type RateVerdict = {
  /** What will actually be stored. Always inside the band. */
  rate: number;
  /** Did we move it, and which way? `null` when the figure was already fine. */
  clampedTo: "low" | "high" | null;
  /** The band it was judged against, for the sentence shown beside the field. */
  low: number;
  high: number;
};

/**
 * A professional's starting price for one trade, forced into the band.
 *
 * Rounded to whole rupees. Nothing in this product prices in paisa, and a
 * "from Rs 849.50" on a card reads as a bug.
 */
export function clampRate(input: {
  rate: number;
  band: { low: number; high: number };
}): RateVerdict {
  const { low, high } = input.band;

  // A band with the bounds the wrong way round is a data error, not something
  // to enforce against a person. Widen to the pair rather than trapping every
  // rate at an impossible value.
  const floor = Math.min(low, high);
  const ceiling = Math.max(low, high);

  const asked = Math.round(Number.isFinite(input.rate) ? input.rate : floor);

  if (asked < floor) return { rate: floor, clampedTo: "low", low: floor, high: ceiling };
  if (asked > ceiling) return { rate: ceiling, clampedTo: "high", low: floor, high: ceiling };
  return { rate: asked, clampedTo: null, low: floor, high: ceiling };
}

/**
 * One rate, one professional, several trades.
 *
 * Somebody who does plumbing and tank cleaning has one "from" price on their
 * card, and the two bands rarely agree. The band that binds is the WIDEST of
 * their trades — the union — because the alternative punishes breadth: taking
 * on a second trade would otherwise be able to lower somebody's ceiling.
 *
 * An unknown slug contributes nothing rather than collapsing the band to
 * zero, which is the failure that would silently pin every multi-trade
 * professional to the floor.
 */
export function bandForTrades(
  trades: ReadonlyArray<string>,
  bands: ReadonlyArray<{ slug: string; low: number; high: number }>,
): { low: number; high: number } | null {
  const matched = bands.filter((band) => trades.includes(band.slug));
  if (matched.length === 0) return null;

  return {
    low: Math.min(...matched.map((band) => band.low)),
    high: Math.max(...matched.map((band) => band.high)),
  };
}
