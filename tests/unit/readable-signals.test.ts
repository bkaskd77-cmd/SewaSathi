import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unreadable, type Readable } from "@/lib/data/readable";

/*
 * `cache()` is React's per-request memo and there is no request here. A
 * pass-through is the right stand-in: these reads are being watched for which
 * of the three states they return, not for how often they may run.
 */
vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

/**
 * A failed read is not an empty one, on the screens where that is the news.
 *
 * WHAT WAS WRONG. `listPricingSignals` and `listPaymentMix` both returned `[]`
 * on failure *and* on empty. So a query that broke would have rendered
 * **"cash share 0%"** — which is not a shrug, it is good news, on the one
 * screen built to decide whether to spend money reducing cash. The same
 * mistake as a column default presented as a fact (standing rule 6), one level
 * up: a whole dataset defaulting to zero rather than a number.
 *
 * `unreadableQueue()` already solved this for the queues, where "0 waiting"
 * from a broken query is the sentence that tells somebody to go home. These
 * are the same rule for reads that have no cap and no total.
 */

describe("the three states", () => {
  it("tells a failed read apart from an empty one", () => {
    const failed = unreadable<number>();
    const empty: Readable<number> = { ok: true, rows: [] };

    expect(failed.ok).toBe(false);
    expect(empty.ok).toBe(true);
    // The discriminant is what a screen branches on. `rows` is null on failure
    // so a caller that forgets to check `ok` gets a crash rather than a zero.
    expect(failed.rows).toBeNull();
    expect(empty.rows).toEqual([]);
  });
});

describe("the reads themselves", () => {
  const saved = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    if (saved.url) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
  });

  /*
   * No Supabase configured is the cheapest reachable "we could not read this",
   * and it is the one a fresh clone hits. If either of these ever goes back to
   * returning `[]` here, the screen silently starts reporting zero cash on a
   * product it cannot see at all.
   */
  it("report unreadable rather than empty when there is no database", async () => {
    const { listPricingSignals, listPaymentMix } = await import(
      "@/lib/data/payments"
    );

    expect((await listPricingSignals()).ok).toBe(false);
    expect((await listPaymentMix()).ok).toBe(false);
  });
});
