/**
 * When the professional actually gets paid, and why digital is faster.
 *
 * Cash cannot be policed for ever. Every anti-under-reporting mechanism in
 * this product — the commission floor, blind confirmation, receipts — is
 * cheaper the smaller the cash share is, because a settled digital payment is
 * evidence and a cash handover is a story two people tell. So rather than
 * inspecting cash harder every year, the product makes digital worth
 * preferring, and lets the share shrink on its own.
 *
 * THE LEVERS, all in one place so they can be argued about as numbers rather
 * than found scattered through the code:
 *
 *   1. HOLD TIME. Digital settles to us instantly and is verified by the
 *      gateway's own servers, so it can be paid out quickly. Cash has to be
 *      reconciled against a confirmation typed by a customer, so it waits.
 *      This is the honest lever: the delay is a real operational fact, not a
 *      punishment, which is what makes it defensible to a professional.
 *   2. RATE DIFFERENTIAL. A lower commission on digital, or a higher one on
 *      cash. The strongest lever and the most visible; both are off (0) until
 *      the numbers are chosen deliberately.
 *   3. INSTANT PAYOUT. An opt-in fee to get money the same day. Turns the
 *      hold time into a service rather than only a cost, and it prices the
 *      float honestly.
 *   4. CUSTOMER SIDE. DELIBERATELY NOT A PRICE LEVER, and there is no constant
 *      for it here. What digital actually gets a customer is said plainly at
 *      the moment they choose — refunds straight back to them, nothing to
 *      confirm afterwards, a receipt they can show a landlord or an office,
 *      no cash in the house. That costs nothing and is true.
 *
 *      If money is ever added it will be CREDIT TOWARD A NEXT BOOKING, never
 *      money off this one: it is cheaper, it drives a second booking, and it
 *      does not make the customers who can only pay cash feel taxed for it.
 *      A discount off the current job would do the opposite of all three.
 *
 *      Before spending anything, ask eSewa and Khalti during merchant
 *      onboarding what cashback campaigns we can join. If the gateway funds
 *      it, the incentive costs us nothing and reaches the same customer.
 *
 * NOT a lever: ranking. Placing digital-preferring professionals higher would
 * make list position depend on something the customer chose, and the list is
 * about who does the work well. It stays out.
 *
 * Every number below is a business decision. They are deliberately shipped
 * with the differentials at zero — the hold times are real and already do
 * useful work — so turning an incentive on is one edit here and nothing else.
 */

export const PAYOUT_RULES = {
  /** Lever 1. Verified by a gateway, so the money can move quickly. */
  digitalHoldHours: 24,
  /** Lever 1. Reconciled from a customer's confirmation, so it waits. */
  cashHoldHours: 24 * 7,
  /**
   * Lever 2. Basis points taken OFF THE PLATFORM FEE CHARGED TO THE
   * PROFESSIONAL when a job settles digitally. Live at 200, so a digital job
   * is settled at 13% commission against cash's 15%.
   *
   * THE CUSTOMER PAYS THE SAME AMOUNT WHATEVER METHOD THEY CHOOSE. Nothing in
   * this product changes the price a customer is quoted or billed based on how
   * they pay. This moves what the professional keeps, and nothing else.
   *
   * It was called `digitalDiscountBps` and was misread as a customer discount
   * by the person who set the number — which is the whole argument for the
   * longer name.
   */
  digitalCommissionReductionBps: 200,
  /**
   * Lever 2. Basis points ADDED to the platform fee charged to the
   * professional on a cash job. Not a charge to the customer, who pays the
   * quoted amount either way. DELIBERATELY ZERO,
   * and it is not the same decision as the discount with the sign flipped.
   *
   * The two are arithmetically interchangeable — a 2% discount on digital and
   * a 2% surcharge on cash produce nearly the same gap — and they are morally
   * nothing alike. Cash in Nepal is not a preference; for a large part of the
   * country it is the only instrument there is, and the people paying with it
   * skew older and poorer. A surcharge would tax them for OUR fraud problem,
   * and it would land hardest on the professionals serving them.
   *
   * A discount rewards a choice. A surcharge punishes a circumstance. Leave
   * this at zero.
   */
  cashCommissionSurchargeBps: 0,
  /**
   * Lever 3. What an opt-in same-day payout costs THE PROFESSIONAL, in basis
   * points of their own earning. Never touches the customer. 0 = not offered.
   */
  instantPayoutFeeBps: 0,
} as const;

/** Cash is the only method we do not hear about from a gateway. */
export function isDigital(method: string): boolean {
  return method !== "cash";
}

/**
 * The COMMISSION rate for one settlement — what the platform takes from the
 * professional — before it is frozen onto the booking.
 *
 * Nothing here reaches the customer's price. They are quoted a band, they
 * agree a final amount on site, and they pay that amount whichever method they
 * pick. Every number in this file moves money between us and the
 * professional.
 *
 * Returns the base rate untouched while both differentials are zero, so the
 * incentive can be switched on without touching any caller.
 */
export function commissionBpsFor(method: string, baseBps: number): number {
  const adjusted = isDigital(method)
    ? baseBps - PAYOUT_RULES.digitalCommissionReductionBps
    : baseBps + PAYOUT_RULES.cashCommissionSurchargeBps;
  // Never below zero and never above the whole amount, whatever is configured.
  return Math.max(0, Math.min(10_000, adjusted));
}

/**
 * When this settlement becomes payable.
 *
 * Computed at settlement and stored, not recomputed on read: a professional
 * told "Thursday" must still be paid on Thursday if somebody edits these
 * numbers on Wednesday.
 */
export function payoutDueAt(settledAt: Date, method: string): Date {
  const hours = isDigital(method)
    ? PAYOUT_RULES.digitalHoldHours
    : PAYOUT_RULES.cashHoldHours;
  return new Date(settledAt.getTime() + hours * 3_600_000);
}

/** How many days sooner digital arrives. What the screen actually says. */
export function daysSoonerWithDigital(): number {
  return Math.round(
    (PAYOUT_RULES.cashHoldHours - PAYOUT_RULES.digitalHoldHours) / 24,
  );
}
