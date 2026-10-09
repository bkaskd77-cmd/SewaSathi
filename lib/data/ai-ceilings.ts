import "server-only";

import { cache } from "react";

import { recordSecurityEvent } from "@/lib/audit";
import {
  AI_LIMIT_KEYS,
  DEFAULT_AI_LIMITS,
  aiLimitsFrom,
  clampLimit,
  nepalDayKey,
  snake,
  type AiLimits,
} from "@/lib/config/ai-limits";
import { shareOf, type BudgetShares, type CallCost } from "@/lib/ai/spend";
import type { OffTopicState } from "@/lib/ai/offtopic";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The stored half of the AI ceiling: the settings, the day's spend, the pauses.
 *
 * EVERY READ FALLS BACK TO THE DEFAULTS AND NEVER TO "NO LIMIT" — rule 6's shape for
 * configuration. A settings row that will not load must not read as an unbounded budget,
 * and a spend row that will not load must not read as nothing spent. Both failures bite
 * in the same direction: towards the ceiling, never past it.
 *
 * EXCEPT ONE, DELIBERATELY. An unreadable `ai_account_state` reads as "not paused". A
 * failed read there would otherwise lock somebody out of the product over a database
 * hiccup, and the cost of being wrong is one more model call rather than money that
 * cannot be recovered — which is the opposite trade from the budget.
 */

/**
 * The settings, once per request.
 *
 * `cache()`d for the same reason `getSessionProfile` is: the gate reads them, the route
 * reads them to cap the text length, and the badge reads them to say what is left. Three
 * round trips for one row that changes a few times a year.
 */
export const readAiLimits = cache(async (): Promise<AiLimits> => {
  if (!hasSupabaseConfig()) return DEFAULT_AI_LIMITS;
  try {
    const { data, error } = await createAdminClient()
      .from("ai_limits")
      .select(
        "anon_triages_per_day, anon_max_chars, user_text_per_day, user_photos_per_day, user_max_chars, off_topic_streak_to_pause, off_topic_pause_hours, off_topic_repeat_window_days, unrelated_photos_per_request, photo_request_window_minutes, daily_budget_usd, visitor_share_bps",
      )
      .eq("id", true)
      .maybeSingle();

    if (error) {
      console.error(`[ai-limits] unread — ${describeError(error)}`);
      return DEFAULT_AI_LIMITS;
    }
    return aiLimitsFrom(data as Record<string, unknown> | null);
  } catch (thrown) {
    console.error(`[ai-limits] read threw — ${describeError(thrown)}`);
    return DEFAULT_AI_LIMITS;
  }
});

export type SpendToday = BudgetShares & {
  dayKey: string;
  calls: number;
  visitorCalls: number;
  photoCalls: number;
  unknownModelCalls: number;
  /** False when the row could not be read — see the header on which way that fails. */
  read: boolean;
};

/** What today has cost, and what is left of each share. */
export async function readSpendToday(
  limits: AiLimits,
  at: Date = new Date(),
): Promise<SpendToday> {
  const dayKey = nepalDayKey(at);
  const empty = (read: boolean, spent = 0, visitorSpent = 0): SpendToday => ({
    dayKey,
    ...shareOf({
      dailyBudgetUsd: limits.dailyBudgetUsd,
      visitorShareBps: limits.visitorShareBps,
      spentUsd: spent,
      visitorSpentUsd: visitorSpent,
    }),
    calls: 0,
    visitorCalls: 0,
    photoCalls: 0,
    unknownModelCalls: 0,
    read,
  });

  if (!hasSupabaseConfig()) return empty(true);

  try {
    const { data, error } = await createAdminClient()
      .from("ai_spend")
      .select(
        "day_key, total_usd, visitor_usd, calls, visitor_calls, photo_calls, unknown_model_calls",
      )
      .eq("day_key", dayKey)
      .maybeSingle();

    if (error) {
      /*
       * A FAILED READ SPENDS THE BUDGET, not opens it. We cannot establish what today has
       * cost, so the honest answer is that it may already be gone — and the product keeps
       * working from the keyword matcher, which is what the fallback is for.
       */
      console.error(`[ai-spend] unread — ${describeError(error)}`);
      return empty(false, limits.dailyBudgetUsd, limits.dailyBudgetUsd);
    }

    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ...empty(
        true,
        Number(row.total_usd ?? 0),
        Number(row.visitor_usd ?? 0),
      ),
      calls: Number(row.calls ?? 0),
      visitorCalls: Number(row.visitor_calls ?? 0),
      photoCalls: Number(row.photo_calls ?? 0),
      unknownModelCalls: Number(row.unknown_model_calls ?? 0),
    };
  } catch (thrown) {
    console.error(`[ai-spend] read threw — ${describeError(thrown)}`);
    return empty(false, limits.dailyBudgetUsd, limits.dailyBudgetUsd);
  }
}

