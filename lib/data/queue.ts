/**
 * What a queue read hands back, and why it is not just an array.
 *
 * EVERY ADMIN QUEUE IS CAPPED AND EVERY ONE OF THEM USED TO END IN SILENCE.
 * `reviewQueue` stopped at 200, the no-show and refund queues at 100, the
 * decidable claims at 50 — and the screen rendered exactly what it was given
 * with nothing saying more existed. A person working a queue has no way to
 * tell a drained list from a truncated one, and the two demand opposite
 * responses: one means go home, the other means somebody has been waiting
 * since before the cut.
 *
 * So a read carries three things: the rows, the CAP it applied, and the TOTAL
 * that matched. The total comes from `count: "exact"` on the same select, so
 * it is one query and one round trip, and the number can never disagree with
 * the rows the way a separately-fetched count eventually would.
 *
 * `total` IS NULLABLE AND THAT IS THE POINT. A read that failed returns no
 * rows, and zero rows with a total of 0 reads as "nothing to do" — which is
 * the single most expensive thing this screen could get wrong. Null means we
 * did not manage to count, the screen says so, and not looking never renders
 * as working. Same rule as `/api/health`.
 */

export type QueuePage<T> = {
  rows: T[];
  /** How many match the filter in total. Null when the read failed. */
  total: number | null;
  /** The ceiling this read applied, so the screen can say what it is. */
  cap: number;
};

/**
 * The default ceiling for a queue a person works through.
 *
 * ONE HUNDRED IS A SCREENFUL OF WORK, NOT A LIMIT ON WHAT IS REACHABLE. Every
 * one of these queues is ordered oldest-first and an item LEAVES it when
 * somebody decides it, so the hundred-and-first row becomes the first row once
 * the hundred above it are cleared. That is why none of them gets a page-two
 * control: a drain queue with paging invites working the wrong end of it, and
 * the oldest thing waiting is the whole reason these are sorted the way they
 * are. What was actually missing was never the second page — it was being told
 * a second page existed.
 */
export const QUEUE_CAP = 100;

/** The shape a failed read returns: no rows, and no claim about how many. */
export function unreadableQueue<T>(cap: number): QueuePage<T> {
  return { rows: [], total: null, cap };
}

/* ------------------------------------------------------------------ *
 * The admin index
 * ------------------------------------------------------------------ */

/**
 * The six queues, as a closed union.
 *
 * Closed on purpose: the index renders its labels as `queues.<key>.name`,
 * which `check:keys` can only report as a dynamic key rather than resolve. The
 * union is what lets `tests/unit/admin-queues.test.ts` check both catalogues
 * exhaustively instead — a seventh queue fails that test until both languages
 * have words for it, which is stronger than an allow-list because it cannot be
 * added to without being noticed.
 */
export type AdminQueueKey =
  | "applications"
  | "claims"
  | "refunds"
  | "verdicts"
  | "surveyFees"
  | "appeals";

export type AdminQueueCount = {
  key: AdminQueueKey;
  /** Unprefixed; the caller's `Link` adds the locale. */
  href: string;
  /** How many are waiting. Null means the read failed, never "none". */
  total: number | null;
  /** The ceiling that queue's own screen applies. */
  cap: number;
};

/**
 * Is anything waiting anywhere?
 *
 * THREE ANSWERS, NOT TWO, AND THE THIRD IS WHY THIS IS A FUNCTION. `unknown`
 * is what comes back when every count failed. Folding it into `clear` would
 * hand an admin the single most expensive sentence in the product — "nothing
 * is waiting" — on the morning a query is broken and work is piling up behind
 * it. One readable queue with work in it still says `waiting`: something
 * definitely needs a person, and that is not made less true by a second query
 * having failed.
 *
 * `clear` NEEDS EVERY COUNT, NOT MOST OF THEM. The first version asked whether
 * EVERY queue was unreadable before saying `unknown`, which meant five empty
 * queues and one broken one printed "nothing is waiting" — the exact sentence
 * this function exists to withhold, arrived at from the other direction. A
 * test written against the intent caught it; the implementation had agreed
 * with itself. One unreadable queue is enough to make "clear" a guess.
 *
 * Pure, so it is tested without a database — which the reader beside it cannot
 * be, since importing it drags in React's `cache`.
 */
export function queuesState(
  counts: AdminQueueCount[],
): "waiting" | "clear" | "unknown" {
  if (counts.some((q) => (q.total ?? 0) > 0)) return "waiting";
  if (counts.some((q) => q.total === null)) return "unknown";
  return "clear";
}
