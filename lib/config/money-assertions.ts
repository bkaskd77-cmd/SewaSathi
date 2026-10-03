/**
 * Columns that assert money moved, and what has to exist for that to be true.
 *
 * WHY THIS FILE EXISTS, AND IT IS A CLASS RATHER THAN AN INCIDENT. Three times now
 * a column has recorded a payment that never happened:
 *
 *   `getProviderDashboard.owedRupees` summed earnings under a comment calling it
 *     "due but not yet released" — no payout filter, cash counted as ours to pay.
 *   `applyRedoRecovery` netted a debt forward in a function nothing called, while
 *     `/providers/standards` promised a balance "you can watch going down".
 *   `no_show_claims.trip_rupees_paid` was written as 350 for five phases under a
 *     column comment reading "What we paid the professional", with no ledger row
 *     anywhere — nothing for a payout run to find, nothing in `provider_balance`.
 *
 * The shape is identical every time: **a column whose name is a past-tense verb is
 * a claim, not a payment.** It records what somebody decided. Whether money moved is
 * a different fact, living in `provider_ledger`, `payments` or `refunds`, and nobody
 * had gone and looked.
 *
 * SO THE RULE IS MECHANICAL NOW. Every column matching the past-tense money pattern
 * must be declared here with the row that backs it. `tests/unit/money-assertions.test.ts`
 * scans the migrations and fails on any column that is not — so a new
 * `*_paid`/`*_refunded` column cannot be added without somebody answering "and what
 * pays it?" — and `tests/db/money-assertions.test.ts` asserts the backing actually
 * exists for the ones where it must.
 *
 * Pure and dependency-free so both tests can reach it, the rule this repository has
 * paid for five times over.
 */

/**
 * Whether the backing row has to exist the moment the column is written.
 *
 * `immediate` — the write and the money are one decision, so a gap is a bug.
 * `mayLag`    — the column records an approval and a person still has to send the
 *               money. The gap is the product working as designed, and the reason
 *               is recorded rather than assumed, because "it is allowed to lag" is
 *               exactly what somebody would say about a payment that never comes.
 */
export type BackingTiming = "immediate" | "mayLag";

export type MoneyAssertion = {
  /** `table.column`, as the migration spells it. */
  column: string;
  /** Where the money itself is recorded. */
  backedBy: string;
  timing: BackingTiming;
  why: string;
};

export const MONEY_ASSERTIONS: MoneyAssertion[] = [
  {
    column: "no_show_claims.trip_rupees_paid",
    backedBy: "provider_ledger.kind = 'trip_compensation'",
    timing: "immediate",
    why: "The claim and the payment are one decision: `settleNoShowClaim` writes the ledger row first and only then marks the claim upheld, so a failed write leaves the claim open rather than a payment nobody made. This is the column that went five phases with nothing behind it.",
  },
  {
    column: "guarantee_claims.refund_rupees",
    backedBy: "refunds",
    timing: "mayLag",
    why: "Approving a refund and paying it are deliberately two events. Two of three rails cannot move money from inside this product — eSewa has no merchant-initiated refund on ePay v2, and cash goes back the way it came — so a person sends it afterwards and the screen must not say 'refunded' at the moment of approval. The lag is the design; what would be a fault is a refund marked sent with no `refunds` row.",
  },
];

/**
 * The names that make a column a claim about money.
 *
 * DELIBERATELY NARROW. It matches a past-tense verb or an explicit money noun at the
 * end of a column name, which is what the three incidents had in common, rather than
 * anything containing "amount" — `final_amount` and `quoted_min` are figures a job
 * was priced at, not assertions that anybody has been paid, and sweeping them in
 * would make the list long enough that nobody reads it.
 */
export const MONEY_ASSERTING_PATTERN = /_(paid|refunded|sent|disbursed|remitted)$/;

/**
 * A NAMING GAP, RECORDED RATHER THAN QUIETLY PATCHED. `guarantee_claims.refund_rupees`
 * is declared above and this pattern does not match it — it ends in `_rupees`, not
 * `_refunded`. So the mechanical half of this guard can be dodged by choosing a noun
 * instead of a verb, and that is worth knowing about the guard rather than hiding by
 * widening the regex until it catches everything.
 *
 * It is not widened because the cost runs the other way: `_rupees` and `_amount`
 * appear on a dozen columns that price a job rather than assert a payment, and a
 * list long enough to include them is a list nobody reads — which is how
 * `trip_rupees_paid` survived five phases in plain sight. The scanner catches the
 * verb forms; a reviewer adding a money column under any other name is the gap, and
 * the declarations above are where they are expected to land.
 */

/** Does this column name claim money moved? */
export function assertsMoneyMoved(column: string): boolean {
  return MONEY_ASSERTING_PATTERN.test(column);
}

/** The declaration for a column, or null when nobody has made one. */
export function assertionFor(qualified: string): MoneyAssertion | null {
  return MONEY_ASSERTIONS.find((a) => a.column === qualified) ?? null;
}
