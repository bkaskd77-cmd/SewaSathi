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

/**
 * How recently somebody must have proved who they are to move their money.
 *
 * THE CONTROL THE COOLDOWN CANNOT PROVIDE. `DESTINATION_COOLDOWN_HOURS` gives
 * the real person time to object; this is what makes an attacker need more than
 * a session cookie in the first place. They are different halves — one delays
 * the theft, the other raises its price — and neither substitutes for the other.
 *
 * FIFTEEN MINUTES, NOT EIGHT HOURS. `STEP_UP_HOURS` is eight because admin work
 * is batched and a code every half hour teaches somebody to tap through
 * approvals — the failure `lib/payments/pricing.ts` names. Changing a payout
 * destination is the opposite shape: it happens once a year, takes one minute,
 * and is the single most valuable write a professional can make. A window long
 * enough to survive a coffee break is long enough for somebody who picked up an
 * unlocked phone.
 *
 * AN ABSENT STAMP IS EXPIRED, never "probably fine" — `stepUpFor`'s rule for a
 * missing `amr` timestamp, applied where guessing wrong hands somebody's
 * earnings to a stranger.
 */
export const REAUTH_WINDOW_MINUTES = 15;
