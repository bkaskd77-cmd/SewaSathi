/**
 * The levers on the payout run, in one place.
 *
 * Pure and dependency-free, like `lib/config/guarantee.ts` and
 * `lib/config/health.ts`: a judgement inside a `server-only` module is one no
 * test can reach, which this repository has paid for four times.
 *
 * EVERY CONSTANT HERE MOVES MONEY BETWEEN US AND THE PROFESSIONAL, or decides
 * when it moves. None of them touches what a customer is quoted or billed —
 * the same rule `lib/payments/payout.ts` states about itself, and the reason
 * `digitalDiscountBps` was renamed after being misread as a customer discount.
 */

/**
 * How long a new payout destination waits before it can receive money.
 *
 * THE TAKEOVER WINDOW. Somebody who gets into a professional's account changes
 * where the money goes first; this is the time the real person has to see the
 * notice and object. It is stamped onto the row as `usable_from` rather than
 * recomputed at payout time, so the rule cannot be forgotten by a caller.
 *
 * 72 hours rather than 24: a professional who works six days a week and reads
 * messages on Saturday needs a window that survives a weekend. The cost is that
 * somebody who legitimately changes their account waits three days for one
 * payout, which is a delay rather than a loss — the money is not going
 * anywhere, and the alternative is that it goes somewhere else permanently.
 */
export const DESTINATION_COOLDOWN_HOURS = 72;

/**
 * The shortest account reference we will show any of.
 *
 * Below this the "masked" form gives away most of the value: four digits of a
 * six-digit account is not a hint, it is the account. So short references are
 * masked entirely and the professional confirms by `account_name` and `kind`
 * instead.
 */
export const MIN_LENGTH_TO_REVEAL_TAIL = 8;

/** How many trailing characters a long enough reference shows. */
export const REVEALED_TAIL = 4;
