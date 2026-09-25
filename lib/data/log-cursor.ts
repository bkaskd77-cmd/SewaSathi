/**
 * Where the last page of the audit log stopped.
 *
 * PURE, AND ITS OWN FILE, because it arrives off a query string and is
 * interpolated into a filter — which makes "what counts as a cursor" a rule
 * worth testing exhaustively without standing up a database or a React
 * request. Same reason `lib/payments/pricing.ts` and `lib/data/handles.ts` are
 * separate from the reads that use them.
 *
 * `at` AND `id`, NOT `at` ALONE. Several events are written inside one
 * transaction and share a timestamp to the microsecond; a cursor on the
 * timestamp alone would either skip the rest of that group or repeat it for
 * ever. `id` is a monotonic identity and breaks the tie.
 */

export function encodeCursor(entry: { at: string; id: string }): string {
  return `${entry.at}|${entry.id}`;
}

/**
 * Null for anything that is not one, and the caller falls back to the newest
 * page — a worse answer than the person wanted, and a far better one than a
 * filter built out of their text. The id must be digits only because it is
 * interpolated into a PostgREST predicate.
 */
export function decodeCursor(raw: string): { at: string; id: string } | null {
  // The last separator, not the first: a timestamp is full of punctuation and
  // splitting on the first bar would work today and break the moment a format
  // carried one.
  const bar = raw.lastIndexOf("|");
  if (bar <= 0) return null;
  const at = raw.slice(0, bar);
  const id = raw.slice(bar + 1);
  if (!at || !/^\d+$/.test(id)) return null;
  return { at, id };
}
