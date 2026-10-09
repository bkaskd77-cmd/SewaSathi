import { beforeEach, describe, expect, it } from "vitest";

import {
  LIMITS,
  checkTriageRateLimit,
  resetRateLimits,
} from "@/lib/server/rate-limit";

/**
 * What a photograph is allowed to cost.
 *
 * WHY THIS IS A SEPARATE BUCKET AND NOT A TIGHTER SHARED ONE. A photograph costs about
 * twice a sentence — roughly 2,250 image tokens plus a reply against sixty plus a reply —
 * and the real gap is wider, because the ten-minute response cache is text-only: identical
 * text never reaches the model and a photograph reaches it every time. One ceiling across
 * both either rations somebody typing or lets somebody loop photographs.
 *
 * AND IT IS A COST CEILING, NOT A FRAUD CONTROL. `MAX_REJECTED_PHOTOS` closes the upload
 * after two unrelated photographs, but it lives in React state and a page refresh clears
 * it. This is the half that survives a refresh.
 */

const KEY = "ip:203.0.113.9";

beforeEach(() => {
  resetRateLimits();
});

describe("a photograph has its own ceiling", () => {
  it("is tighter than the text one, in both windows", () => {
    /* Asserted as an ordering rather than as two numbers: the point is that a photograph
       is rationed harder than a sentence, and that stays true if either is retuned. */
    expect(LIMITS["triage:photo"].perMinute).toBeLessThan(LIMITS.triage.perMinute);
    expect(LIMITS["triage:photo"].perHour).toBeLessThan(LIMITS.triage.perHour);
  });

  it("still allows a whole request's worth of photographs at once", () => {
    /* A request carries at most three, and somebody retaking a dark one twice is an
       ordinary customer rather than a script. */
    expect(LIMITS["triage:photo"].perMinute).toBeGreaterThanOrEqual(3);
  });

  it("refuses the photograph that passes it", async () => {
    for (let i = 0; i < LIMITS["triage:photo"].perMinute; i += 1) {
      expect((await checkTriageRateLimit(KEY, true)).ok).toBe(true);
    }
    const refused = await checkTriageRateLimit(KEY, true);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("leaves somebody typing alone when the photograph bucket is spent", async () => {
    /*
     * THE WHOLE REASON FOR TWO BUCKETS. A person who sent their photo allowance and then
     * describes the problem in words must still get an answer — the expensive path is
     * closed, the cheap one is not.
     */
    for (let i = 0; i < LIMITS["triage:photo"].perMinute; i += 1) {
      await checkTriageRateLimit(KEY, true);
    }
    expect((await checkTriageRateLimit(KEY, true)).ok).toBe(false);
    expect((await checkTriageRateLimit(KEY, false)).ok).toBe(true);
  });

  it("counts a photograph against the text ceiling as well", async () => {
    /* A photograph IS a triage. Spending the text ceiling with photographs must close
       the text path too, or the narrower bucket would be a way round the wider one. */
    for (let i = 0; i < LIMITS.triage.perMinute; i += 1) {
      await checkTriageRateLimit(KEY, i < LIMITS["triage:photo"].perMinute);
    }
    expect((await checkTriageRateLimit(KEY, false)).ok).toBe(false);
  });

  it("counts each caller separately", async () => {
    for (let i = 0; i < LIMITS["triage:photo"].perMinute; i += 1) {
      await checkTriageRateLimit(KEY, true);
    }
    expect((await checkTriageRateLimit(KEY, true)).ok).toBe(false);
    expect((await checkTriageRateLimit("ip:198.51.100.4", true)).ok).toBe(true);
  });
});
