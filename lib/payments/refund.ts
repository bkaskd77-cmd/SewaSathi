/**
 * What a guarantee claim can pay back, and the ceiling it can never pass.
 *
 * WHY A REFUND IS THE LAST RUNG AND NOT THE FIRST. The guarantee is a re-do:
 * we send somebody back and the labour belongs to the professional whose
 * defect it was, so it costs the platform almost nothing and can be generous.
 * A refund costs real money. The ladder is re-visit, re-do, then — only once a
 * re-do has failed or been refused — partial labour, then full labour. Nothing
 * here is reachable by a verdict; a person decides every one, which is the
 * whole anti-farming design (`lib/config/guarantee.ts` has the reasoning).
 *
 * LABOUR ONLY, AND THAT IS THE BOUNDED LIABILITY. Consequential damage is
 * excluded in plain words on a page anybody can read — the leak's water, the
 * outage's spoiled food. A guarantee that paid for those would be unbounded
 * exposure on a 15% commission.
 *
 * Pure and dependency-free, the same rule `lib/payments/pricing.ts` and
 * `lib/config/guarantee.ts` follow: it decides money, so it has to be readable
 * in one screen and testable without a database.
 */

/** Just enough of a settled booking to judge a refund against it. */
export type RefundSubject = {
  /** What was actually recorded as collected. */
  finalAmount: number | null;
  /**
   * What the customer said they handed over, on a blind cash entry.
   *
   * The cash screen promises "your guarantee covers up to the amount you
   * enter", so their own figure is part of the ceiling rather than a footnote.
   */
  customerReportedAmount: number | null;
  /** Set when the two figures disagreed and nobody has settled it yet. */
  amountMismatchAt: string | null;
  /** `paid` or otherwise. There is nothing to refund from an unpaid job. */
  paymentStatus: string;
};

export type RefundCeiling =
  | { ok: true; ceiling: number }
  | { ok: false; reason: "not-settled" | "amount-disputed" | "no-amount" };

/**
 * The most this booking can ever pay back.
 *
 * THE LOWER OF THE TWO FIGURES WHEN THEY DIFFER, which is the same number
 * whenever they agree — and they agree on every job where nobody mistyped.
 * Taking the higher would let a customer name a figure and be refunded it; the
 * recorded amount is what the platform has evidence of.
 *
 * A STANDING MISMATCH REFUSES OUTRIGHT. When the customer's figure and the
 * professional's disagree, `amount_mismatch_at` is stamped and a person
 * decides; nothing settles while it stands. Refunding against a number that is
 * itself in dispute would be picking a side by accident — and picking it
 * silently, in the direction of whoever happened to be written down.
 */
export function refundCeiling(subject: RefundSubject): RefundCeiling {
  if (subject.amountMismatchAt) return { ok: false, reason: "amount-disputed" };
  if (subject.paymentStatus !== "paid") return { ok: false, reason: "not-settled" };
  if (subject.finalAmount == null) return { ok: false, reason: "no-amount" };

  const reported = subject.customerReportedAmount;
  const ceiling =
    reported == null ? subject.finalAmount : Math.min(subject.finalAmount, reported);

  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return { ok: false, reason: "no-amount" };
  }
  return { ok: true, ceiling };
}

export type RefundVerdict =
  /** The whole recorded amount. The last rung. */
  | { outcome: "full-labour"; amount: number }
  /** Some of it. Anything between one rupee and the ceiling. */
  | { outcome: "partial-labour"; amount: number; ceiling: number }
  /** Above what was ever collected. Never payable, whoever asks. */
  | { outcome: "above-ceiling"; ceiling: number }
  | { outcome: "invalid"; reason: "not-a-number" | "not-positive" }
  /** The booking cannot be refunded at all yet — see `refundCeiling`. */
  | { outcome: "unavailable"; reason: "not-settled" | "amount-disputed" | "no-amount" }
  /** One per booking. A second is a support conversation, not a button. */
  | { outcome: "already-refunded"; paid: number };

/**
 * Judge one proposed refund.
 *
 * Deliberately the same shape as `judgeFinalAmount`: both decide money against
 * a frozen figure, and two money judgements that read alike are two somebody
 * can hold in their head at once.
 *
 * ORDER MATTERS, as it does there. `already-refunded` and `unavailable` come
 * before any arithmetic, so a second payout cannot fall through into a branch
 * that would approve it.
 */
export function judgeRefund(input: {
  amount: number;
  subject: RefundSubject;
  /** What this claim has already paid back. Zero on the common path. */
  alreadyRefunded: number;
}): RefundVerdict {
  if (input.alreadyRefunded > 0) {
    return { outcome: "already-refunded", paid: input.alreadyRefunded };
  }

  const ceiling = refundCeiling(input.subject);
  if (!ceiling.ok) return { outcome: "unavailable", reason: ceiling.reason };

  if (!Number.isInteger(input.amount) || Number.isNaN(input.amount)) {
    return { outcome: "invalid", reason: "not-a-number" };
  }
  if (input.amount <= 0) return { outcome: "invalid", reason: "not-positive" };

  // Above before at-or-below, so nothing over the ceiling reaches a payable
  // branch — the same ordering rule `judgeFinalAmount` keeps for `blocked`.
  if (input.amount > ceiling.ceiling) {
    return { outcome: "above-ceiling", ceiling: ceiling.ceiling };
  }

  if (input.amount === ceiling.ceiling) {
    return { outcome: "full-labour", amount: input.amount };
  }
  return {
    outcome: "partial-labour",
    amount: input.amount,
    ceiling: ceiling.ceiling,
  };
}

/**
 * How a refund is funded, once somebody has decided it.
 *
 * THREE PARTIES AND ONLY TWO OF THEM PAY. The customer receives the whole
 * amount. The professional's share of the original job becomes a debt netted
 * forward against future earnings — never chased backward, because there is no
 * card on file, no direct debit and no wage to garnish, and backward recovery
 * selects against the honest. The platform returns its commission on that job:
 * we do not keep a fee out of work that failed.
 *
 * THE PROFESSIONAL'S SHARE IS AN ORDINARY `redo_debt`. Not a new ledger kind —
 * `provider_outstanding` sums `redo_debt` positive and EVERY other kind
 * negative, so a new kind would have quietly reduced what somebody owed.
 */
export function refundFunding(input: {
  refund: number;
  /** The split frozen on the booking at settlement. */
  platformFee: number;
  providerEarning: number;
}): { customerReceives: number; platformReturns: number; providerOwes: number } {
  const refund = Math.max(0, Math.round(input.refund));

  /*
   * The platform returns its fee in the same proportion as the refund, capped
   * at the fee itself — a partial refund should not hand back a whole
   * commission, and a full one should not hand back more than we took.
   */
  const collected = input.platformFee + input.providerEarning;
  const platformReturns =
    collected > 0
      ? Math.min(input.platformFee, Math.round((input.platformFee * refund) / collected))
      : 0;

  return {
    customerReceives: refund,
    platformReturns,
    providerOwes: refund - platformReturns,
  };
}
