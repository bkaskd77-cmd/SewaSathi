/**
 * Every movement a professional's account can record.
 *
 * ONE LIST WRITTEN TWICE — here and as `provider_ledger_kind_check` in
 * `20260929000001_ledger_kinds.sql`. `tests/unit/ledger-kinds.test.ts` reads
 * the migration and compares, the arrangement `LOGGABLE_REASONS` and
 * `CRON_JOBS` already use, because the two otherwise drift silently and fail on
 * the first production write that produces the new value — losing the row in
 * the same statement that writes it.
 *
 * Pure and dependency-free so a test can reach it. A judgement living inside a
 * `server-only` module is a judgement nothing can check, which this repository
 * has paid for four times.
 */

/**
 * THE SIGN IS THE KIND'S, NOT THE AMOUNT'S. `provider_ledger.amount_rupees` is
 * always positive and `kind` decides direction — the table's rule since it was
 * created, because a signed amount reads wrong in every report that sums it
 * without looking.
 */
export const LEDGER_KINDS = [
  /** Money we advanced on a guarantee claim, netted off future earnings. */
  "redo_debt",
  /** A slice of that debt recovered from a payout, at most a quarter of one. */
  "recovery",
  /** A debt closed after twelve months with no completed job. */
  "write_off",
  /** A digital job settled: we hold the customer's money and owe them. */
  "earning",
  /** A cash job settled: they hold the money and owe us the fee. */
  "commission_due",
  /** Money sent. */
  "payout",
  /**
   * A payout that failed, returning the balance.
   *
   * NOT A DELETION OF THE `payout` ROW, which an append-only ledger forbids and
   * which would erase the one piece of evidence that a remittance was
   * attempted — exactly what somebody investigating a missing payment needs.
   */
  "payout_reversal",
  /** Withholding tax. Zero until an accountant confirms the rule. */
  "tax_withheld",
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

export function isLedgerKind(value: unknown): value is LedgerKind {
  return (LEDGER_KINDS as readonly string[]).includes(value as string);
}

/**
 * The kinds `provider_outstanding` counts: the guarantee account.
 *
 * NAMED RATHER THAN DERIVED BY SUBTRACTION. "Everything that is not a payout
 * kind" is how the catch-all `else` this migration removed came to exist in the
 * first place — a rule phrased as an exclusion silently absorbs whatever is
 * added next.
 */
export const GUARANTEE_KINDS = ["redo_debt", "recovery", "write_off"] as const;

/**
 * The kinds `provider_balance` counts: the money account.
 *
 * Disjoint from `GUARANTEE_KINDS` on purpose, and the union of the two is every
 * kind — asserted in the unit test, so a kind added to neither is caught rather
 * than silently counted by nothing.
 */
export const MONEY_KINDS = [
  "earning",
  "commission_due",
  "payout",
  "payout_reversal",
  "tax_withheld",
] as const;
