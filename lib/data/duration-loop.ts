import "server-only";

import {
  countsAsEvidence,
  durationOutcome,
  proposeDuration,
  type DurationKind,
  type DurationProposal,
} from "@/lib/booking";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The nightly sweep that turns our guessed durations into measured ones.
 *
 * WHAT WAS OPEN. `proposeDuration` is the rule; this is its only caller, and it
 * is written in the same phase on purpose — a statistic with no caller is the
 * sin this repository has recorded four times (`applyRedoRecovery` ran for four
 * phases with nothing invoking it, `proposeBand` for four more).
 *
 * IT RIDES ON `/api/bookings/dispatch` rather than getting a cron of its own,
 * for the reason that route already gives the quote sweep: Hobby allows two
 * schedules and both are taken, both of these are idempotent, and a third
 * scheduled endpoint is a third thing that can silently stop running. It runs
 * on the booking cron and not the payments one because nothing here touches
 * money, and `/api/payments/reconcile` is the route that holds the service-role
 * key on a money path.
 *
 * IDEMPOTENT. Every decision comes from the completed bookings that exist when
 * it runs, so running late, twice or overlapping writes the same answer — the
 * only cost of a second run in one night is a second observation row saying the
 * same thing, and `settled` stops it writing the sub-band again.
 */

/** One sub-band's published figures and provenance, as the sweep reads them. */
type PublishedBand = {
  categorySlug: string;
  slug: string;
  minutes: number;
  span: number;
  minutesSource: "invented" | "researched" | "observed";
  spanSource: "invented" | "researched" | "observed";
};

export type DurationSweep = {
  /** Observation rows written — one per sub-band per kind that had evidence. */
  readings: number;
  /** Sub-band figures replaced by a measurement. */
  applied: number;
  /** Measured, and still short of the floor. The shadow half. */
  belowFloor: number;
  /** Already published as what the data says. Nothing to do. */
  settled: number;
  /**
   * Named when the sweep could not run at all.
   *
   * A READ THAT FAILED IS NOT A SWEEP THAT FOUND NOTHING — rule 6 in the shape
   * it takes for a job. Reporting zeroes would make a broken query
   * indistinguishable from a quiet night, and `cron_runs` would record a
   * successful run either way.
   */
  skipped?: "notConfigured" | "bandsUnreadable" | "bookingsUnreadable";
};

const EMPTY: DurationSweep = {
  readings: 0,
  applied: 0,
  belowFloor: 0,
  settled: 0,
};

export async function sweepDurationPromotions(): Promise<DurationSweep> {
  if (!hasSupabaseConfig()) return { ...EMPTY, skipped: "notConfigured" };

  const supabase = createAdminClient();

  const { data: bandRows, error: bandError } = await supabase
    .from("category_price_bands")
    .select(
      "category_slug, slug, typical_working_minutes, typical_elapsed_days, duration_source, span_source",
    );

  if (bandError || !bandRows) {
    console.error(`[duration-loop] bands unreadable — ${describeError(bandError)}`);
    return { ...EMPTY, skipped: "bandsUnreadable" };
  }

  const { data: bookingRows, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "category_slug, band_slug, band_source, actual_working_minutes, actual_elapsed_days",
    )
    .eq("status", "completed")
    .not("band_slug", "is", null);

  if (bookingError || !bookingRows) {
    console.error(
      `[duration-loop] bookings unreadable — ${describeError(bookingError)}`,
    );
    return { ...EMPTY, skipped: "bookingsUnreadable" };
  }

  const published = new Map<string, PublishedBand>();
  for (const row of bandRows as Array<Record<string, unknown>>) {
    const band: PublishedBand = {
      categorySlug: row.category_slug as string,
      slug: row.slug as string,
      minutes: Number(row.typical_working_minutes),
      span: Number(row.typical_elapsed_days),
      minutesSource: provenance(row.duration_source),
      spanSource: provenance(row.span_source),
    };
    published.set(key(band.categorySlug, band.slug), band);
  }

  const minutes = new Map<string, number[]>();
  const spans = new Map<string, number[]>();

  for (const row of bookingRows as Array<Record<string, unknown>>) {
    // A guarantee visit is not independent evidence, and neither is a row
    // whose provenance nobody recorded — `countsAsEvidence` holds the reason.
    if (!countsAsEvidence({ bandSource: row.band_source as string | null })) {
      continue;
    }

    const id = key(row.category_slug as string, row.band_slug as string);
    if (!published.has(id)) continue;

    const worked = row.actual_working_minutes as number | null;
    if (worked !== null) push(minutes, id, Number(worked));

    const days = row.actual_elapsed_days as number | null;
    if (days !== null) push(spans, id, Number(days));
  }

  const result = { ...EMPTY };

  for (const band of published.values()) {
    const id = key(band.categorySlug, band.slug);

    for (const kind of ["minutes", "span"] as const) {
      const proposal = proposeDuration({
        kind,
        values: (kind === "minutes" ? minutes.get(id) : spans.get(id)) ?? [],
        published: kind === "minutes" ? band.minutes : band.span,
        source: kind === "minutes" ? band.minutesSource : band.spanSource,
      });

      const outcome = durationOutcome(proposal.decision);
      /*
       * The two halves of one condition, and the second is not redundant to
       * the compiler. `durationOutcome` returns null exactly when there is no
       * evidence, which is exactly when `observed` is null — but that
       * correspondence lives in `proposeDuration` and TypeScript cannot see it
       * from here. A `?? 0` instead would write a zero
       * `duration_observations_shape_check` refuses, losing the row.
       */
      if (!outcome || proposal.observed === null) continue;
      const observed = proposal.observed;

      if (proposal.decision.act) {
        const moved = await promote(band, kind, proposal.decision.to, proposal);
        // A FAILED WRITE IS NOT AN APPLICATION. The observation row records
        // what the loop decided; if the sub-band did not move, saying it did
        // would be the past-tense-column mistake with a boolean.
        if (!moved) continue;
        result.applied += 1;
      } else if (outcome === "below-floor") {
        result.belowFloor += 1;
      } else {
        result.settled += 1;
      }

      const logged = await record(band, proposal, observed, outcome);
      if (logged) result.readings += 1;
    }
  }

  return result;
}

