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

/**
 * The payout run's own levers.
 *
 * Separate from `PAYOUT_RULES` in `lib/payments/payout.ts`, which decides what a
 * single booking's money does — when it is due, how much is held back, what
 * commission applies. These decide how the weekly RUN behaves, and the split is
 * worth keeping: one is about a job, the other is about a batch.
 */
export const PAYOUT_RUN = {
  /**
   * The day the run creates drafts. 1 = Monday, as `Date.getUTCDay()` counts
   * Sunday as 0.
   *
   * TUESDAY, NOT MONDAY. The reconcile cron runs daily in the small hours UTC,
   * which is mid-morning in Kathmandu; a Monday run would be settling a weekend
   * whose cash jobs are often confirmed late on Sunday night. Tuesday gives the
   * weekend a full working day to settle before anybody's week is totalled.
   *
   * It is a constant rather than a cron expression because `vercel.json` cannot
   * express "weekly" on every plan, and because a day-of-week check in code is
   * testable where a schedule is not — the run has to be safe to invoke on any
   * day, and this is the thing that makes that true.
   */
  runDayOfWeek: 2,

  /**
   * Rupees of arrears at which we stop sending a professional new work.
   *
   * NULL MEANS NOBODY HAS CHOSEN A NUMBER, AND NOTHING IS PAUSED. Not zero,
   * which would pause everybody who owes a rupee; not a guess, which would
   * become the policy by accident the first time somebody read it off the
   * screen. The professional's terms have to state a figure before any figure
   * can be enforced, and until then the arrears are shown and nothing acts on
   * them.
   *
   * This is rule 6 at the top of the file applied to a lever rather than a
   * measurement: unset and set-to-zero are different facts and must not collapse.
   * `dispatchPauseFor` returns `null` while this is null, and the test asserts
   * that a professional owing a fortune is still dispatched.
   */
  arrearsPauseRupees: null as number | null,

  /**
   * Tax withheld at source on a payout, in basis points.
   *
   * ZERO UNTIL AN ACCOUNTANT CONFIRMS THE RATE AND THE FILING, and zero here
   * means "withhold nothing", which is a decision rather than an absence — the
   * rate genuinely may be zero for some professionals, so null would be the
   * wrong shape. What is outstanding is the confirmation, recorded in
   * `LAUNCH-BLOCKERS.md` rather than as a number nobody has checked.
   *
   * At 0 the run writes NO `tax_withheld` row at all. A ledger row for zero
   * rupees asserts that a withholding was calculated and came to nothing, which
   * is not what happened: nobody has calculated anything yet.
   */
  withholdingTaxBps: 0,
} as const;

/**
 * Is today the day the run creates drafts?
 *
 * Pure, and the reason the daily cron is safe: the sweep can be invoked on any
 * day, twice, or late, and only a Tuesday produces anything.
 */
export function isPayoutRunDay(now: Date): boolean {
  return now.getUTCDay() === PAYOUT_RUN.runDayOfWeek;
}

/**
 * The ISO-week period a run on this date settles, as `[start, end)`.
 *
 * MONDAY TO MONDAY IN UTC. The start is what `payouts_provider_period_idx` is
 * unique on, so it is the thing that makes a second trigger in the same week
 * create nothing — which means it must be derived from the date and never from
 * "now minus seven days", a rule that would give two different answers to two
 * runs an hour apart.
 */
export function payoutPeriod(now: Date): { start: Date; end: Date } {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // Back up to the most recent Monday, inclusive of today when today is Monday.
  const back = (end.getUTCDay() + 6) % 7;
  end.setUTCDate(end.getUTCDate() - back);

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end };
}

/**
 * How much arrears pause dispatch for this professional, or null.
 *
 * Null means the lever is unarmed, which is NOT the same as "they owe nothing" —
 * a caller that treated the two alike would pause nobody today and everybody the
 * moment a number was set, with no way to tell which it had done.
 */
export function dispatchPauseFor(arrearsRupees: number): number | null {
  const cap = PAYOUT_RUN.arrearsPauseRupees;
  if (cap === null) return null;
  return arrearsRupees >= cap ? cap : null;
}
