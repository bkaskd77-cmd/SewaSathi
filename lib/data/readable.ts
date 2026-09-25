/**
 * A read that can fail, for the screens where empty and broken are not the
 * same news.
 *
 * WHY THIS EXISTS SEPARATELY FROM `QueuePage`. A queue that returns no rows is
 * a queue with nothing waiting, and `unreadableQueue()` distinguishes that
 * from a failed read because "0 waiting" from a broken query is the sentence
 * that tells somebody to go home. The signals screens have the same problem
 * with the opposite sign: `listPaymentMix` returned `[]` on failure AND on
 * empty, so a query that broke would have rendered **"cash share 0%"** — not a
 * shrug, but good news, on the one screen built to decide whether to spend
 * money reducing cash.
 *
 * A DEFAULT IS NEVER A MEASUREMENT, which is standing rule 6, and this is the
 * same mistake one level up from a column: it was a whole dataset defaulting
 * to zero rather than a number. Unmeasured has to be distinguishable from
 * measured-as-zero everywhere, including when the reason it is unmeasured is
 * that the database said no.
 *
 * Not `QueuePage`: there is no cap here and no total to report. These views
 * aggregate — one row per category, not one per job — so there is nothing to
 * truncate and nothing to say about how much was left out.
 */

export type Readable<T> =
  | { ok: true; rows: T[] }
  /** The read failed. Never "there is nothing", which is `ok: true, rows: []`. */
  | { ok: false; rows: null };

export function unreadable<T>(): Readable<T> {
  return { ok: false, rows: null };
}