function key(categorySlug: string, slug: string): string {
  return `${categorySlug}/${slug}`;
}

function push(into: Map<string, number[]>, id: string, value: number): void {
  const existing = into.get(id);
  if (existing) existing.push(value);
  else into.set(id, [value]);
}

/** Fails closed to `invented`, which for a duration means "do not publish it". */
function provenance(value: unknown): "invented" | "researched" | "observed" {
  return value === "researched" || value === "observed" ? value : "invented";
}

/**
 * Move the published figure, and say in the note where it came from.
 *
 * ONLY THE ONE NUMBER AND ITS OWN PROVENANCE. Promoting the minutes must not
 * touch `span_source`, which is the whole point of there being two columns: a
 * same-day completion is the only minutes evidence there is, and it says nothing
 * about how many days a repaint takes.
 */
async function promote(
  band: PublishedBand,
  kind: DurationKind,
  to: number,
  proposal: DurationProposal,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const note =
    `Median of ${proposal.sample} completed ${band.categorySlug} ` +
    `${band.slug} jobs, replacing ${proposal.published}. ` +
    (proposal.unusual > 0
      ? `${proposal.unusual} outside the Tukey fence — worth asking whether this is two products.`
      : "No outliers.");

  const patch =
    kind === "minutes"
      ? {
          typical_working_minutes: to,
          duration_source: "observed",
          duration_checked_at: today,
          duration_note: note,
        }
      : {
          typical_elapsed_days: to,
          span_source: "observed",
          span_checked_at: today,
          span_note: note,
        };

  const { error } = await createAdminClient()
    .from("category_price_bands")
    .update(patch)
    .eq("category_slug", band.categorySlug)
    .eq("slug", band.slug);

  if (error) {
    console.error(
      `[duration-loop] ${band.categorySlug}/${band.slug} ${kind} not promoted — ${describeError(error)}`,
    );
    return false;
  }
  return true;
}

/** The append-only reading. Never throws: the decision has already happened. */
async function record(
  band: PublishedBand,
  proposal: DurationProposal,
  observed: number,
  outcome: string,
): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("duration_observations")
    .insert({
      category_slug: band.categorySlug,
      band_slug: band.slug,
      kind: proposal.kind,
      sample: proposal.sample,
      observed,
      published: proposal.published,
      published_source:
        proposal.kind === "minutes" ? band.minutesSource : band.spanSource,
      unusual: proposal.unusual,
      floor_sample: proposal.floor,
      outcome,
    });

  if (error) {
    console.error(
      `[duration-loop] reading not recorded for ${band.categorySlug}/${band.slug} — ${describeError(error)}`,
    );
    return false;
  }
  return true;
}

