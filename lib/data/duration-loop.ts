import "server-only";

import {
  countsAsEvidence,
  durationOutcome,
  proposeDuration,
  releaseSampleFor,
  type DurationKind,
  type DurationProposal,
  type RevertedDuration,
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
  skipped?:
    | "notConfigured"
    | "bandsUnreadable"
    | "bookingsUnreadable"
    | "revertsUnreadable";
  /** Nights the loop would have acted and a person's revert held it back. */
  suppressed: number;
};

const EMPTY: DurationSweep = {
  readings: 0,
  applied: 0,
  belowFloor: 0,
  settled: 0,
  suppressed: 0,
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

  const reverts = await latestReverts(supabase);
  if (!reverts) return { ...EMPTY, skipped: "revertsUnreadable" };

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
        revert: reverts.get(revertKey(band.categorySlug, band.slug, kind)) ?? null,
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
      } else if (outcome === "suppressed") {
        /*
         * COUNTED SEPARATELY FROM `settled`, because they are opposite facts
         * about the same figure: settled means the published number is what the
         * data says, suppressed means the data says something else and a person
         * has refused it. Folding them would make a disputed figure read as an
         * agreed one in `cron_runs`, which is the only place anybody sees the
         * sweep's shape.
         */
        result.suppressed += 1;
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
 * The newest revert per sub-band and kind, keyed the way the sweep looks it up.
 *
 * ONE READ FOR THE WHOLE SWEEP rather than one per sub-band: 36 sub-bands times
 * two kinds is 72 round trips to Singapore for a table that will hold single
 * figures for years, and the latency rule in CLAUDE.md is that a round trip is
 * the unit of cost.
 *
 * NULL IS A FAILED READ AND IT STOPS THE SWEEP. Treating it as "nothing has
 * been reverted" would have the loop re-publish every figure a person has taken
 * down, which is the one outcome the suppression exists to prevent — rule 6, in
 * the shape where reading a failure as an absence does real damage rather than
 * printing a wrong number.
 */
async function latestReverts(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Map<string, RevertedDuration> | null> {
  const { data, error } = await supabase
    .from("duration_reverts")
    .select("category_slug, band_slug, kind, from_value, sample, reverted_at")
    .order("reverted_at", { ascending: false });

  if (error || !data) {
    console.error(`[duration-loop] reverts unreadable — ${describeError(error)}`);
    return null;
  }

  const newest = new Map<string, RevertedDuration>();
  for (const row of data as Array<Record<string, unknown>>) {
    // Ordered newest first, so the first row for a key is the one that counts
    // and every later one is history.
    const id = revertKey(
      row.category_slug as string,
      row.band_slug as string,
      row.kind as string,
    );
    if (newest.has(id)) continue;
    newest.set(id, {
      fromValue: Number(row.from_value),
      sample: Number(row.sample),
    });
  }
  return newest;
}

function revertKey(categorySlug: string, bandSlug: string, kind: string): string {
  return `${categorySlug}/${bandSlug}/${kind}`;
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
/**
 * One figure as the screen needs it: the proposal, where the published number
 * came from, and whether a person has taken one down.
 *
 * `revertedFrom` and `releaseAt` are what make a suppression readable. A hidden
 * proposal and no proposal must not look alike — `category_price_revisions`
 * settled that one decision over, and here it matters more, because the thing
 * being held back is a machine that would otherwise act tonight.
 */
export type DurationFigure = DurationProposal & {
  source: string;
  checkedAt: string | null;
  /** The figure a person took down, or null if none was. */
  revertedFrom: number | null;
  /** The sample that would let it be published again. Null with no revert. */
  releaseAt: number | null;
};

export type DurationView = {
  categorySlug: string;
  bandSlug: string;
  minutes: DurationFigure;
  span: DurationFigure;
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

  const [bands, bookings, reverts] = await Promise.all([
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
    latestReverts(supabase),
  ]);

  if (bands.error || !bands.data || bookings.error || !bookings.data || !reverts) {
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

    /*
     * ONE BUILDER FOR BOTH KINDS. They were two near-identical object literals,
     * and threading the revert through would have made them two places to
     * forget it — `countsAsEvidence` was written twice for exactly one commit
     * and that is the divergence `lib/provider/measured.ts` exists to prevent.
     */
    const figure = (
      kind: DurationKind,
      values: number[],
      published: number,
      source: "invented" | "researched" | "observed",
      checkedAt: string | null,
    ): DurationFigure => {
      const revert = reverts.get(revertKey(categorySlug, bandSlug, kind)) ?? null;
      return {
        ...proposeDuration({ kind, values, published, source, revert }),
        source,
        checkedAt,
        revertedFrom: revert?.fromValue ?? null,
        releaseAt: revert ? releaseSampleFor(revert) : null,
      };
    };

    return {
      categorySlug,
      bandSlug,
      minutes: figure(
        "minutes",
        minutes.get(id) ?? [],
        Number(row.typical_working_minutes),
        provenance(row.duration_source),
        (row.duration_checked_at as string | null) ?? null,
      ),
      span: figure(
        "span",
        spans.get(id) ?? [],
        Number(row.typical_elapsed_days),
        provenance(row.span_source),
        (row.span_checked_at as string | null) ?? null,
      ),
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

/* ------------------------------------------------------------------ *
 * Taking a published duration back down
 * ------------------------------------------------------------------ */

/**
 * One action, and every outcome is named rather than collapsed into a boolean.
 *
 * `noPromotion` and `notObserved` are different facts and the screen says
 * which: the first is a figure the loop has never moved (so there is nothing to
 * go back to), the second is a figure that is not currently the loop's (so
 * there is nothing to take down). A single "cannot" would leave somebody
 * guessing at a screen that is refusing them.
 */
export type DurationRevert =
  | { ok: true; from: number; to: number; source: string; releaseAt: number }
  | {
      ok: false;
      why:
        | "notConfigured"
        | "bandUnreadable"
        | "notObserved"
        | "noPromotion"
        | "notRecorded"
        | "writeFailed";
    };

/**
 * Put a published duration back to what it replaced, and record who did it.
 *
 * WHAT IT REVERTS TO IS READ, NEVER CHOSEN. `duration_observations` holds the
 * promotion's own row, carrying `published` and `published_source` — the figure
 * and provenance in force the moment the loop replaced them — so the target is
 * evidence rather than somebody's recollection, and `sample` on the same row is
 * the denominator the suppression rule needs. There is no field for an admin to
 * type a duration into, deliberately: that would be a second way to publish a
 * number nobody measured, which is what `duration_source = 'invented'` already
 * means and what this whole loop exists to get away from.
 *
 * THE REVERT ROW IS WRITTEN BEFORE THE FIGURE MOVES, and the order is the
 * `trip_compensation` lesson. If the record lands and the band write fails, the
 * suppression is live and the figure is unchanged — visible on the screen,
 * harmless, and a person can try again. The other order moves the figure with
 * nothing suppressing it, so that night's sweep silently puts it back and the
 * decision is undone by a machine.
 *
 * Audited twice over, and the two are not redundant. `duration_reverts` answers
 * "is this figure held back, and what would release it", which the sweep has to
 * ask on every run; `security_events` is the append-only record of a staff
 * action that no caller can tidy afterwards.
 */
export async function revertDuration(input: {
  categorySlug: string;
  bandSlug: string;
  kind: DurationKind;
  reason: string;
  actorId: string;
}): Promise<DurationRevert> {
  if (!hasSupabaseConfig()) return { ok: false, why: "notConfigured" };

  const reason = input.reason.trim();
  // The check constraint refuses a blank, and reaching it would lose the whole
  // statement rather than telling somebody to write a sentence.
  if (!reason) return { ok: false, why: "notRecorded" };

  const supabase = createAdminClient();
  const minutesKind = input.kind === "minutes";

  const { data: band, error: bandError } = await supabase
    .from("category_price_bands")
    .select(
      "typical_working_minutes, typical_elapsed_days, duration_source, span_source",
    )
    .eq("category_slug", input.categorySlug)
    .eq("slug", input.bandSlug)
    .maybeSingle();

  if (bandError || !band) {
    console.error(`[duration-loop] band unreadable — ${describeError(bandError)}`);
    return { ok: false, why: "bandUnreadable" };
  }

  const row = band as Record<string, unknown>;
  const source = provenance(minutesKind ? row.duration_source : row.span_source);
  if (source !== "observed") return { ok: false, why: "notObserved" };

  const from = Number(
    minutesKind ? row.typical_working_minutes : row.typical_elapsed_days,
  );

  const { data: promotions, error: promotionError } = await supabase
    .from("duration_observations")
    .select("published, published_source, sample")
    .eq("category_slug", input.categorySlug)
    .eq("band_slug", input.bandSlug)
    .eq("kind", input.kind)
    .eq("outcome", "applied")
    .order("observed_at", { ascending: false })
    .limit(1);

  if (promotionError || !promotions) {
    console.error(
      `[duration-loop] promotions unreadable — ${describeError(promotionError)}`,
    );
    return { ok: false, why: "bandUnreadable" };
  }
  /*
   * NO PROMOTION ROW AND AN `observed` FIGURE IS A REAL STATE, not a
   * contradiction: `duration_observations` ships after the seed, so a figure
   * authored `observed` in the JSON has no promotion behind it. Reverting it
   * would mean inventing both the target and its sample, which is the
   * manufactured record `profiles_record_role_change` refuses.
   */
  if (promotions.length === 0) return { ok: false, why: "noPromotion" };

  const promotion = promotions[0] as Record<string, unknown>;
  const to = Number(promotion.published);
  const toSource = provenance(promotion.published_source);
  const sample = Number(promotion.sample);

  if (to === from) {
    // The promotion row says the loop replaced this figure with itself, which
    // `proposeDuration` cannot produce — `settled` is what it returns when the
    // median already matches. Nothing to move, and
    // `duration_reverts_moved_check` would refuse the row anyway.
    return { ok: false, why: "noPromotion" };
  }

  const { error: recordError } = await supabase.from("duration_reverts").insert({
    category_slug: input.categorySlug,
    band_slug: input.bandSlug,
    kind: input.kind,
    from_value: from,
    to_value: to,
    to_source: toSource,
    sample,
    actor_id: input.actorId,
    reason,
  });

  if (recordError) {
    console.error(`[duration-loop] revert not recorded — ${describeError(recordError)}`);
    return { ok: false, why: "notRecorded" };
  }

  const note =
    `Reverted from ${from} by a person, back to the ${toSource} figure it ` +
    `replaced. The loop will not publish ${from} again until the sample ` +
    `reaches ${releaseSampleFor({ fromValue: from, sample })}.`;

  const patch = minutesKind
    ? {
        typical_working_minutes: to,
        duration_source: toSource,
        duration_note: note,
      }
    : { typical_elapsed_days: to, span_source: toSource, span_note: note };

  const { error: writeError } = await supabase
    .from("category_price_bands")
    .update(patch)
    .eq("category_slug", input.categorySlug)
    .eq("slug", input.bandSlug);

  if (writeError) {
    console.error(`[duration-loop] revert not applied — ${describeError(writeError)}`);
    return { ok: false, why: "writeFailed" };
  }

  return {
    ok: true,
    from,
    to,
    source: toSource,
    releaseAt: releaseSampleFor({ fromValue: from, sample }),
  };
}

/** The revert history, for the screen. Null is a failed read, never an empty log. */
export type DurationRevertRow = {
  revertedAt: string;
  categorySlug: string;
  bandSlug: string;
  kind: string;
  fromValue: number;
  toValue: number;
  sample: number;
  reason: string;
};

export async function durationReverts(
  limit = 20,
): Promise<DurationRevertRow[] | null> {
  if (!hasSupabaseConfig()) return null;

  const { data, error } = await createAdminClient()
    .from("duration_reverts")
    .select(
      "reverted_at, category_slug, band_slug, kind, from_value, to_value, sample, reason",
    )
    .order("reverted_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.error(`[duration-loop] reverts unreadable — ${describeError(error)}`);
    return null;
  }

  return (data as Array<Record<string, unknown>>).map((row) => ({
    revertedAt: row.reverted_at as string,
    categorySlug: row.category_slug as string,
    bandSlug: row.band_slug as string,
    kind: row.kind as string,
    fromValue: Number(row.from_value),
    toValue: Number(row.to_value),
    sample: Number(row.sample),
    reason: row.reason as string,
  }));
}
