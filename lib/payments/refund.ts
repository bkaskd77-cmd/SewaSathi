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

import type { PaymentMethod } from "./status";

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
  /** Set when the two figures disagreed, whether or not anybody has settled it. */
  amountMismatchAt: string | null;
  /**
   * Set once a person has settled that disagreement.
   *
   * BOTH, NEVER THE STAMP ALONE. `amount_mismatch_at` never becomes false, so a
   * rule reading it by itself refuses a refund for ever on a job somebody
   * already adjudicated — the same permanence the resolution exists to end.
   */
  amountMismatchResolvedAt?: string | null;
  /** `paid` or otherwise. There is nothing to refund from an unpaid job. */
  paymentStatus: string;
  /**
   * What the professional said the parts cost, entered beside the final
   * amount. **Null is "nobody said", never zero** — rule 6. Every booking
   * taken before this column existed is null, and so is every job where the
   * professional left the field blank.
   */
  materialsRupees?: number | null;
  /**
   * Did the parts themselves fail?
   *
   * Recorded by the attending professional with the verdict, because they are
   * the one who saw it — a compressor that died is not the same claim as a
   * compressor fitted badly, and only somebody standing in the room can tell
   * them apart. **Null is "not asked or not answered"** and is not the same as
   * `false`; see `materialsRead` for why the two behave differently.
   */
  partsFailed?: boolean | null;
};

/**
 * The most of a settled job a materials line may ever take off a refund.
 *
 * WHY THERE IS A CAP AT ALL. Nothing evidences this figure. It is typed by the
 * professional at settlement, there are no receipts in this product, and it
 * now reduces what they can be asked to pay back — so it is a number worth
 * inflating, by exactly the arithmetic that makes under-reporting worth doing
 * on the settlement side. Uncapped, "materials Rs 5,999 on a Rs 6,000 job"
 * reduces a full refund to one rupee and every guard in this file waves it
 * through, because each of them is about the total.
 *
 * WHAT WEAKENS THAT INCENTIVE, AND WHAT DOES NOT. The line is entered at
 * settlement, before any claim exists and usually before one ever will, so the
 * pressure is a diffuse "always type something" rather than a targeted answer
 * to a claim somebody has just made. That is a real mitigation and it is not a
 * control: it disappears the moment materials affect anything a professional
 * sees more often than a guarantee claim — which is precisely what the
 * deferred labour-only commission question would do.
 *
 * WHY HALF. A job where the parts are more than half the money is a parts sale
 * with some fitting, not a service we guaranteed the workmanship of, and the
 * honest version of that case belongs in a conversation rather than in a
 * silent deduction. Half bounds the manipulation at halving the exposure
 * instead of erasing it, and leaves the genuinely material-heavy trades — a
 * compressor, a tank, a room's worth of paint — under the cap in the ordinary
 * case.
 *
 * IT IS NEVER A SILENT CLAMP. `materialsRead` reports what was entered as well
 * as what came off, so the adjudicator sees the whole line and the cap biting;
 * a screen that quietly showed the capped figure would hide the one signal
 * that says somebody may be inflating it.
 */
export const MATERIALS_CEILING_SHARE_BPS = 5000;

/**
 * What a materials line does to this booking's ceiling, and why.
 *
 * `why` is one discriminator rather than two booleans because the three cases
 * are genuinely different sentences on the screen, and a reviewer reading
 * "nothing was deducted" needs to know which of them it was.
 */
export type MaterialsRead = {
  /** The figure on the booking, exactly as it was entered. */
  entered: number;
  /** What actually comes off the ceiling. Zero in two of the three cases. */
  deducted: number;
  /** The share cap bit: `deducted` is less than `entered`. */
  capped: boolean;
  why:
    /** The parts were sound, so their cost is not labour and comes off. */
    | "deducted"
    /** The parts themselves failed. Refunding them is the point of the claim. */
    | "partsFailed"
    /** Nobody recorded whether the parts failed, so nothing is assumed. */
    | "notRecorded";
};

export type RefundCeiling =
  | {
      ok: true;
      /** What may actually be paid back: the settled figure less materials. */
      ceiling: number;
      /** The settled figure itself, before any materials came off. */
      settled: number;
      /** Null when no materials figure was ever entered on this booking. */
      materials: MaterialsRead | null;
    }
  | { ok: false; reason: "not-settled" | "amount-disputed" | "no-amount" };

