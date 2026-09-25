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
  | { outcome: "invalid"; reason: "too-low" | "not-a-number" }
  /**
   * There is no band to judge against yet.
   *
   * A SURVEY-PRICED JOB THAT NOBODY HAS PRICED. `enforce_survey_quote` in
   * Postgres refuses to let such a booking reach `in_progress` at all, so this
   * should be unreachable — and it exists precisely because "should be
   * unreachable" is not a guarantee on the money path. Two independent guards,
   * and this is the second: no amount is judgeable against a null.
   *
   * It is its OWN outcome rather than folded into `invalid`, because the fault
   * is ours and not the professional's. "That amount is invalid" tells somebody
   * standing in a customer's kitchen to retype a number that was never the
   * problem.
   */
  | { outcome: "not-surveyed" };

/**
 * Judge a final amount against the band that was quoted.
 *
 * Pure and takes the band as an argument rather than reading a booking, so the
 * rule can be tested exhaustively without a database — and so it cannot
 * accidentally re-read a category's *current* price instead of the frozen one.
 */
export function judgeFinalAmount(
  finalAmount: number,
  quote: { min: number | null; max: number | null },
): PriceVerdict {
  /*
   * BEFORE ANYTHING ELSE, because every line below measures against `max` and
   * `null * 2` is NaN — which compares false against every amount, so the
   * blocked branch would silently stop blocking and the approval branch would
   * accept anything. A missing band is not a lenient band.
   */
  if (quote.max == null || quote.min == null) return { outcome: "not-surveyed" };

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
    case "not-surveyed":
      // Named for what actually happened, so the screen can say "the survey
      // has not been approved yet" rather than blaming the amount.
      return { ok: false, reason: "quoteNotApproved" };
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
  quotedMax: number | null;
}): boolean {
  if (input.method !== "cash") return false;
  if (input.finalAmount === null) return false;
  /*
   * NO BAND MEANS BLIND, which is the safe direction and not merely the
   * cautious one. Blind entry exists so the customer's independent figure is
   * real evidence; falling through to `finalAmount <= null` would be false and
   * would SHOW them the professional's number — turning the one honest check on
   * a cash handover into a rubber stamp on the one trade where the amounts are
   * largest.
   */
  if (input.quotedMax === null) return true;
  return input.finalAmount <= input.quotedMax;
}

/** Whose number a settled mismatch used. Mirrors `bookings.amount_settled_source`. */
export type SettledSource = "customer" | "provider" | "adjudicated";

export type MismatchChoice =
  | { source: "customer" | "provider" }
  | { source: "adjudicated"; amount: number; note: string };

export type MismatchRuling =
  | { ok: true; amount: number; source: SettledSource; note: string | null }
  | {
      ok: false;
      reason:
        | "reasonRequired"
        | "noCustomerFigure"
        | "blocked"
        | "tooLow"
        | "notANumber"
        | "notSurveyed";
    };

/**
 * Which figure a settled mismatch settles at, and whether it may.
 *
 * A PERSON DECIDES, BUT NOT ARBITRARILY. The customer typed one number, the
 * professional recorded another, and the truth is sometimes a third: 2,000
 * against 1,500, and a phone call establishes 1,800. Forcing a choice between
 * two numbers when neither is right records a lie, so a third is allowed — and
 * because it is, it needs a reason and a ceiling. The reason is stored on the
 * booking rather than only in the audit log, because a figure somebody has to
 * defend later belongs beside the money it decided.
 *
 * THE CEILING IS `judgeFinalAmount`, THE SAME ONE THE PROFESSIONAL FACES, and
 * it is applied to WHICHEVER figure is chosen rather than only to the third.
 * The professional's number passed it when it was recorded; the customer's
 * never has — nothing checks what somebody types into the blind cash box, and
 * without this an admin picking "the customer's figure" could settle a job at
 * any amount at all. Two times the quoted max is a customer protection, so it
 * cannot be escaped by choosing a party rather than naming a number.
 *
 * `needs-approval` is allowed through. That verdict means "a human must agree",
 * and a human is what this function is being called on behalf of; refusing it
 * would make the adjudication screen unable to settle the exact overrun it
 * exists for.
 *
 * Pure, so the rule is exhaustively testable without a database — the same
 * reason `judgeFinalAmount` takes a band rather than reading a booking.
 */
export function judgeMismatchResolution(input: {
  choice: MismatchChoice;
  /** The professional's recorded figure. */
  recorded: number;
  /** What the customer said they paid. Null if they never typed one. */
  reported: number | null;
  quote: { min: number | null; max: number | null };
}): MismatchRuling {
  let amount: number;
  let note: string | null = null;

  if (input.choice.source === "adjudicated") {
    // Mandatory, and checked before the amount: "why is this number neither of
    // ours" is the whole justification for allowing a third one.
    note = input.choice.note.trim();
    if (note.length === 0) return { ok: false, reason: "reasonRequired" };
    amount = input.choice.amount;
  } else if (input.choice.source === "customer") {
    if (input.reported === null) return { ok: false, reason: "noCustomerFigure" };
    amount = input.reported;
  } else {
    amount = input.recorded;
  }

  const verdict = judgeFinalAmount(amount, input.quote);
  if (verdict.outcome === "blocked") return { ok: false, reason: "blocked" };
  if (verdict.outcome === "not-surveyed") return { ok: false, reason: "notSurveyed" };
  if (verdict.outcome === "invalid") {
    return {
      ok: false,
      reason: verdict.reason === "too-low" ? "tooLow" : "notANumber",
    };
  }

  return { ok: true, amount, source: input.choice.source, note };
}
