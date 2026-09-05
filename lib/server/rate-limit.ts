import "server-only";

/**
 * How often one person may do a thing, counted somewhere both instances can see.
 *
 * WHAT WAS WRONG WITH THE OLD ONE, and it read stronger than it was: the
 * counters lived in the process. On Vercel each serverless instance enforced
 * its own ceiling, so a burst spread across instances got a multiple of it,
 * and a cold start reset it to zero. As a soft cost ceiling on triage that was
 * honest — it said so. As a control on OTP requests it would have been
 * theatre, and OTP is the one that matters: every message costs money, a
 * flood is a bill, and an attempt ceiling that resets whenever a new instance
 * spins up is not a ceiling.
 *
 * SHARED STORE WHEN THERE IS ONE, in-process when there is not. Upstash Redis
 * over its REST API — no TCP connection to hold open, which is what makes it
 * work from a serverless function at all. `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` switch it on and nothing else changes; without
 * them this falls back to the old behaviour and `rateLimitStore()` says which
 * is in force, so `/api/health` can report it rather than everyone assuming.
 *
 * IT FAILS OPEN, deliberately. If Upstash is unreachable the request is
 * allowed and the failure is logged. The alternative locks every customer out
 * of signing in because a third party had a bad minute — trading a certain
 * outage for a possible abuse, which is the wrong way round for a product
 * whose only door is an SMS code. The log line is the compensating control.
 */

export type RateLimitVerdict =
  { ok: true } | { ok: false; retryAfterSeconds: number };

type Window = { count: number; resetAt: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Every surface with a ceiling, and why each number is what it is.
 *
 * They are here together rather than beside their callers so the whole abuse
 * surface can be read at once — which is also how you notice the one that is
 * missing.
 */
export const LIMITS = {
  /*
   * Triage costs money per call. Twelve a minute is comfortably above one
   * person typing — the hero debounces at 600ms and identical text is served
   * from cache — and well below a script. Sixty an hour stops somebody
   * leaving a tab looping all afternoon.
   */
  triage: { perMinute: 12, perHour: 60 },
  /*
   * One phone number. Tight, because every send is an SMS we pay for and a
   * person who genuinely did not get the code needs two or three tries, not
   * thirty. Supabase enforces its own limit underneath this; ours is the one
   * we can see and reason about.
   */
  "otp:number": { perMinute: 3, perHour: 8 },
  /*
   * One network. Looser than per-number because a family, an office or a
   * shared connection is one IP, and locking a whole building out of signing
   * in is worse than the flood it prevents. It exists to stop somebody
   * walking the number space from a single machine.
   */
  "otp:ip": { perMinute: 10, perHour: 40 },
  /*
   * Wrong codes. This is the one that stops a brute force of a six-digit
   * number: ten tries an hour against a million possibilities is not a
   * guessing attack any more.
   */
  "otp:attempt": { perMinute: 5, perHour: 10 },
  /** A real customer books one job, occasionally two. Twenty an hour is a script. */
  booking: { perMinute: 3, perHour: 20 },
  /** The join form is public and unauthenticated, so it is a spam target. */
  join: { perMinute: 2, perHour: 10 },
} as const;

export type LimitName = keyof typeof LIMITS;

/** Kept for the triage route's own copy of the numbers. */
export const TRIAGE_LIMITS = LIMITS.triage;

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
export async function checkRateLimit(
  name: LimitName,
  key: string,
): Promise<RateLimitVerdict> {
  const limits = LIMITS[name];
  const shared = sharedConfig();

  if (shared) {
    const verdict = await hitShared(shared, name, key, limits);
    // A store that could not answer must not be a store that locks everybody
    // out. Fall through to the in-process counters, which are weaker but real.
    if (verdict) return verdict;
  }

  return hitLocal(`${name}:${key}`, limits);
}

/** Which store is actually in force, so `/api/health` can say so. */
export function rateLimitStore(): "shared" | "in-process" {
  return sharedConfig() ? "shared" : "in-process";
}

function sharedConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

/**
 * Two counters, incremented and expired in one round trip.
 *
 * `EXPIRE ... NX` only sets the deadline the first time, so a window is a
 * fixed window from the first request rather than one that slides forward with
 * every hit — otherwise a steady stream of requests would keep pushing the
 * expiry out and the key would never reset.
 */
async function hitShared(
  config: { url: string; token: string },
  name: LimitName,
  key: string,
  limits: { perMinute: number; perHour: number },
): Promise<RateLimitVerdict | null> {
  const minuteKey = `rl:${name}:m:${key}`;
  const hourKey = `rl:${name}:h:${key}`;

  try {
    const response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", minuteKey],
        ["EXPIRE", minuteKey, "60", "NX"],
        ["INCR", hourKey],
        ["EXPIRE", hourKey, "3600", "NX"],
      ]),
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`store answered ${response.status}`);

    const results = (await response.json()) as Array<{ result: number }>;
    const perMinute = Number(results[0]?.result ?? 0);
    const perHour = Number(results[2]?.result ?? 0);

    if (perMinute > limits.perMinute) return { ok: false, retryAfterSeconds: 60 };
    if (perHour > limits.perHour) return { ok: false, retryAfterSeconds: 600 };
    return { ok: true };
  } catch (error) {
    // Logged rather than thrown: see the note at the top about failing open.
    console.error(
      `[rate-limit] shared store unreachable, falling back in-process — ${(error as Error).message}`,
    );
    return null;
  }
}

function hitLocal(
  key: string,
  limits: { perMinute: number; perHour: number },
): RateLimitVerdict {
  const now = Date.now();
  sweep(minuteWindows, now);
  sweep(hourWindows, now);

  const perMinute = hit(minuteWindows, key, limits.perMinute, MINUTE, now);
  const perHour = hit(hourWindows, key, limits.perHour, HOUR, now);

  if (!perMinute.ok) return perMinute;
  if (!perHour.ok) return perHour;
  return { ok: true };
}

/** The old name, kept so the triage route reads the same. */
export async function checkTriageRateLimit(
  key: string,
): Promise<RateLimitVerdict> {
  return checkRateLimit("triage", key);
}

/** Test seam — the windows are module state, so tests need a way to reset. */
export function resetRateLimits() {
  minuteWindows.clear();
  hourWindows.clear();
}
