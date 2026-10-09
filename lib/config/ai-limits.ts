/**
 * What the AI is allowed to cost, and what one person is allowed to ask.
 *
 * WHY THIS IS ONE FILE. Every number here is a product decision about money, and they
 * were about to be scattered across a route handler, a rate limiter and a browser
 * component. The abuse surface is only readable if it can be read at once — which is also
 * how you notice the one that is missing. `lib/server/rate-limit.ts`'s `LIMITS` already
 * works this way and this is its sibling: that one rations REQUESTS, this one rations
 * MONEY and judges what a request is.
 *
 * THE NUMBERS ARE DEFAULTS, NOT CONSTANTS. `/admin/ai-limits` can move every one of them,
 * under a fresh second-factor proof, with the change audited. `DEFAULT_AI_LIMITS` is what
 * a fresh deployment starts at and what every read falls back to when the settings row is
 * unreadable — rule 6's shape for configuration: a failed read must not silently become
 * "no limit".
 *
 * WHAT THEY ARE NOT. None of this is a fraud control and none of it is security. A
 * visitor's counter hangs off a cookie, which anybody can clear; an account's counter is
 * real but an account is free to make once the gateway works. These are COST CEILINGS:
 * they bound what one afternoon can spend, they make scripted abuse expensive rather than
 * impossible, and they must never be described as more than that.
 *
 * AND NOTHING HERE TOUCHES SAFETY. Every refusal below still runs the free keyword check
 * — gas, sparks, burning, live wire, in English and Nepali — and still shows the
 * emergency guidance. A budget that could silence a hazard warning would be a budget
 * worth more than the product.
 */

/** Nepal is UTC+5:45 with no daylight saving. Shared with `lib/photos/freshness.ts`. */
import { NEPAL_UTC_OFFSET_MINUTES } from "@/lib/photos/freshness";

export type AiLimits = {
  /* ---- signed out ---------------------------------------------------- */
  /**
   * How many triages a visitor gets in a day, before signing in.
   *
   * TWO, AND IT IS A SAMPLE RATHER THAN A SERVICE. Somebody who has never heard of us
   * should be able to type their problem and see what it would cost — that is the whole
   * pitch of the landing page. Two is enough to try it and ask again with better words;
   * it is not enough to use the product without an account, which is the point.
   */
  anonTriagesPerDay: number;
  /** A visitor's question is capped shorter: the free text is the whole input cost. */
  anonMaxChars: number;

  /* ---- signed in ------------------------------------------------------ */
  userTextPerDay: number;
  /** Lower than text, because a photograph costs about twice as much and never caches. */
  userPhotosPerDay: number;
  userMaxChars: number;

  /* ---- off-topic ------------------------------------------------------ */
  /** Consecutive off-topic questions before AI triage pauses for this account. */
  offTopicStreakToPause: number;
  /** How long the pause lasts. A person, not a ban — see `aiPauseEndsAt`. */
  offTopicPauseHours: number;
  /** A second pause inside this window is flagged for a person to look at. */
  offTopicRepeatWindowDays: number;

  /* ---- photographs ----------------------------------------------------- */
  /**
   * Unrelated photographs before the upload closes for this question.
   *
   * COUNTED ON THE SERVER AGAINST THE ACCOUNT, which is the whole change from the
   * browser-side version: `MAX_REJECTED_PHOTOS` lived in React state and a refresh
   * cleared it. "This question" is a rolling window rather than a request id, because a
   * request id is a number the browser chooses and a counter keyed to it resets itself.
   */
  unrelatedPhotosPerRequest: number;
  /** The window that stands in for "this question". */
  photoRequestWindowMinutes: number;

  /* ---- the budget ------------------------------------------------------ */
  /**
   * What the whole site may spend on the model in one Nepal day, in US dollars.
   *
   * MEASURED FROM WHAT THE PROVIDER REPORTS, never estimated from our own token guesses:
   * every response carries `usage`, and `lib/server/ai-budget.ts` prices that. A ceiling
   * computed from an estimate is a ceiling that drifts from the bill.
   */
  dailyBudgetUsd: number;
  /**
   * The most of that day's budget visitors may have between them, in basis points.
   *
   * TWENTY PER CENT, AND THE SPLIT IS THE POINT RATHER THAN THE NUMBER. Without it one
   * scripted afternoon of anonymous questions spends the whole day's budget and the
   * people who signed in — the ones who might actually book — get the category picker.
   * The reservation is one-way: visitors cannot reach the other 80%, and signed-in users
   * are not capped at it, so a quiet day for visitors is not wasted.
   */
  visitorShareBps: number;
};