/**
 * What the parts cost does to the ceiling.
 *
 * THE GUARANTEE IS ON THE WORKMANSHIP, so refunding a professional's material
 * cost as though it were their labour charges them for a tap they bought and
 * fitted correctly. The parts are the customer's; they are still in the wall.
 *
 * UNRECORDED IS NOT "NO". The deduction requires a positive statement that the
 * parts were sound — `partsFailed === false` — and never happens on `null`.
 * That is rule 6 pointing the only way it can point here: the question is
 * asked of the attending professional, the answer reduces what a customer can
 * be paid, and a column nobody filled in must not act like an answer somebody
 * gave. Every claim from before this question existed reads `null`, and each
 * of them keeps the whole settled figure as its ceiling rather than silently
 * losing the parts.
 */
export function materialsRead(
  settled: number,
  materialsRupees: number | null | undefined,
  partsFailed: boolean | null | undefined,
): MaterialsRead | null {
  if (materialsRupees == null || !Number.isFinite(materialsRupees)) return null;
  const entered = Math.max(0, Math.round(materialsRupees));

  if (partsFailed == null) {
    return { entered, deducted: 0, capped: false, why: "notRecorded" };
  }
  if (partsFailed) {
    return { entered, deducted: 0, capped: false, why: "partsFailed" };
  }

  const cap = Math.floor((settled * MATERIALS_CEILING_SHARE_BPS) / 10000);
  const deducted = Math.min(entered, cap);
  return { entered, deducted, capped: deducted < entered, why: "deducted" };
}

/**
 * The most this booking can ever pay back: the SETTLED figure, one number.
 *
 * THIS USED TO BE `min(finalAmount, customerReportedAmount)` AND IT DISAGREED
 * WITH THE DATABASE. `enforce_claim_refund` caps at `final_amount`; this file
 * capped at the lower of two, so the screen showed the adjudicator one ceiling
 * and the trigger would have accepted a larger one. Two implementations of a
 * money rule, and nothing compared them — the migration that let a person
 * settle a disputed amount changed one half and left this one.
 *
 * THE DIRECTION MATTERS MORE THAN THE MISMATCH. `min()` re-imposes the
 * customer's own typed figure as their cover, including after a person has
 * established they really paid more. The cash screen's promise is a FLOOR on
 * what they are covered for, never a cap: somebody who handed over 3,000 and
 * mistyped 1,800 is covered for what was actually paid, once somebody has
 * established it. `customerReportedAmount` stays on this type as evidence — a
 * professional whose figures are confirmed by hundreds of customers has a
 * record worth something — and is no longer arithmetic.
 *
 * AN OPEN MISMATCH STILL REFUSES OUTRIGHT, and only an open one. Refunding
 * against a number that is itself in dispute picks a side by accident, in
 * whichever direction happened to be written down. But `amount_mismatch_at`
 * never becomes false, so reading it alone refuses every future claim on a job
 * somebody settled weeks ago — the same permanence the resolution exists to
 * end, moved one file along. Both columns, or neither.
 *
 * AND THEN THE PARTS COME OFF IT, when somebody has said they were sound. The
 * guarantee is on the workmanship; see `materialsRead`, which is where all the
 * reasoning about that deduction and its cap lives. `enforce_claim_refund`
 * computes the same subtraction in SQL, in the same order and with the same
 * integer truncation, and `tests/db/guarantee-claims.test.ts` asserts the two
 * agree on one fixture — because a money rule implemented twice is the fault
 * this function was last rebuilt for.
 */