/**
 * Add one call's measured cost to today.
 *
 * NEVER THROWS AND NEVER BLOCKS THE ANSWER. The call already happened and the customer is
 * waiting; a spend row that fails to write costs us an undercount, where an exception
 * here would cost somebody their triage. The undercount is logged, which is the
 * compensating control, and the per-request ceilings do not depend on this row.
 *
 * UPSERT-THEN-ADD IN ONE STATEMENT, because two calls a millisecond apart both read "zero
 * so far" and both write their own cost — the race the booking claim and the payout index
 * are both shaped around. Postgres does the addition.
 */
export async function recordAiSpend(input: {
  cost: CallCost;
  model: string;
  visitor: boolean;
  hasPhoto: boolean;
  at?: Date;
}): Promise<void> {
  if (!hasSupabaseConfig()) return;
  const dayKey = nepalDayKey(input.at ?? new Date());

  try {
    const { error } = await createAdminClient().rpc("add_ai_spend", {
      p_day_key: dayKey,
      p_usd: input.cost.usd,
      p_visitor: input.visitor,
      p_photo: input.hasPhoto,
      p_unknown_model: input.cost.pricedAsUnknown,
    });
    if (error) console.error(`[ai-spend] not recorded — ${describeError(error)}`);
  } catch (thrown) {
    console.error(`[ai-spend] record threw — ${describeError(thrown)}`);
  }
}

const NO_STATE: OffTopicState = {
  streak: 0,
  pausedUntil: null,
  lastPausedAt: null,
};

/** An account's off-topic streak and pause. An unreadable row reads as not paused. */
export async function readAccountState(
  profileId: string | null,
): Promise<OffTopicState> {
  if (!profileId || !hasSupabaseConfig()) return NO_STATE;
  try {
    const { data, error } = await createAdminClient()
      .from("ai_account_state")
      .select("off_topic_streak, paused_until, last_paused_at")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error || !data) return NO_STATE;
    return {
      streak: Number(data.off_topic_streak ?? 0),
      pausedUntil: (data.paused_until as string | null) ?? null,
      lastPausedAt: (data.last_paused_at as string | null) ?? null,
    };
  } catch {
    return NO_STATE;
  }
}

/** Store the new state, and the review flag when this pause was a repeat. */
export async function writeAccountState(input: {
  profileId: string;
  state: OffTopicState;
  flagForReview: boolean;
  at: Date;
}): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const { error } = await createAdminClient()
      .from("ai_account_state")
      .upsert(
        {
          profile_id: input.profileId,
          off_topic_streak: input.state.streak,
          paused_until: input.state.pausedUntil,
          last_paused_at: input.state.lastPausedAt,
          ...(input.flagForReview
            ? { review_flagged_at: input.at.toISOString() }
            : {}),
          updated_at: input.at.toISOString(),
        },
        { onConflict: "profile_id" },
      );
    if (error) console.error(`[ai-state] not written — ${describeError(error)}`);
  } catch (thrown) {
    console.error(`[ai-state] write threw — ${describeError(thrown)}`);
  }
}

export type SaveLimitsResult =
  | { ok: true; limits: AiLimits }
  | { ok: false; reason: string };

/**
 * Change the ceilings, under a name.
 *
 * CLAMPED BEFORE THE WRITE AND CHECKED AGAIN BY THE DATABASE, which is two guards for one
 * rule on purpose: the clamp gives the admin a saved value instead of an error on a slip,
 * and the constraint is what a write going round this function still meets.
 *
 * EVERY CHANGE IS AUDITED WITH BOTH NUMBERS. "The budget changed" is not a record; "the
 * budget went from 1 to 50, by this person, at this time" is the only form that answers
 * the question somebody will actually ask. Unchanged fields are left out, so the row reads
 * as what was done rather than as a snapshot.
 */
export async function saveAiLimits(input: {
  next: Partial<AiLimits>;
  actorId: string;
}): Promise<SaveLimitsResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const current = await readAiLimits();
  const changes: Record<string, { from: number; to: number }> = {};
  const row: Record<string, number> = {};

  for (const key of AI_LIMIT_KEYS) {
    const proposed = input.next[key];
    if (typeof proposed !== "number") continue;
    const clamped = clampLimit(key, proposed);
    if (clamped === current[key]) continue;
    changes[key] = { from: current[key], to: clamped };
    row[snake(key)] = clamped;
  }

  if (Object.keys(row).length === 0) return { ok: true, limits: current };

  try {
    const { error } = await createAdminClient()
      .from("ai_limits")
      .update({ ...row, updated_by: input.actorId, updated_at: new Date().toISOString() })
      .eq("id", true);

    if (error) {
      console.error(`[ai-limits] not saved — ${describeError(error)}`);
      return { ok: false, reason: "saveFailed" };
    }
  } catch (thrown) {
    console.error(`[ai-limits] save threw — ${describeError(thrown)}`);
    return { ok: false, reason: "saveFailed" };
  }

  await recordSecurityEvent({
    kind: "aiLimits.changed",
    actorId: input.actorId,
    actorRole: "admin",
    detail: { changes },
  });

  return { ok: true, limits: { ...current, ...(input.next as AiLimits) } };
}
