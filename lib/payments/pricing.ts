/**
 * What the job is allowed to cost, and who has to agree to it.
 *
 * The final amount is typed by a professional standing in somebody's kitchen,
 * on their own phone, with the customer watching. That is the fraud and
 * dispute surface of this entire product — far more so than the gateways —
 * and it is why this file exists before either of them.
 *
 * The landing page promises "no surprises: the price is agreed before work
 * starts". These rules are that promise made structural rather than editorial.
 * Every one of them is applied on the server; nothing here is enforced by the
 * screen the provider is looking at.
 *
 * THREE OUTCOMES, and the reasoning for each boundary:
 *
 *   within the quoted band      -> confirmed normally
 *     The band was published before the booking and shown at review. Landing
 *     inside it is the promise being kept, and asking the customer to
 *     re-approve what they already agreed to would teach them to tap through
 *     approvals without reading.
 *
 *   above the band, up to 2x    -> the customer must approve, with a reason
 *     Genuine overruns happen: a tap replacement uncovers a corroded pipe.
 *     The professional says why, in their own words, and the customer agrees
 *     before any money moves. The reason is stored, so a dispute has both
 *     sides on the record.
 *
 *   above 2x the quoted max     -> blocked outright, routed to support
 *     Chosen because 2x is comfortably beyond any honest overrun on a job
 *     whose band was set from the category's own published rates, while being
 *     low enough that a mistyped amount — an extra zero turns 1,500 into
 *     15,000, ten times the max — cannot be approved by a customer who is
 *     tired and trusts the professional in front of them. Above it, no
 *     in-app approval exists at all: a human has to look.
 */

export const PRICE_RULES = {
  /**
   * Multiple of the quoted maximum above which nothing can be approved in-app.
   * See the reasoning above before changing it — this number is a customer
   * protection, not a tuning knob.
   */
  hardCeilingMultiple: 2,
  /** Nobody is billed less than this; below it, something has gone wrong. */
  minimumAmount: 100,
} as const;

export type PriceVerdict =
  | { outcome: "within-band" }
  | { outcome: "needs-approval"; overBy: number }
  | { outcome: "blocked"; ceiling: number }
  | { outcome: "invalid"; reason: "too-low" | "not-a-number" };

/**
 * Judge a final amount against the band that was quoted.
 *
 * Pure and takes the band as an argument rather than reading a booking, so the
 * rule can be tested exhaustively without a database — and so it cannot
 * accidentally re-read a category's *current* price instead of the frozen one.
 */
export function judgeFinalAmount(
  finalAmount: number,
  quote: { min: number; max: number },
): PriceVerdict {
  if (!Number.isInteger(finalAmount) || Number.isNaN(finalAmount)) {
    return { outcome: "invalid", reason: "not-a-number" };
  }
  if (finalAmount < PRICE_RULES.minimumAmount) {
    return { outcome: "invalid", reason: "too-low" };
  }

  const ceiling = quote.max * PRICE_RULES.hardCeilingMultiple;

  // Note the order: blocked is checked before needs-approval, so an amount
  // beyond the ceiling can never fall through into the approvable branch.
  if (finalAmount > ceiling) return { outcome: "blocked", ceiling };

  // At or below the quoted max is the promise being kept. Below the quoted
  // *min* is fine too — a job that turned out easier should not need an
  // approval flow to charge less.
  if (finalAmount <= quote.max) return { outcome: "within-band" };

  return { outcome: "needs-approval", overBy: finalAmount - quote.max };
}

/**
 * May this amount be settled right now?
 *
 * `approved` is whether the customer has explicitly agreed to an over-band
 * figure. The two arguments are deliberately separate: an approval that was
 * granted for one amount must not carry over to a different one, and the
 * caller proves it re-checked by passing both.
 */
export function canSettle(
  verdict: PriceVerdict,
  approved: boolean,
): { ok: true } | { ok: false; reason: string } {
  switch (verdict.outcome) {
    case "within-band":
      return { ok: true };
    case "needs-approval":
      return approved
        ? { ok: true }
        : { ok: false, reason: "awaitingCustomerApproval" };
    case "blocked":
      return { ok: false, reason: "aboveCeiling" };
    case "invalid":
      return { ok: false, reason: "invalidAmount" };
  }
}

/**
 * Should the cash screen hide the professional's figure?
 *
 * YES when the figure sits inside the published band, because nothing has
 * shown it to the customer yet and their independent answer is the only
 * evidence that a cash handover produces. Asking them to approve a number
 * somebody else typed is a rubber stamp — the professional who pockets Rs
 * 2,000 and records 1,000 needs exactly one tired tap.
 *
 * NO when it went over the band, because the customer has already been shown
 * that exact figure and has explicitly approved it. Hiding it then would be
 * theatre: they know the number, and pretending otherwise only makes the
 * screen harder to answer. It would also punish the honest overrun — the case
 * the approval flow exists for.
 *
 * Pure, and exported to the client on purpose: the panel needs to know which
 * screen to draw. It is never the enforcement — `confirmCashPayment` compares
 * the figures on the server, whatever the browser decided to render.
 */
export function blindCashEntry(input: {
  method: string;
  finalAmount: number | null;
  quotedMax: number;
}): boolean {
  if (input.method !== "cash") return false;
  if (input.finalAmount === null) return false;
  return input.finalAmount <= input.quotedMax;
}
