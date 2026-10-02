import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import {
  MIN_PROPOSAL_SAMPLE,
  PROPOSAL_WINDOW_DAYS,
  proposalSuppressedBy,
  proposeBand,
  visitPriceIsMarketPrice,
  type BandConfidence,
  type BandProposal,
} from "@/lib/data/band-proposal";
import { unreadable, type Readable } from "@/lib/data/readable";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What our own settled jobs say a band should be, and who decided it.
 *
 * THE ARITHMETIC EXISTED AND NOTHING CALLED IT. `proposeBand` has been written,
 * tested and documented since Phase 9 with no production caller — the four-phase
 * sin this project keeps recording, one module over from `applyRedoRecovery`.
 * This is the caller. What was already wired is `proposeBandCorrection`, a
 * different thing: one professional correcting one booking's band.
 *
 * COMPUTED ON DEMAND, WITH NO PROPOSALS TABLE. A stored proposal is stale the
 * moment another job settles, and then it needs its own freshness rule, which is
 * a second thing to keep honest for no gain. `category_price_revisions` stores
 * DECISIONS — what somebody did and why — which do not go stale because they are
 * history rather than advice.
 *
 * NOTHING HERE APPLIES ANYTHING BY ITSELF. The band sets the quote, the quote
 * anchors what gets agreed, and those agreed figures are the rows this reads — so
 * a band that moved itself would be measuring its own shadow with no way to tell
 * a market move from the echo of its last change. A person approves. That is
 * `docs/PRICING-BANDS.md`'s authority rule and it is why there is an approve
 * button rather than a cron job.
 *
 * FORWARD-ONLY IS STRUCTURAL, NOT A FEATURE HERE. `bookings.band_min` and
 * `quoted_max` are frozen per row by `freeze_booking_band()`, so approving a band
 * cannot reach a quote that already exists. This module asserts that rather than
 * arranging it, and `tests/db/band-approval.test.ts` proves it against a database.
 */

/* ------------------------------------------------------------------ *
 * What a screen is handed
 * ------------------------------------------------------------------ */

/** The spread behind a proposal, so an owner weighs evidence rather than a number. */
export type BandSpread = {
  sample: number;
  q1: number;
  median: number;
  q3: number;
};

/** A decision somebody took, as the screen shows it back. */
export type BandDecision = {
  decision: "approved" | "rejected";
  low: number;
  high: number;
  proposedLow: number;
  proposedHigh: number;
  sample: number;
  reason: string;
  decidedAt: Date;
  /** Null when the profile was deleted, never "the system". */
  actorName: string | null;
};

export type BandRow = {
  slug: string;
  name: string;
  /** What is published right now. */
  current: { low: number; high: number };
  /** Where the published numbers came from — `invented` | `researched` | `observed`. */
  source: string;
  checkedAt: string | null;
  note: string | null;
  confidence: BandConfidence;
  /**
   * The spread of settled jobs in the window, or null when there are none.
   *
   * SHOWN EVEN WITH NO PROPOSAL, deliberately: watching p25/p75 drift for two
   * quarters before a proposal appears is how somebody builds the judgement the
   * approve button needs.
   */
  spread: BandSpread | null;
  /** How many settled jobs the window holds, and how many it needs. */
  sample: { have: number; needed: number };
  /**
   * The proposal, or null — and null has three different causes, which the
   * screen must not collapse. `suppressed` names the one that is a decision
   * rather than an absence.
   */
  proposal: BandProposal | null;
  /** Set when a proposal exists but somebody already said no to this exact pair. */
  suppressed: BandDecision | null;
  /** The most recent decision on this category, whatever it was. */
  lastDecision: BandDecision | null;
};

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

type AmountRow = {
  id: string;
  category_slug: string;
  final_amount: number | null;
};

/** Quantile on a sorted array — the same linear interpolation `proposeBand` uses. */
function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const at = (sorted.length - 1) * q;
  const lower = Math.floor(at);
  const upper = Math.ceil(at);
  if (lower === upper) return sorted[lower];
  return Math.round(sorted[lower] + (at - lower) * (sorted[upper] - sorted[lower]));
}

/**
 * The band editor's rows, one per category.
 *
 * THE SAMPLE EXCLUDES AN UNPAID RETURN VISIT, NOT EVERY RETURN VISIT, and that
 * is narrower than `docs/PRICING-BANDS.md § 4`'s "re-do visits" on purpose. A
 * visit whose verdict is `sameFault` is unpaid and is not a market price. A
 * `differentProblem`, `nothingWrong` or `customerCaused` visit is an ordinary
 * booking at the ordinary price — the guarantee rules say exactly that, in those
 * words — so excluding it would throw away real evidence. A visit with no verdict
 * yet is excluded too: unknown is not evidence either way, which is rule 6 in the
 * shape it takes for a sample.
 *
 * COMMISSION APPEALS ARE NOT EXCLUDED. An honest small job is precisely the
 * signal a floor should hear.
 */
