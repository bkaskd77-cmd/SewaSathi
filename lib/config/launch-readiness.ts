import { SUB_BAND_SEED, type SubBand } from "@/lib/config/services";

/**
 * Which trades cannot honestly be opened yet, derived rather than listed.
 *
 * THE DECISION THIS IMPLEMENTS. `sub-band-durations` and `multi-day-scheduling`
 * used to refuse a `LAUNCH=true` build, which meant the whole product waited on
 * evidence only finished jobs can produce. They gate `launch_scope` instead: a
 * trade we do not sell yet cannot mislead anybody about itself, and the ones
 * that can be sold honestly are not held up by the ones that cannot.
 *
 * THE RULE IS THE MEDIAN PRODUCT, AND THE ALTERNATIVES WERE ALL A GUESS. Three
 * trades carry an authored multi-day span and every one of those spans is
 * `invented`:
 *
 *   painting      1, 2, 4, 7 days   median 3   — three of its four products
 *   electrical    1, 1, 1, 1, 2     median 1   — one of five
 *   carpentry     1, 1, 1, 2        median 1   — one of four
 *
 * "Any multi-day product closes the trade" would close electrical, the trade the
 * safety floor points at for gas and live wires, over one sub-band — and the
 * emergency path is the last thing to hold back. "More than half" or "at least
 * three" is a threshold nobody measured, which is the frozen guess this
 * codebase refuses everywhere else. **The median is this product's own
 * statistic** — `proposeDuration`, `server.region` and the Lighthouse rule all
 * use it — and it says something a person can check: *the typical way to buy
 * this trade needs a span we cannot promise.*
 *
 * WHAT GOING WRONG ACTUALLY COSTS, so the rule is judged against it rather than
 * against tidiness. Nothing in the product prints a duration while a span is
 * `invented` (`hasPublishableSpan`) and `spansDays` holds every job to one day —
 * so selling `painting/flat`, authored at seven days, reserves one day of a
 * professional's week and tells the customer nothing. On electrical that
 * describes one product out of five; on painting it describes how the trade
 * works.
 *
 * IT CLEARS ITSELF. A span moving off `invented` — researched by hand, or
 * promoted by the duration loop out of `duration_observations` — drops the trade
 * off this list with no code change, which is why the rule reads the seed's
 * provenance rather than naming a slug.
 */

/** One trade's span standing, with the evidence the screen prints. */
export type TradeSpanStanding = {
  slug: string;
  /** Authored spans across its products, ascending. */
  spans: number[];
  /** The middle one — the typical way to buy this trade. */
  medianSpan: number;
  /** The longest authored span, which is what a customer would plan around. */
  longestSpan: number;
  /** Products whose span is longer than a day. */
  multiDayProducts: number;
  /** Products whose span has never been measured. */
  unmeasuredSpans: number;
  /**
   * May a customer be offered this trade?
   *
   * FALSE ONLY WHEN BOTH HALVES HOLD: the typical product needs more than a day,
   * AND no span here has been measured. A trade whose spans are researched is
   * fine however long they are — the problem was never the length, it was
   * selling a length nobody has checked.
   */
  openable: boolean;
};

function median(sorted: number[]): number {
  if (sorted.length === 0) return 1;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : /* The lower of the two, which is the same direction `proposeDuration`
         rounds a span: an under-reserved span shows up as a job running over,
         where an over-reserved one silently removes capacity nobody can see. */
      sorted[mid - 1];
}

/** Every trade's span standing, keyed by slug. */
export function tradeSpanStandings(
  bands: readonly SubBand[] = SUB_BAND_SEED,
): Map<string, TradeSpanStanding> {
  const byTrade = new Map<string, SubBand[]>();
  for (const band of bands) {
    const list = byTrade.get(band.categorySlug) ?? [];
    list.push(band);
    byTrade.set(band.categorySlug, list);
  }

  const out = new Map<string, TradeSpanStanding>();
  for (const [slug, products] of byTrade) {
    /* `?? 1` is not a default standing in for a measurement: a sub-band with no
       authored span is scheduled as one day by `spansDays`, so one day is what
       the product actually does with it. */
    const spans = products.map((p) => p.typicalElapsedDays ?? 1).sort((a, b) => a - b);
    const unmeasuredSpans = products.filter(
      (p) => (p.spanSource ?? "invented") === "invented",
    ).length;
    const medianSpan = median(spans);

    out.set(slug, {
      slug,
      spans,
      medianSpan,
      longestSpan: spans[spans.length - 1] ?? 1,
      multiDayProducts: spans.filter((d) => d > 1).length,
      unmeasuredSpans,
      openable: medianSpan <= 1 || unmeasuredSpans === 0,
    });
  }
  return out;
}

/**
 * May this trade be opened to customers?
 *
 * UNKNOWN IS OPENABLE, deliberately. A trade with no sub-bands at all — which
 * `categoryReadiness` already reports as a gap, and which movers is by design —
 * sells nothing this rule is about, so refusing it here would be a second,
 * quieter gate on a case that already has one.
 */
export function tradeOpenable(
  slug: string,
  bands: readonly SubBand[] = SUB_BAND_SEED,
): boolean {
  return tradeSpanStandings(bands).get(slug)?.openable ?? true;
}
