import "server-only";

/**
 * A small fixed-window rate limiter, in memory.
 *
 * /api/triage is anonymous, public, and costs money per call, so it needs a
 * ceiling. This is the cheapest thing that provides one.
 *
 * Honest about what it is: the counters live in the process, so on Vercel each
 * serverless instance enforces its own ceiling and a burst spread across
 * instances gets a multiple of it. That is a soft ceiling on cost, not a
 * security control. When it stops being enough the fix is Upstash or Vercel KV
 * behind this same function signature — nothing outside needs to change.
 */

export type RateLimitVerdict =
  { ok: true } | { ok: false; retryAfterSeconds: number };

type Window = { count: number; resetAt: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Per minute and per hour, on the same key.
 *
 * Twelve a minute is comfortably above one person typing — the hero debounces
 * at 600ms and identical text is served from cache — and well below a script.
 * Sixty an hour stops someone leaving a tab looping all afternoon.
 */
export const TRIAGE_LIMITS = { perMinute: 12, perHour: 60 };

const minuteWindows = new Map<string, Window>();
const hourWindows = new Map<string, Window>();

/** Drop expired entries so an idle process does not hold every key it saw. */
function sweep(windows: Map<string, Window>, now: number) {
  if (windows.size < 5000) return;
  // Array.from rather than for..of: the tsconfig target does not
  // down-level Map iteration.
  for (const [key, window] of Array.from(windows.entries())) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

function hit(
  windows: Map<string, Window>,
  key: string,
  limit: number,
  span: number,
  now: number,
): RateLimitVerdict {
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + span });
    return { ok: true };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      ),
    };
  }

  existing.count += 1;
  return { ok: true };
}

/**
 * Count one request against `key` (a user id when signed in, an IP otherwise).
 *
 * Both windows are consumed together so a caller cannot spend the minute
 * budget without also spending the hour's.
 */
export function checkTriageRateLimit(key: string): RateLimitVerdict {
  const now = Date.now();
  sweep(minuteWindows, now);
  sweep(hourWindows, now);

  const perMinute = hit(
    minuteWindows,
    key,
    TRIAGE_LIMITS.perMinute,
    MINUTE,
    now,
  );
  const perHour = hit(hourWindows, key, TRIAGE_LIMITS.perHour, HOUR, now);

  if (!perMinute.ok) return perMinute;
  if (!perHour.ok) return perHour;
  return { ok: true };
}

/** Test seam — the windows are module state, so tests need a way to reset. */
export function resetRateLimits() {
  minuteWindows.clear();
  hourWindows.clear();
}