export async function bandRows(): Promise<Readable<BandRow>> {
  if (!hasSupabaseConfig()) return unreadable<BandRow>();

  try {
    const db = createAdminClient();
    const since = new Date(
      Date.now() - PROPOSAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [categories, settled, excluded, decisions] = await Promise.all([
      db
        .from("categories")
        .select(
          "slug, name_en, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, is_active",
        )
        .eq("is_active", true)
        .order("sort_order"),
      db
        .from("bookings")
        .select("id, category_slug, final_amount")
        .eq("payment_status", "paid")
        .not("final_amount", "is", null)
        .gte("created_at", since),
      /*
       * The unpaid returns, by id. A `visit_booking_id` whose verdict is
       * `sameFault` or not yet given; the other three verdicts stay in the sample.
       */
      db
        .from("guarantee_claims")
        .select("visit_booking_id, verdict")
        .not("visit_booking_id", "is", null),
      db
        .from("category_price_revisions")
        .select(
          "category_slug, decision, new_min, new_max, proposed_min, proposed_max, sample, reason, decided_at, profiles:actor_id (full_name)",
        )
        .order("decided_at", { ascending: false }),
    ]);

    if (categories.error || settled.error || excluded.error || decisions.error) {
      console.error(
        `[bands] read failed — ${describeError(
          categories.error ?? settled.error ?? excluded.error ?? decisions.error,
        )}`,
      );
      return unreadable<BandRow>();
    }

    const unpaidVisits = new Set(
      (excluded.data ?? [])
        .filter((row) => !visitPriceIsMarketPrice(row.verdict))
        .map((row) => row.visit_booking_id)
        .filter((id): id is string => Boolean(id)),
    );

    const amounts = new Map<string, number[]>();
    for (const row of (settled.data ?? []) as AmountRow[]) {
      const amount = row.final_amount;
      if (amount === null || !Number.isFinite(amount) || amount <= 0) continue;
      /*
       * THE EXCLUSION IS APPLIED HERE, and the first version of this function
       * computed `unpaidVisits` and never consulted it — every link built and the
       * chain broken, which the linter caught and a reviewer would not have. The
       * `id` in the select above exists only for this line.
       */
      if (unpaidVisits.has(row.id)) continue;
      const list = amounts.get(row.category_slug) ?? [];
      list.push(amount);
      amounts.set(row.category_slug, list);
    }

    /*
     * Newest first, which the query ordered, so `history[0]` is the last decision
     * and `find(rejected)` is the most recent refusal. The embedded profile makes
     * the generated row type awkward to name, so the shape is asserted once here
     * rather than at every use.
     */
    type DecisionRow = {
      category_slug: string;
      decision: string;
      new_min: number;
      new_max: number;
      proposed_min: number;
      proposed_max: number;
      sample: number;
      reason: string;
      decided_at: string;
      profiles: { full_name: string | null } | null;
    };

    const byCategory = new Map<string, BandDecision[]>();
    for (const row of (decisions.data ?? []) as unknown as DecisionRow[]) {
      const list = byCategory.get(row.category_slug) ?? [];
      list.push({
        decision: row.decision === "approved" ? "approved" : "rejected",
        low: row.new_min,
        high: row.new_max,
        proposedLow: row.proposed_min,
        proposedHigh: row.proposed_max,
        sample: row.sample,
        reason: row.reason,
        decidedAt: new Date(row.decided_at),
        actorName: row.profiles?.full_name ?? null,
      });
      byCategory.set(row.category_slug, list);
    }

    const rows: BandRow[] = (categories.data ?? [])
      /*
       * A SURVEY CATEGORY HAS NO BAND TO REVISE. `pricing_model = 'survey'`
       * means the market quotes after a visit and we publish no range — the
       * movers decision — so a proposal here would be inventing the thing that
       * category exists to refuse.
       */
      .filter((category) => category.pricing_model !== "survey")
      .map((category) => {
        const confidence = (
          ["high", "medium", "low"] as const
        ).includes(category.pricing_confidence as BandConfidence)
          ? (category.pricing_confidence as BandConfidence)
          : "high";

        const sample = (amounts.get(category.slug) ?? [])
          .slice()
          .sort((a, b) => a - b);
        const needed = MIN_PROPOSAL_SAMPLE[confidence];
        const current = {
          low: category.base_price_min,
          high: category.base_price_max,
        };

        const proposal = proposeBand({ amounts: sample, current, confidence });
        const history = byCategory.get(category.slug) ?? [];
        const rejection = history.find((d) => d.decision === "rejected");

        const suppressed =
          proposal && rejection &&
          proposalSuppressedBy(
            {
              proposedLow: rejection.proposedLow,
              proposedHigh: rejection.proposedHigh,
              sample: rejection.sample,
            },
            proposal,
          )
            ? rejection
            : null;

        return {
          slug: category.slug,
          name: category.name_en,
          current,
          source: category.pricing_source,
          checkedAt: category.pricing_checked_at,
          note: category.pricing_note,
          confidence,
          spread:
            sample.length > 0
              ? {
                  sample: sample.length,
                  q1: quantileOf(sample, 0.25),
                  median: quantileOf(sample, 0.5),
                  q3: quantileOf(sample, 0.75),
                }
              : null,
          sample: { have: sample.length, needed },
          proposal,
          suppressed,
          lastDecision: history[0] ?? null,
        };
      });

    return { ok: true, rows };
  } catch (thrown) {
    console.error(`[bands] read threw — ${describeError(thrown)}`);
    return unreadable<BandRow>();
  }
}

/* ------------------------------------------------------------------ *
 * Deciding
 * ------------------------------------------------------------------ */

export type BandDecisionResult =
  | { ok: true }
  | { ok: false; reason: "unreadable" | "noCategory" | "noReason" | "refused" };

type DecisionInput = {
  slug: string;
  /** What the data proposed — recorded on both paths, since a rejection is about it. */
  proposal: Pick<BandProposal, "low" | "high" | "sample" | "winsorised" | "capped">;
  actorId: string;
  reason: string;
};

/**
 * Write the revision row, and on an approval the band itself.
 *
 * ONE FUNCTION FOR BOTH DECISIONS, because the row is the same row and the only
 * difference is whether `categories` moves. Two functions would be two places to
 * forget the audit, and the thing worth keeping identical is exactly what gets
 * recorded.
 *
 * SERVICE ROLE, AND `categories` KEEPS NO UPDATE POLICY. RLS is row-level: an
 * update policy on `categories` would make every column writable from a browser,
 * the Nepali copy included. That is the `profiles.role` escalation one table over,
 * and the answer there was a column grant rather than a policy.
 *
 * THE REVISION IS WRITTEN BEFORE THE BAND MOVES. If the band write fails the
 * history carries a decision that did not take effect, which is visible and
 * fixable; the other order would move a published price with no record of who
 * moved it. Append-only means the first cannot be tidied away, which is the
 * property that makes this ordering the safe one.
 */
async function decide(
  input: DecisionInput,
  decision: "approved" | "rejected",
  applied: { low: number; high: number } | null,
): Promise<BandDecisionResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };
  if (input.reason.trim().length === 0) return { ok: false, reason: "noReason" };

  try {
    const db = createAdminClient();

    const { data: category, error: readError } = await db
      .from("categories")
      .select("slug, base_price_min, base_price_max, pricing_note")
      .eq("slug", input.slug)
      .maybeSingle();

    if (readError) {
      console.error(`[bands] category read failed — ${describeError(readError)}`);
      return { ok: false, reason: "unreadable" };
    }
    if (!category) return { ok: false, reason: "noCategory" };

    const next = applied ?? {
      low: category.base_price_min,
      high: category.base_price_max,
    };

    const { error: writeError } = await db
      .from("category_price_revisions")
      .insert({
        category_slug: input.slug,
        decision,
        old_min: category.base_price_min,
        old_max: category.base_price_max,
        new_min: next.low,
        new_max: next.high,
        proposed_min: input.proposal.low,
        proposed_max: input.proposal.high,
        sample: input.proposal.sample,
        winsorised: input.proposal.winsorised,
        capped: input.proposal.capped,
        actor_id: input.actorId,
        reason: input.reason.trim(),
      });

    if (writeError) {
      console.error(`[bands] revision insert failed — ${describeError(writeError)}`);
      return { ok: false, reason: "refused" };
    }

    if (applied) {
      const { error: bandError } = await db
        .from("categories")
        .update({
          base_price_min: applied.low,
          base_price_max: applied.high,
          /*
           * `observed` is the third step of the provenance ladder and the one
           * `check:blockers` is waiting for: the band now comes from our own
           * settled jobs rather than from competitor research.
           */
          pricing_source: "observed",
          pricing_checked_at: new Date().toISOString().slice(0, 10),
          pricing_note: `${input.proposal.sample} settled jobs, robust p25/p75. ${input.reason.trim()}`,
        })
        .eq("slug", input.slug);

      if (bandError) {
        console.error(`[bands] band update failed — ${describeError(bandError)}`);
        return { ok: false, reason: "refused" };
      }
    }

    await recordSecurityEvent({
      kind: decision === "approved" ? "pricing.bandApproved" : "pricing.bandRejected",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "category",
      subjectId: input.slug,
      detail: {
        from: `${category.base_price_min}-${category.base_price_max}`,
        to: `${next.low}-${next.high}`,
        proposed: `${input.proposal.low}-${input.proposal.high}`,
        sample: input.proposal.sample,
        capped: input.proposal.capped,
        reason: input.reason.trim(),
      },
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[bands] decision threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}

/** Publish the proposed band. Forward only: no existing quote can change. */
export async function approveBand(input: DecisionInput): Promise<BandDecisionResult> {
  return decide(input, "approved", {
    low: input.proposal.low,
    high: input.proposal.high,
  });
}

/**
 * Record that somebody said no, which is what suppresses this pair.
 *
 * The band does not move, so `new_*` equals `old_*` — a rejection is a decision
 * about a proposal and not a change to a price. `proposalSuppressedBy` reads
 * `proposed_*` and `sample` off this row.
 */
export async function rejectBand(input: DecisionInput): Promise<BandDecisionResult> {
  return decide(input, "rejected", null);
}
