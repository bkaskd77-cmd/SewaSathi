import "server-only";

import { nepalDayEndsAt, nepalDayKey } from "@/lib/config/ai-limits";
import { sharedStoreConfig } from "@/lib/server/rate-limit";

/**
 * How much of today one person has already used.
 *
 * WHY NOT THE RATE LIMITER. That counts requests in a rolling minute and hour, which is
 * the right shape for "is this a script". This counts them in a NEPAL DAY, which is the
 * shape of a promise — "two questions a day, and the AI is back tomorrow" has to mean
 * tomorrow on the clock somebody is reading. A rolling 24 hours would be a different and
 * worse promise: it expires at a time nobody can predict.
 *
 * THE KEY CARRIES THE DAY, so the reset is the key changing rather than a counter being
 * cleared. Nothing has to run at midnight, a key written at 23:59 expires on its own, and
 * two instances cannot disagree about whether the day has turned.
 *
 * IT FAILS OPEN, like the rate limiter and for the same reason: a store with a bad minute
 * must not stop a customer asking about their leaking tap. What that costs is bounded by
 * two other controls that do not depend on it — the per-IP rate limit, which falls back
 * to in-process counters, and the daily budget, which lives in Postgres.
 *
 * IT IS A COST CEILING AND NEVER A SECURITY CONTROL. A visitor is counted against a
 * cookie they can clear. That is stated here rather than implied, because the difference
 * decides what this may be used for: bounding an afternoon's spend, never gating access
 * to anything that matters.
 */

export type QuotaKind =
  /** A signed-out visitor's triage. */
  | "anonTriage"
  /** A signed-in account's text triage. */
  | "userText"
  /** A signed-in account's photo analysis. */
  | "userPhoto";

/** Unrelated photographs inside one question's window — not a day counter. */
const UNRELATED_KIND = "unrelatedPhoto";

const local = new Map<string, { count: number; resetAt: number }>();

/** The key expires when the Nepal day does, so nothing has to run at midnight. */
function dayTtlSeconds(at: Date): number {
  const seconds = Math.ceil((nepalDayEndsAt(at).getTime() - at.getTime()) / 1000);
  return Math.max(60, seconds);
}

function dayKey(kind: QuotaKind, subject: string, at: Date): string {
  return `aiq:${kind}:${nepalDayKey(at)}:${subject}`;
}

/**
 * Add one to a counter and return the new value.
 *
 * INCREMENT-THEN-COMPARE, never read-then-write: two tabs a millisecond apart both read
 * "one used" and both proceed, which is the race the booking claim and the payout index
 * are both shaped around. `INCR` is atomic and the comparison happens on the answer.
 */
async function bump(key: string, ttlSeconds: number): Promise<number | null> {
  const config = sharedStoreConfig();

  if (config) {
    try {
      const response = await fetch(`${config.url}/pipeline`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, String(ttlSeconds), "NX"],
        ]),
        signal: AbortSignal.timeout(1500),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`store answered ${response.status}`);
      const results = (await response.json()) as Array<{ result: number }>;
      return Number(results[0]?.result ?? 0);
    } catch (error) {
      console.error(
        `[ai-quota] shared store unreachable — ${(error as Error).message}`,
      );
      /* Fall through to the in-process counter rather than refusing. */
    }
  }

  const now = Date.now();
  const existing = local.get(key);
  if (!existing || existing.resetAt <= now) {
    local.set(key, { count: 1, resetAt: now + ttlSeconds * 1000 });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

/** Read without spending. Used to show somebody what is left before they type. */
async function peek(key: string): Promise<number> {
  const config = sharedStoreConfig();
  if (config) {
    try {
      const response = await fetch(`${config.url}/get/${encodeURIComponent(key)}`, {
        headers: { authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(1500),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`store answered ${response.status}`);
      const body = (await response.json()) as { result: string | null };
      return Number(body.result ?? 0) || 0;
    } catch {
      /* A failed read is reported as zero used, which fails open — see the header. */
      return 0;
    }
  }
  const existing = local.get(key);
  return existing && existing.resetAt > Date.now() ? existing.count : 0;
}

/** One more of this kind, used today. Returns the running total including this one. */
export function spendDaily(
  kind: QuotaKind,
  subject: string,
  at: Date = new Date(),
): Promise<number | null> {
  return bump(dayKey(kind, subject, at), dayTtlSeconds(at));
}

/** How many of this kind have been used today, without using another. */
export function usedToday(
  kind: QuotaKind,
  subject: string,
  at: Date = new Date(),
): Promise<number> {
  return peek(dayKey(kind, subject, at));
}

/**
 * Unrelated photographs inside the window that stands in for "this question".
 *
 * KEYED TO THE ACCOUNT AND NOT TO A REQUEST ID, which is the whole reason this survives a
 * refresh. A request id is a number the browser chooses: a new tab chooses a new one and
 * the count starts again, which is exactly the hole the browser-side counter had. A
 * rolling window keyed to the account cannot be reset by anything the browser does.
 */
export function spendUnrelatedPhoto(
  accountId: string,
  windowMinutes: number,
): Promise<number | null> {
  return bump(`aiq:${UNRELATED_KIND}:${accountId}`, windowMinutes * 60);
}

export function unrelatedPhotosSoFar(accountId: string): Promise<number> {
  return peek(`aiq:${UNRELATED_KIND}:${accountId}`);
}

/** Test seam. The in-process half is module state, so tests need a way to clear it. */
export function resetAiQuotas() {
  local.clear();
}
