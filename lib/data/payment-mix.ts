/**
 * Cash versus digital, and what may be concluded from it.
 *
 * The customer-side incentive is unbuilt until there is a baseline to measure
 * it against — that is the whole reason this exists. An incentive launched
 * without one cannot be evaluated afterwards: cash share moves for a dozen
 * reasons, and every one of them would be claimed as the incentive working.
 *
 * PURE, like `ranking.ts`, `recommendations.ts` and `pricing-signals.ts`. The
 * read is `listPaymentMix` in `lib/data/payments.ts`; the rollups are here so
 * they can be tested without a database, because an aggregate that is wrong is
 * far more dangerous than a query that fails — it produces a confident number
 * nobody can check.
 */

export type PaymentMixRow = {
  categorySlug: string;
  /** Ward key, e.g. "lalitpur-4". */
  areaKey: string;
  /** First day of the month the job completed in, ISO. */
  month: string;
  settledJobs: number;
  cashJobs: number;
  cashPct: number;
  /** Rupees settled, all methods. */
  gross: number;
  cashGross: number;
};

export type MixSummary = {
  key: string;
  settledJobs: number;
  cashJobs: number;
  /** Share of JOBS settled in cash, 0-100. */
  cashPct: number;
  /** Share of MONEY settled in cash, 0-100. The one that decides a spend. */
  cashValuePct: number;
};

function summarise(key: string, rows: PaymentMixRow[]): MixSummary {
  const settledJobs = rows.reduce((n, r) => n + r.settledJobs, 0);
  const cashJobs = rows.reduce((n, r) => n + r.cashJobs, 0);
  const gross = rows.reduce((n, r) => n + r.gross, 0);
  const cashGross = rows.reduce((n, r) => n + r.cashGross, 0);

  return {
    key,
    settledJobs,
    cashJobs,
    cashPct: settledJobs === 0 ? 0 : round1((100 * cashJobs) / settledJobs),
    // BY VALUE, NOT ONLY BY COUNT, and the two diverge in the direction that
    // matters: cash tends to be the big jobs. A platform whose jobs are 40%
    // cash but whose money is 70% cash has a much larger exposure than the
    // first number suggests, and would be reassured by reading only that one.
    cashValuePct: gross === 0 ? 0 : round1((100 * cashGross) / gross),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function groupBy(
  rows: PaymentMixRow[],
  key: (row: PaymentMixRow) => string,
): MixSummary[] {
  const buckets = new Map<string, PaymentMixRow[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = buckets.get(k);
    if (existing) existing.push(row);
    else buckets.set(k, [row]);
  }
  return Array.from(buckets.entries())
    .map(([k, group]) => summarise(k, group))
    .sort((a, b) => b.cashValuePct - a.cashValuePct);
}

export function mixByCategory(rows: PaymentMixRow[]): MixSummary[] {
  return groupBy(rows, (row) => row.categorySlug);
}

export function mixByWard(rows: PaymentMixRow[]): MixSummary[] {
  return groupBy(rows, (row) => row.areaKey);
}

export function mixByMonth(rows: PaymentMixRow[]): MixSummary[] {
  return groupBy(rows, (row) => row.month).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
}

export function overallMix(rows: PaymentMixRow[]): MixSummary {
  return summarise("all", rows);
}

/**
 * How many settled jobs before a share means anything.
 *
 * Below this the percentage is one or two customers' habits, and acting on it
 * would be spending real money on noise. It is the same reasoning as
 * `needsBandReview`, and the same trap: a small denominator produces confident
 * numbers.
 */
export const MIX_BASELINE_MINIMUM_JOBS = 30;

/** Is there enough here to call it a baseline and measure against it? */
export function hasBaseline(summary: MixSummary): boolean {
  return summary.settledJobs >= MIX_BASELINE_MINIMUM_JOBS;
}
