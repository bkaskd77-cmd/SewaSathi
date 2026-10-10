import { beforeEach, describe, expect, it } from "vitest";

import {
  resetAiQuotas,
  spendDaily,
  spendUnrelatedPhoto,
  unrelatedPhotosSoFar,
  usedToday,
} from "@/lib/server/ai-quota";

/**
 * A refresh must not reset a count. This is the case that proves it.
 *
 * THE OLD VERSION LIVED IN REACT STATE and a page refresh cleared it, which made it a
 * nudge rather than a ceiling. What makes the new one survive is not care: it is that
 * nothing in the key comes from the browser. The subject is a profile id the session
 * supplies or a device cookie the server set; the window is a Nepal day the server
 * computes. There is no request id, because a request id is a number the browser chooses
 * and a new tab chooses a new one.
 *
 * Exercised through the in-process fallback, which is what runs when Upstash is not
 * configured — the same counters, the same keys, no network.
 */

beforeEach(() => {
  resetAiQuotas();
});

describe("nothing a browser does resets a count", () => {
  it("keeps counting the same account across calls", async () => {
    expect(await spendDaily("userPhoto", "acc-1")).toBe(1);
    expect(await spendDaily("userPhoto", "acc-1")).toBe(2);
    /* A "refresh" is just another call with the same subject. There is no per-request
       state anywhere for one to clear. */
    expect(await usedToday("userPhoto", "acc-1")).toBe(2);
  });

  it("counts unrelated photographs against the account, not a request", async () => {
    await spendUnrelatedPhoto("acc-1", 30);
    await spendUnrelatedPhoto("acc-1", 30);
    expect(await unrelatedPhotosSoFar("acc-1")).toBe(2);
  });

  it("keeps two people apart", async () => {
    await spendDaily("userText", "acc-1");
    expect(await usedToday("userText", "acc-2")).toBe(0);
    expect(await unrelatedPhotosSoFar("acc-2")).toBe(0);
  });

  it("keeps the kinds apart, so text and photographs have separate allowances", async () => {
    await spendDaily("userText", "acc-1");
    await spendDaily("userText", "acc-1");
    expect(await usedToday("userPhoto", "acc-1")).toBe(0);
  });

  it("counts a visitor's off-topic answer once and remembers it", async () => {
    await spendDaily("anonOffTopic", "device:abc");
    expect(await usedToday("anonOffTopic", "device:abc")).toBe(1);
    expect(await usedToday("anonOffTopic", "device:xyz")).toBe(0);
  });
});

describe("the route answers a refusal rather than erroring", () => {
  /*
   * READ FROM THE SOURCE, because the alternative is standing up the whole handler with
   * Supabase, Upstash and Anthropic mocked to assert one status code. What matters is
   * narrow and is visible in the text: the refusal path builds its answer from the
   * keyword matcher, runs the safety floor over it, and returns a plain
   * `NextResponse.json` — which is a 200. A `status: 4xx` or a `throw` on that path is
   * the regression, and it would be silent: the browser's own catch falls back locally,
   * so the product would still answer and would simply stop saying why.
   */
  it("builds the refusal from the matcher and the safety floor, with no status", async () => {
    const source = await read("app/api/triage/route.ts");
    const fn = source.slice(source.indexOf("async function refusedAnswer"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 2);

    expect(body).toMatch(/applySafetyFloor\(/);
    expect(body).toMatch(/keywordAnswer\(/);
    expect(body).toMatch(/aiRefusal: input\.refusal/);
    expect(body).toMatch(/reason: "ceiling-reached"/);
    /* No status and no throw: a 200 carrying the sentence. */
    expect(body).not.toMatch(/status:\s*[45]\d\d/);
    expect(body).not.toMatch(/\bthrow\b/);
  });
});

async function read(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}
