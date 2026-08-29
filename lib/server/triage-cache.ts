import "server-only";

import type { Locale } from "@/i18n/routing";
import type { TriageResult } from "@/lib/ai/mockTriage";

/**
 * Identical recent questions, answered once.
 *
 * "water leak" is typed by everybody. Without this each one is a paid API call
 * for an answer we already have.
 *
 * Text only. A photo request is never cached: two photos of the same tap are
 * not the same request, and holding base64 in a process that Vercel keeps warm
 * is not free.
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

type Entry = { result: TriageResult; expiresAt: number };

const cache = new Map<string, Entry>();

/** Case, spacing and trailing punctuation should not miss a cache hit. */
export function cacheKey(text: string, locale: Locale): string {
  const normalised = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();
  return `${locale}:${normalised}`;
}

export function readTriageCache(
  text: string,
  locale: Locale,
): TriageResult | null {
  const key = cacheKey(text, locale);
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
  return entry.result;
}

export function writeTriageCache(
  text: string,
  locale: Locale,
  result: TriageResult,
) {
  const key = cacheKey(text, locale);
  cache.delete(key);
  cache.set(key, { result, expiresAt: Date.now() + TTL_MS });

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
