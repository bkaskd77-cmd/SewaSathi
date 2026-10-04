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
    column: "bookings.trip_debt_added_rupees",
    backedBy:
      "payments.amount (digital) or provider_ledger.kind = 'commission_due' (cash)",
    timing: "mayLag",
    why: "It is a charge ADDED to a bill, so the money arrives the way the rest of the bill does — and on a cash job it never reaches us directly at all: the professional collects those rupees with everything else and owes them on, which is the `commission_due` row netted off a later payout. `mayLag` is therefore honest rather than lenient: at the moment this column is written the customer has not paid anything yet, on either rail. What WOULD be a fault is the cash half missing, because then the recovery is a gift to whoever happened to collect it — `tests/db/customer-risk.test.ts` asserts that row exists for every cash booking carrying a recovery.",
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
 * Columns that assert money moved without matching the pattern, named one by one.
 *
 * `guarantee_claims.refund_rupees` is the reason this list exists: it is the same
 * class as `trip_rupees_paid` — a figure that says money is going back to somebody —
 * and it ends in a noun, so the pattern never saw it. Naming it is the narrow fix.
 *
 * WHY NAME THEM RATHER THAN WIDEN THE REGEX. `_rupees` and `_amount` are on a dozen
 * columns that price a job rather than assert a payment — `final_amount`,
 * `quoted_min`, `band_min`. A pattern catching those makes the declaration list long
 * enough that nobody reads it, which is exactly how `trip_rupees_paid` survived five
 * phases in plain sight. A name costs one line and says what it means.
 *
 * THE GAP THAT REMAINS, smaller and still worth saying: a column named neither way —
 * no past-tense verb, not on this list — is invisible to the scanner. What catches
 * that is a person adding a money column and finding `MONEY_ASSERTIONS` already
 * expecting them, which is the point of the file rather than of the regex.
 */
export const MONEY_ASSERTING_NAMES = [
  "guarantee_claims.refund_rupees",
  /*
   * What we added to a customer's bill to recover a trip they did not answer the
   * door for. It is money moving between the customer and us, so it carries the
   * same question: `trip_debt_added_rupees` is what we DECIDED, and the recovery
   * itself is the `commission_due` row on a cash job or the larger charge on a
   * digital one.
   */
  "bookings.trip_debt_added_rupees",
];

/** Does this column name claim money moved? */
export function assertsMoneyMoved(column: string, qualified?: string): boolean {
  if (MONEY_ASSERTING_PATTERN.test(column)) return true;
  return qualified !== undefined && MONEY_ASSERTING_NAMES.includes(qualified);
}

/** The declaration for a column, or null when nobody has made one. */
export function assertionFor(qualified: string): MoneyAssertion | null {
  return MONEY_ASSERTIONS.find((a) => a.column === qualified) ?? null;
}