export function refundCeiling(subject: RefundSubject): RefundCeiling {
  const disputeOpen =
    Boolean(subject.amountMismatchAt) && !subject.amountMismatchResolvedAt;
  if (disputeOpen) return { ok: false, reason: "amount-disputed" };

  if (subject.paymentStatus !== "paid") return { ok: false, reason: "not-settled" };
  if (subject.finalAmount == null) return { ok: false, reason: "no-amount" };

  const settled = subject.finalAmount;
  if (!Number.isFinite(settled) || settled <= 0) {
    return { ok: false, reason: "no-amount" };
  }

  const materials = materialsRead(
    settled,
    subject.materialsRupees,
    subject.partsFailed,
  );

  return {
    ok: true,
    ceiling: settled - (materials?.deducted ?? 0),
    settled,
    materials,
  };
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

/* ------------------------------------------------------------------ *
 * Getting the money back to them, which is a second step and not a flag
 * ------------------------------------------------------------------ */

/**
 * WHY APPROVING A REFUND AND PAYING IT ARE TWO DIFFERENT EVENTS.
 *
 * The first draft had one: a person approved an amount and the claim recorded
 * `refund_rupees`, which every screen then rendered as "refunded". Nothing in
 * that sentence was true yet. **Two of our three rails cannot move money from
 * inside this product at all** — eSewa has no merchant-initiated refund on
 * ePay v2, and cash by its nature comes back the way it went out — so for most
 * refunds the approval is somebody saying yes and a second person still has to
 * go and send it. A screen that says "refunded" at the moment of approval is
 * telling the customer their money has been sent by somebody who has not sent
 * it, and it removes the only thing that would ever remind us to.
 *
 * So `refunds.status` carries it: `requested` is approved and owed,
 * `completed` is gone, with `processed_at` and the gateway's or the sender's
 * reference on the row. The constraint `refunds_processed_shape` already
 * refuses a completed row with no timestamp, which is why this needed no
 * migration — the shape was right and nothing was using it.
 */

export type RefundRail = {
  /** Can this product move the money itself, right now? */
  automatic: boolean;
  /**
   * Why it cannot, when it cannot. A copy key, never a sentence — the reader
   * of this screen may be reading it in Nepali.
   */
  reason: "esewaHasNoApi" | "cashByHand" | "gatewayNotConfigured" | null;
};

/**
 * Which rail this refund travels on, and whether a person has to walk it.
 *
 * `configured` IS PART OF THE ANSWER AND NOT A DETAIL. Khalti has a real
 * refund endpoint, so a Khalti payment is automatic — but only where the
 * secret is actually present. With no key the call returns `notConfigured`,
 * and a screen that had already said "we will send this automatically" would
 * be promising on the strength of a setting nobody checked. Absent is not
 * working; it is reported as its own reason so somebody can go and fix it.
 */
export function refundRail(input: {
  method: PaymentMethod;
  /** `gatewayFor(method).isConfigured()`, read by the caller that may. */
  configured: boolean;
}): RefundRail {
  if (input.method === "cash") return { automatic: false, reason: "cashByHand" };
  if (input.method === "esewa") {
    return { automatic: false, reason: "esewaHasNoApi" };
  }
  if (!input.configured) {
    return { automatic: false, reason: "gatewayNotConfigured" };
  }
  return { automatic: true, reason: null };
}

/**
 * How long an approved refund may sit unpaid before the queue says so.
 *
 * THREE DAYS, AND THE NUMBER IS ARGUED FROM WHAT WE ALREADY PAY OURSELVES.
 * `PAYOUT_RULES` holds a professional's money for 24 hours on digital and
 * seven days on cash; a customer we have already agreed to pay back must not
 * wait longer than the slowest thing we do for our own side. Three days is
 * inside that and outside a weekend, so a refund approved on Friday is flagged
 * on Monday rather than the same afternoon.
 *
 * IT IS A FLAG, NEVER A DEADLINE THAT PAYS ITSELF. Nothing about this number
 * moves money — the whole point of the two steps is that a person does — and a
 * timer that auto-completed a refund would record money as sent that nobody
 * sent, which is exactly the fault the second step exists to stop.
 */
export const REFUND_PAYMENT_DAYS = 3;

/**
 * Has this approved refund been sitting unpaid too long?
 *
 * An unpaid approved refund is the worst thing this product can leave quiet:
 * the customer has been told yes, and from their side a refund that is never
 * sent is indistinguishable from one that was refused without being said.
 */
export function isRefundStale(input: {
  /** When it was approved. `refunds.created_at`. */
  requestedAt: string;
  now?: Date;
}): boolean {
  const requested = Date.parse(input.requestedAt);
  if (Number.isNaN(requested)) return false;
  const now = (input.now ?? new Date()).getTime();
  return now - requested >= REFUND_PAYMENT_DAYS * 24 * 60 * 60 * 1000;
}
