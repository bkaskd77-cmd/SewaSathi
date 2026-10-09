import { beforeEach, describe, expect, it } from "vitest";

import {
  cacheKey,
  clearTriageCache,
  readTriageCache,
  writeTriageCache,
} from "@/lib/server/triage-cache";
import type { TriageResult } from "@/lib/ai/mockTriage";

/**
 * The same photograph sent twice is a retry, not a second question.
 *
 * THE OLD RULE WAS "PHOTOS ARE NEVER CACHED" and the reason it gave was about using the
 * IMAGE as a key — two photographs of the same tap are not the same request, and holding
 * base64 in a warm process is not free. Both true, and both answered rather than
 * overruled: the key is a 64-bit perceptual hash now, so no bytes are held and two
 * different photographs still miss.
 */

const ANSWER: TriageResult = {
  category: "plumbing",
  urgency: "soon",
  priceRangeNPR: [900, 4000],
  explanation: "A dripping tap.",
  band: null,
};

const HASH = "0f1e2d3c4b5a6978";
const OTHER = "ffffffffffffffff";

beforeEach(() => {
  clearTriageCache();
});

describe("the photo hash is part of the key", () => {
  it("serves the same photograph and the same words from the cache", () => {
    writeTriageCache("tap is dripping", "en", ANSWER, HASH);
    expect(readTriageCache("tap is dripping", "en", HASH)?.result).toEqual(ANSWER);
  });

  it("misses on a different photograph with the same words", () => {
    writeTriageCache("tap is dripping", "en", ANSWER, HASH);
    expect(readTriageCache("tap is dripping", "en", OTHER)).toBeNull();
  });

  it("misses on the same photograph with different words", () => {
    /* A photograph with new words is a new question, and paying for it is correct. */
    writeTriageCache("tap is dripping", "en", ANSWER, HASH);
    expect(readTriageCache("it has got worse", "en", HASH)).toBeNull();
  });

  it("never serves a photo answer to a text-only question, or the reverse", () => {
    /*
     * THE ONE THAT WOULD BE SILENT. Without the photo segment in the key, a question
     * with a photograph and the same words would hit a text-only entry — and the
     * photo verdict would simply not be there, so the retake line would vanish.
     */
    writeTriageCache("tap is dripping", "en", ANSWER);
    expect(readTriageCache("tap is dripping", "en", HASH)).toBeNull();

    clearTriageCache();
    writeTriageCache("tap is dripping", "en", ANSWER, HASH);
    expect(readTriageCache("tap is dripping", "en")).toBeNull();
  });

  it("keeps a locale miss a miss, with a photograph attached", () => {
    writeTriageCache("tap is dripping", "en", ANSWER, HASH);
    expect(readTriageCache("tap is dripping", "ne", HASH)).toBeNull();
  });

  it("treats a photograph that would not hash as uncacheable, not as a shared key", () => {
    /* `perceptualHash` returns null on bytes it cannot decode. A null in the key would
       make every undecodable photograph the same question as every other. */
    expect(cacheKey("tap", "en", null)).toBe(cacheKey("tap", "en"));
    expect(cacheKey("tap", "en", HASH)).not.toBe(cacheKey("tap", "en"));
  });
});

describe("the verdict rides with the answer", () => {
  it("gives the retake line back on a retry, rather than looking accepted", () => {
    const verdict = { relevance: "unrelated", reason: "this looks like a window" };
    writeTriageCache("", "en", ANSWER, HASH, verdict);
    expect(readTriageCache("", "en", HASH)?.photo).toEqual(verdict);
  });

  it("carries null for a text answer, which is what no photograph means", () => {
    writeTriageCache("tap is dripping", "en", ANSWER);
    expect(readTriageCache("tap is dripping", "en")?.photo).toBeNull();
  });
});
