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

/**
 * The floor of the quote on a booking, when a specific professional holds it.
 *
 * WHY THE PROFESSIONAL'S FIGURE BELONGS HERE AT ALL. Before this, a booking
 * froze the whole category band whoever the customer had picked — so a plumbing
 * job quoted Rs 900–4,500 for somebody starting at 900 and for somebody
 * starting at 2,000 alike. The number a professional sets on their own
 * dashboard reached their card, their profile and the replacement list, and
 * then vanished from the one screen that decides what anybody pays.
 *
 * THE CEILING IS STILL OURS. A professional names a starting price, never a
 * maximum, and `judgeFinalAmount` measures the 2× customer protection off
 * `quoted_max`. Nothing a professional can type may move that.
 *
 * IT IS `clampRate` AGAINST THE JOB'S OWN BAND, and reusing it is the point
 * rather than a shortcut. A multi-trade professional is clamped against the
 * UNION of their bands — a plumber-and-painter may legally sit at Rs 25,000 —
 * so taking their rate raw as the floor of a plumbing job would write
 * `quoted_min` above `quoted_max` and the table's own check constraint would
 * refuse the insert. Clamping to the band of the trade actually being booked is
 * the same rule the professional already lives under, applied to the right band.
 *
 * NO GAMING PAYOFF EITHER WAY: the clamp stops them going under the published
 * band, and going over only raises the floor their own commission is charged on.
 */
export function quoteFloor(input: {
  /** Their starting price, or null when nobody is chosen yet. */
  providerRate: number | null | undefined;
  /** The band of the category being booked — not the union of their trades. */
  band: { low: number; high: number };
}): number {
  const floor = Math.min(input.band.low, input.band.high);
  if (input.providerRate == null || !Number.isFinite(input.providerRate)) {
    return floor;
  }
  return clampRate({ rate: input.providerRate, band: input.band }).rate;
}
