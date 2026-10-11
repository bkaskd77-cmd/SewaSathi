import "server-only";

import { BAND_SOURCES } from "@/lib/booking";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { uncounted, type Counted } from "@/lib/data/triage-accuracy";

/**
 * How many bookings know which product they are.
 *
 * WHY THIS IS WORTH A SCREEN. Everything downstream of duration learns PER
 * SUB-BAND: the observed-duration loop, the per-product price bands, the
 * multi-day span. A booking with no `band_slug` teaches none of them anything
 * and holds a flat two hours whatever the job turns out to be. When this was
 * first measured, 2 of 14 bookings carried one — so the loop everybody was
 * waiting on had a feed covering a seventh of the work.
 *
 * It was not that the customers would not say. It was that **nothing asked
 * them**: the "which of these is it?" question existed only on the triage
 * card, so anybody who tapped a category on `/services` reached a booking with
 * no product and no prompt — and the AI ceilings made that the common path by
 * suppressing the card for anybody out of free questions. The question is in
 * the flow now; this is what says whether it worked.
 *
 * THE CUTOVER IS DERIVED FROM THE DATA, NEVER FROM A DATE CONSTANT.
 * `band_slug` shipped partway through the product's life, so every booking
 * before it is silent — and counting those as "no product" would report a
 * coverage figure that can never reach 100% and blame the flow for a column
 * that did not exist. `triage-accuracy.ts` settled this exact question for
 * `reason` and the answer is the same: take the first row that carries one and
 * measure from there. A date somebody typed is a date nobody can verify later.
 *
 * NOTHING HERE GRADES. There is no target, no colour for bad and no proposal —
 * `/admin/triage-accuracy`'s posture, for the same reason: nobody knows what
 * coverage is achievable on a product where "I'm not sure" is a legitimate
 * answer that writes null on purpose. It is the number to act from.
 */

export type BandCoverage = {
  /**
   * Bookings since the first one that recorded a product.
   *
   * The denominator, and it excludes a survey trade: movers sells no products,
   * so counting it as a miss would make the figure unreachable by construction
   * — rule 6 in the shape it takes for a rate.
   */
  eligible: number;
  /** Of those, how many carry a product. */
  withBand: number;
  /** Where the product came from, for the ones that have one. */
  bySource: Record<string, number>;
  /**
   * The first booking that carried a product, as the cutover.
   *
   * Null when none ever has — and then `eligible` is 0 and there is no rate,
   * which is the honest answer rather than 0%.
   */
  since: string | null;
  /**
   * Bookings from before that, carried separately and never folded in.
   *
   * SILENT, NOT MISSING. The column did not exist; reading their null as "the
   * customer was not asked" invents a finding out of an absence.
   */
  beforeColumn: number;
};

export async function bandCoverage(): Promise<Counted<BandCoverage>> {
  if (!hasSupabaseConfig()) return uncounted<BandCoverage>();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("created_at, band_slug, band_source, quote_model")
    .order("created_at", { ascending: true });

  if (error || !data) {
    console.error(`[band-coverage] read failed — ${describeError(error)}`);
    return uncounted<BandCoverage>();
  }

  const rows = data as Array<{
    created_at: string;
    band_slug: string | null;
    band_source: string | null;
    quote_model: string | null;
  }>;

  const first = rows.find((row) => row.band_slug !== null);
  const since = first?.created_at ?? null;

  /*
   * NO CUTOVER MEANS NO RATE. With nothing ever recorded there is no evidence
   * that the column works, and reporting "0 of 14" would read as a failure of
   * the flow rather than as a product that has not been used since the
   * question shipped.
   */
  if (!since) {
    return {
      ok: true,
      value: {
        eligible: 0,
        withBand: 0,
        bySource: {},
        since: null,
        beforeColumn: rows.length,
      },
    };
  }

  const cutover = Date.parse(since);
  const bySource: Record<string, number> = {};
  for (const source of BAND_SOURCES) bySource[source] = 0;
  /* A product with no provenance. The constraint refuses new ones; the rows
     written before it stay visible rather than being quietly dropped. */
  bySource.unrecorded = 0;

  let eligible = 0;
  let withBand = 0;
  let beforeColumn = 0;

  for (const row of rows) {
    if (Date.parse(row.created_at) < cutover) {
      beforeColumn += 1;
      continue;
    }
    /* A survey trade has no products, so it is not a miss. */
    if (row.quote_model === "survey") continue;

    eligible += 1;
    if (row.band_slug === null) continue;

    withBand += 1;
    const source = row.band_source ?? "unrecorded";
    bySource[source] = (bySource[source] ?? 0) + 1;
  }

  return {
    ok: true,
    value: { eligible, withBand, bySource, since, beforeColumn },
  };
}