export const DEFAULT_AI_LIMITS: AiLimits = {
  anonTriagesPerDay: 2,
  anonMaxChars: 300,
  userTextPerDay: 10,
  userPhotosPerDay: 4,
  userMaxChars: 500,
  offTopicStreakToPause: 2,
  offTopicPauseHours: 24,
  offTopicRepeatWindowDays: 7,
  unrelatedPhotosPerRequest: 2,
  photoRequestWindowMinutes: 30,
  dailyBudgetUsd: 1,
  visitorShareBps: 2000,
};

/**
 * Hard bounds on what the admin screen may set.
 *
 * WHY A SETTINGS SCREEN NEEDS THEM. Every number here is editable by a person under time
 * pressure, and a mistyped zero is either a product that stops answering or a budget with
 * no ceiling. The bounds are wide enough that no legitimate tuning hits them and narrow
 * enough that a slip does — and they are enforced in SQL as well, so a write that goes
 * round the screen is refused by the database.
 */
export const AI_LIMIT_BOUNDS: Record<keyof AiLimits, { min: number; max: number }> = {
  anonTriagesPerDay: { min: 0, max: 50 },
  anonMaxChars: { min: 50, max: 2000 },
  userTextPerDay: { min: 1, max: 500 },
  userPhotosPerDay: { min: 0, max: 100 },
  userMaxChars: { min: 50, max: 2000 },
  offTopicStreakToPause: { min: 1, max: 20 },
  offTopicPauseHours: { min: 1, max: 168 },
  offTopicRepeatWindowDays: { min: 1, max: 90 },
  unrelatedPhotosPerRequest: { min: 1, max: 10 },
  photoRequestWindowMinutes: { min: 5, max: 1440 },
  dailyBudgetUsd: { min: 0, max: 1000 },
  visitorShareBps: { min: 0, max: 10000 },
};

/** Every key, in the order the admin screen shows them. One list, read by both. */
export const AI_LIMIT_KEYS = Object.keys(DEFAULT_AI_LIMITS) as (keyof AiLimits)[];

/** Clamp one value into its bounds, so a stored row can never put the gate out of range. */
export function clampLimit(key: keyof AiLimits, value: number): number {
  const bound = AI_LIMIT_BOUNDS[key];
  if (!Number.isFinite(value)) return DEFAULT_AI_LIMITS[key];
  return Math.min(bound.max, Math.max(bound.min, Math.round(value * 100) / 100));
}

/**
 * Read a stored row into limits, falling back per field rather than wholesale.
 *
 * PER FIELD, BECAUSE A HALF-WRITTEN ROW IS THE LIKELY FAILURE. A column added in a later
 * migration is null on every row written before it, and taking the whole row as unusable
 * would throw away eleven good numbers over one missing one.
 */
export function aiLimitsFrom(row: Record<string, unknown> | null | undefined): AiLimits {
  const out = { ...DEFAULT_AI_LIMITS };
  if (!row) return out;
  for (const key of AI_LIMIT_KEYS) {
    const raw = row[snake(key)];
    if (typeof raw === "number") out[key] = clampLimit(key, raw);
  }
  return out;
}

/** `anonTriagesPerDay` → `anon_triages_per_day`. The column names are derived, not typed twice. */
export function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Which Nepal day an instant falls in, as `YYYY-MM-DD`.
 *
 * THE DAY ROLLS AT MIDNIGHT IN KATHMANDU, not at UTC midnight, because the budget is a
 * promise to people here: "the AI is back tomorrow" has to mean tomorrow where they are.
 * UTC midnight is 05:45 local, so a UTC day would reset the budget during the morning
 * rush and again mid-evening on the clock somebody is actually reading.
 *
 * Derived from the one offset constant rather than a timezone library: Nepal has been
 * UTC+5:45 since 1986 and has no daylight saving, and a dependency for a number that has
 * not moved in forty years is a dependency to maintain.
 */
export function nepalDayKey(at: Date = new Date()): string {
  const local = new Date(at.getTime() + NEPAL_UTC_OFFSET_MINUTES * 60_000);
  return local.toISOString().slice(0, 10);
}

/** When the current Nepal day ends, as an instant — what a "back tomorrow" line reads. */
export function nepalDayEndsAt(at: Date = new Date()): Date {
  const local = new Date(at.getTime() + NEPAL_UTC_OFFSET_MINUTES * 60_000);
  const midnightLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
  );
  return new Date(midnightLocal - NEPAL_UTC_OFFSET_MINUTES * 60_000);
}