/**
 * What the loop knows, for `/admin/duration`.
 *
 * ONE READ PER SUB-BAND PAIR, computed with the same `proposeDuration` the
 * sweep runs rather than a second opinion that could drift. The screen is the
 * shadow view: for a sub-band below its floor it shows what the loop WOULD do
 * and how many more jobs it needs, which is the whole reason the rule returns a
 * decision object rather than a boolean.
 */
export type DurationView = {
  categorySlug: string;
  bandSlug: string;
  minutes: DurationProposal & { source: string; checkedAt: string | null };
  span: DurationProposal & { source: string; checkedAt: string | null };
};

export type DurationReading = {
  observedAt: string;
  categorySlug: string;
  bandSlug: string;
  kind: string;
  sample: number;
  observed: number;
  published: number;
  outcome: string;
};

/**
 * Null means the read failed, and that is not "nothing has been measured".
 *
 * Rule 6 in the shape it takes for a screen: a failed query rendering as "no
 * evidence anywhere" would read as a product that has collected nothing, on the
 * one screen built to say whether it has.
 */
export async function durationEvidence(): Promise<DurationView[] | null> {
  if (!hasSupabaseConfig()) return null;

  const supabase = createAdminClient();

  const [bands, bookings] = await Promise.all([
    supabase
      .from("category_price_bands")
      .select(
        "category_slug, slug, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, span_source, span_checked_at",
      )
      .order("category_slug")
      .order("sort_order"),
    supabase
      .from("bookings")
      .select(
        "category_slug, band_slug, band_source, actual_working_minutes, actual_elapsed_days",
      )
      .eq("status", "completed")
      .not("band_slug", "is", null),
  ]);

  if (bands.error || !bands.data || bookings.error || !bookings.data) {
    console.error(
      `[duration-loop] evidence unreadable — ${describeError(bands.error ?? bookings.error)}`,
    );
    return null;
  }

  const minutes = new Map<string, number[]>();
  const spans = new Map<string, number[]>();

  for (const row of bookings.data as Array<Record<string, unknown>>) {
    if (!countsAsEvidence({ bandSource: row.band_source as string | null })) {
      continue;
    }
    const id = key(row.category_slug as string, row.band_slug as string);

    const worked = row.actual_working_minutes as number | null;
    if (worked !== null) push(minutes, id, Number(worked));
    const days = row.actual_elapsed_days as number | null;
    if (days !== null) push(spans, id, Number(days));
  }

  return (bands.data as Array<Record<string, unknown>>).map((row) => {
    const categorySlug = row.category_slug as string;
    const bandSlug = row.slug as string;
    const id = key(categorySlug, bandSlug);

    return {
      categorySlug,
      bandSlug,
      minutes: {
        ...proposeDuration({
          kind: "minutes",
          values: minutes.get(id) ?? [],
          published: Number(row.typical_working_minutes),
          source: provenance(row.duration_source),
        }),
        source: provenance(row.duration_source),
        checkedAt: (row.duration_checked_at as string | null) ?? null,
      },
      span: {
        ...proposeDuration({
          kind: "span",
          values: spans.get(id) ?? [],
          published: Number(row.typical_elapsed_days),
          source: provenance(row.span_source),
        }),
        source: provenance(row.span_source),
        checkedAt: (row.span_checked_at as string | null) ?? null,
      },
    };
  });
}

/** The loop's own history. Null is a failed read, never an empty log. */
export async function durationReadings(
  limit = 40,
): Promise<DurationReading[] | null> {
  if (!hasSupabaseConfig()) return null;

  const { data, error } = await createAdminClient()
    .from("duration_observations")
    .select(
      "observed_at, category_slug, band_slug, kind, sample, observed, published, outcome",
    )
    .order("observed_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.error(`[duration-loop] readings unreadable — ${describeError(error)}`);
    return null;
  }

  return (data as Array<Record<string, unknown>>).map((row) => ({
    observedAt: row.observed_at as string,
    categorySlug: row.category_slug as string,
    bandSlug: row.band_slug as string,
    kind: row.kind as string,
    sample: Number(row.sample),
    observed: Number(row.observed),
    published: Number(row.published),
    outcome: row.outcome as string,
  }));
}
