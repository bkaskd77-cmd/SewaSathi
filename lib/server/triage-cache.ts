import "server-only";

import type { Locale } from "@/i18n/routing";
import type { TriageResult } from "@/lib/ai/mockTriage";

/**
 * Identical recent questions, answered once.
 *
 * "water leak" is typed by everybody. Without this each one is a paid API call
 * for an answer we already have.
 *
 * A PHOTO REQUEST IS CACHED NOW, AND THE OLD REASON NOT TO IS ANSWERED RATHER THAN
 * OVERRULED. The note here read "two photos of the same tap are not the same request,
 * and holding base64 in a process Vercel keeps warm is not free" — both true, and both
 * about using the IMAGE as the key. The key is a 64-bit perceptual hash now, sixteen hex
 * characters, so nothing holds any bytes and two different photographs of the same tap
 * still miss. Only the same file sent twice hits, which is the case this exists for: a
 * retry on a weak connection, costing the most expensive call we make.
 *
 * THE HASH IS PART OF THE KEY, NOT THE WHOLE KEY. The same photograph with different
 * words is a different question and pays for a call; the same photograph with the same
 * words — which is what a retry is — is the same question.
 *
 * Keyed by locale as well as text: the explanation comes back in the reader's
 * language, so "water leak" answered in English is not an answer for somebody
 * reading Nepali. Missing that would serve English prose into a Nepali card
 * for ten minutes at a time, which is exactly the kind of half-translated
 * result this migration exists to stop.
 *
 * Same caveat as the rate limiter — per instance, not global. A hit rate below
 * 100% costs money, not correctness.
 */

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 500;

/**
 * The photo verdict rides with the answer, or a retry loses the retake line.
 *
 * Without it, re-sending the same unrelated photograph would hit the cache, skip the
 * model, and come back with no "that looks like something else" — so the second attempt
 * would look like it had been accepted. The verdict is part of the answer, not a side
 * effect of having made the call.
 */
type CachedPhoto = { relevance: string; reason: string | null } | null;

/**
 * THE SAME RULE, APPLIED TO THE SECOND VERDICT. The paragraph above was written
 * for the photo and the topic verdict arrived a phase later without it, so a
 * cached answer came back with `topic: null` — "nobody judged these words".
 *
 * The cost is not the missing line, it is the RESET: one good question clears a
 * signed-in account's off-topic streak, and a good question that happened to be
 * cached cleared nothing. Somebody at streak 1 stayed at streak 1 and was paused
 * by their next slip. A verdict is part of the answer, not a side effect of
 * having paid for the call.
 *
 * An off-topic reply is never cached at all — it has no result to cache, and the
 * gate refuses the next attempt anyway — so this only ever replays `onTopic: true`.
 */
type CachedTopic = { onTopic: boolean; reason: string | null } | null;

type Entry = {
  result: TriageResult;
  photo: CachedPhoto;
  topic: CachedTopic;
  expiresAt: number;
};

const cache = new Map<string, Entry>();

/** Case, spacing and trailing punctuation should not miss a cache hit. */
export function cacheKey(
  text: string,
  locale: Locale,
  photoHash?: string | null,
): string {
  const normalised = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();
  /*
   * A PHOTOGRAPH THAT WOULD NOT HASH NEVER HITS AND NEVER WRITES. `perceptualHash`
   * returns null on bytes it cannot decode, and `photo:null` as a key would make every
   * undecodable photograph the same question as every other — rule 6 in the shape it
   * takes for a cache key. The caller is what refuses; this would be the quiet way to
   * get it wrong, so the key says so.
   */
  const photo = photoHash ? `photo:${photoHash}:` : "";
  return `${photo}${locale}:${normalised}`;
}

export function readTriageCache(
  text: string,
  locale: Locale,
  photoHash?: string | null,
): { result: TriageResult; photo: CachedPhoto; topic: CachedTopic } | null {
  const key = cacheKey(text, locale, photoHash);
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  // Map keeps insertion order, so re-inserting makes this the newest entry and
  // the eviction below becomes least-recently-used rather than oldest-written.
  cache.delete(key);
  cache.set(key, entry);
  return { result: entry.result, photo: entry.photo, topic: entry.topic };
}

export function writeTriageCache(
  text: string,
  locale: Locale,
  result: TriageResult,
  photoHash?: string | null,
  photo: CachedPhoto = null,
  topic: CachedTopic = null,
) {
  const key = cacheKey(text, locale, photoHash);
  cache.delete(key);
  cache.set(key, { result, photo, topic, expiresAt: Date.now() + TTL_MS });

  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Test seam. */
export function clearTriageCache() {
  cache.clear();
}
