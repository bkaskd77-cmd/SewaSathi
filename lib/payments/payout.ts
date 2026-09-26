import { GUARANTEE_WINDOWS, guaranteeFor } from "@/lib/config/guarantee";

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
  /**
   * What WE PAY a surveyor when the move does not go ahead. Rupees, not basis
   * points, because there is no job to take a percentage of.
   *
   * WHO CARRIES THE TRIP. A movers job starts with somebody travelling across
   * the Valley to look at a flat, and that happens whether or not the customer
   * accepts the price. When they do, the survey is folded into the job the
   * professional is about to be paid for and nothing is due here. When they do
   * not, the trip still happened, and a professional out of pocket for a
   * stranger's change of mind learns to stop taking survey jobs. Movers is the
   * one trade where EVERY job starts with one, so that is the whole supply.
   *
   * THE CUSTOMER NEVER PAYS IT AND IS NEVER TOLD OF IT. "Free survey" has to
   * mean free, or it is a booking fee with a friendlier name.
   *
   * WHAT STOPS IT BEING FARMED — quote absurdly high, get declined, collect —
   * is NOT this number, and for a while it was written here as though it were.
   * Three mechanisms, and they live where they can bite:
   *
   *   1. `survey_visit_fees` rows are born `pending` and pay only when a PERSON
   *      approves them. The default is not paid. A payoff you have to persuade
   *      a human for is not a farm, and this is the same shape
   *      `commission_appeals` and the guarantee refund already use.
   *   2. `enforce_survey_visit_fee` refuses a row with no recorded arrival, so
   *      the trip is mandatory — and the trip is most of the real cost.
   *   3. The cap below is enforced by that same trigger, not by this comment.
   *
   * The economics are the background: a Valley survey is two to three hours
   * door to door, so this is about Rs 200/hour, while ONE accepted move leaves
   * the professional more than six months of the monthly ceiling. Farming is a
   * bad trade before any of the guards above — but a bad trade is not a guard.
   */
  surveyVisitFeeNpr: 500,
  /**
   * The most APPROVED survey visit fees one professional may draw in a month.
   *
   * Four trips. Enough that nobody is out of pocket for an ordinary run of
   * customers changing their minds, low enough that quoting to be declined is
   * not a living. Enforced in `enforce_survey_visit_fee`, which counts approved
   * rows only: counting pending ones would let a run of honest declines block a
   * real claim while somebody waits for a person to look, which would punish
   * the surveyor for the length of our queue.
   */
  surveyVisitFeeMonthlyCap: 4,
  /**
   * The most of ONE payout that may go to clearing a redo the professional
   * already owes. 2500 = a quarter.
   *
   * NOT A FEE AND NOT NEW MONEY. Nothing is taken from the professional here
   * that they did not already owe, and nothing at all reaches the customer's
   * price. This only decides how fast an existing debt comes off, and the cap
   * exists to stop a week's earnings going to zero.
   *
   * THE HOLE THIS FILLS. The guarantee runs 30 to 90 days; the payout hold
   * above runs 24 hours to 7 days. So by the time most claims arrive the money
   * has gone, and "we hold their payout" is only true for the first week. The
   * answer is to net forward, never to recover backward: we have no card on
   * file, no direct debit and no wage to garnish, so chasing a paid-out
   * professional for cash selects against exactly the wrong people — the
   * honest ones feel robbed and leave, and the rest simply stop taking our
   * jobs and keep the money.
   *
   * A quarter clears a typical redo over three or four settlements. Half was
   * considered and rejected: losing half a week is the size of shock that
   * makes somebody stop working for us, which loses the remaining debt as
   * well as the person.
   */
  redoRecoveryCapBps: 2500,
  /**
   * How long a balance follows somebody who has stopped working, before it is
   * written off and the listing closes.
   *
   * WHY THERE IS AN END AT ALL. Without one the debt is immortal:
   * `provider_outstanding` sums a ledger that only grows, so a professional who
   * left two years ago still owes us on a screen nobody will ever act on. That
   * is not prudence, it is a number pretending to be an asset — we have no card
   * on file, no direct debit and no way to collect a rupee of it, and this file
   * already refuses backward recovery for that exact reason.
   *
   * WHY TWELVE MONTHS. It has to be long enough that an ordinary gap does not
   * end somebody's listing — a season away, an illness, a year on a building
   * site — and short enough that the write-off is a real event rather than a
   * formality nobody reaches. A professional who has completed nothing in a
   * year has left, and the honest thing is to close the account rather than
   * carry a claim against them indefinitely.
   *
   * THE CLOSE IS WHAT MAKES IT FINAL, AND IT IS NOT A PUNISHMENT. `closed_at`
   * on `providers` is a third state beside `is_active` and `removed_at`: no
   * finding against anybody, and coming back means re-applying, which is
   * allowed. Folding it into `removed_at` would write a false accusation into
   * the schema — that column is step 5 of the enforcement ladder.
   *
   * ONLY LISTINGS CARRYING A BALANCE. Somebody who owes nothing and takes a
   * year off keeps their listing; closing every quiet one would deactivate
   * people who have done nothing but be quiet, and would need its own decision.
   *
   * This is published on /providers/standards, in both languages, before
   * anybody signs up — and `sweepWriteOffs` in lib/data/recovery.ts is what
   * makes the sentence true. It was built in the same commit as the copy,
   * deliberately: `applyRedoRecovery` spent four phases as a tested function
   * with no caller while that same page promised what it would have done.
   */
  writeOffAfterMonths: 12,
  /**
   * The share of a payout held back where the guarantee runs long. 2500 = a
   * quarter.
   *
   * THIS TAKES NOTHING. Every other number in this file moves money between us
   * and the professional; this one moves none. It is **their** money, arriving
   * in two parts instead of one, and nothing about it reduces what they are
   * finally paid. `digitalDiscountBps` was misread as a customer discount by
   * the person who set it, and a holdback misread as a deduction is that same
   * mistake with more at stake — so the name says holdback and this paragraph
   * says deferred, not deducted.
   *
   * WHY IT EXISTS. The guarantee outlives the payout. `GUARANTEE_WINDOWS` gives
   * painting 90 days because peeling and blistering take weeks to appear; the
   * hold above is 24 hours to 7 days. So on exactly the trades where a defect
   * shows up late, every rupee has already gone by the time anybody can claim,
   * and the only remaining answer is `applyRedoRecovery` netting forward — which
   * works if they keep working and is a write-off if they do not.
   *
   * WHY IT IS NOT THE THING THIS FILE ALREADY REFUSES. Extending the hold to
   * cover the window was refused, and rightly: nobody works for a platform that
   * pays in a month, and it would punish the many who never generate a claim.
   * That objection is about a LONG hold on ALL the money for EVERY trade. This
   * is a quarter, for 30 days, only where the window is long — three
   * differences, each of which the refusal turned on.
   */
  guaranteeHoldbackBps: 2500,
  /**
   * How long the held quarter waits, in days.
   *
   * Not the whole 90. A hold matched to the window would be the refused version
   * wearing a smaller number, and most claims that arrive at all arrive early —
   * a bad paint job is obvious. Thirty days buys the period where a real defect
   * is most likely to surface without making the professional wait a season for
   * money they have already earned.
   */
  holdbackDays: 30,
  /**
   * The guarantee window, in days, at which a trade starts holding back.
   *
   * THE RULE IS THE WINDOW, NOT THE TRADE. Painting is the only 90-day entry in
   * `GUARANTEE_WINDOWS` today, so a literal list of trades would behave
   * identically and read more simply — and would quietly stop being right the
   * day somebody adds another long-window trade with the same exposure and no
   * hold. Deriving it means the rule is "where the guarantee outlives the payout
   * by this much, hold a portion", which is the actual reason, and it is
   * published in those terms so a professional in a future 90-day trade is not
   * surprised by it.
   *
   * The cost of deriving is that a trade can acquire a holdback without anybody
   * deciding to give it one. `holdbackTrades()` exists so that is visible rather
   * than buried: `/admin/signals` lists every trade currently holding.
   */
  holdbackWhenGuaranteeDays: 90,
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

/**
 * One settlement's share of a redo the professional already owes.
 *
 * `outstanding` is their whole balance; `earning` is what this settlement
 * would otherwise pay them. Returns what they actually receive, what came off
 * the debt, and what is still owed after it.
 *
 * WHY THIS SHAPE. A redo where the original professional goes back themselves
 * moves no money at all — they spend their own morning and there is nothing to
 * recover. This function is for the narrower case where somebody else had to
 * attend, so a second professional was paid in full for real work, and the
 * first one's payout had already left. It nets that forward against their next
 * earnings rather than asking for it back.
 *
 * IF THEY NEVER WORK FOR US AGAIN IT IS A WRITE-OFF, deliberately. That is the
 * real cost of offering a guarantee, and it is bounded: one unrecovered redo
 * is roughly the commission from three or four jobs. The unbounded version was
 * consequential damage, which the policy excludes in writing.
 */
export function applyRedoRecovery({
  earning,
  outstanding,
}: {
  earning: number;
  outstanding: number;
}): { paid: number; recovered: number; remaining: number } {
  if (earning <= 0 || outstanding <= 0) {
    return { paid: Math.max(0, earning), recovered: 0, remaining: Math.max(0, outstanding) };
  }

  const ceiling = Math.floor((earning * PAYOUT_RULES.redoRecoveryCapBps) / 10_000);
  const recovered = Math.min(outstanding, ceiling);
  return {
    paid: earning - recovered,
    recovered,
    remaining: outstanding - recovered,
  };
}

/* ------------------------------------------------------------------ *
 * The holdback
 * ------------------------------------------------------------------ */

/** Does this trade's guarantee run long enough to hold a portion back? */
export function holdsBack(categorySlug: string): boolean {
  return (
    guaranteeFor(categorySlug).days >= PAYOUT_RULES.holdbackWhenGuaranteeDays
  );
}

/**
 * Every trade currently holding back, derived rather than listed.
 *
 * EXISTS SO THE DERIVED RULE CAN BE READ. A rule computed from another table is
 * correct and invisible: nothing anywhere would answer "which trades hold?"
 * without somebody opening `GUARANTEE_WINDOWS` and doing the comparison in their
 * head. `/admin/signals` prints this, because a rule nobody can enumerate is one
 * we end up guessing about later.
 */
export function holdbackTrades(): Array<{ slug: string; guaranteeDays: number }> {
  return Object.entries(GUARANTEE_WINDOWS)
    .filter(([, g]) => g.days >= PAYOUT_RULES.holdbackWhenGuaranteeDays)
    .map(([slug, g]) => ({ slug, guaranteeDays: g.days }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export type PayoutPlan = {
  /** When the first part becomes payable. */
  dueAt: Date;
  /**
   * What is held, and when it is released. **Both null or both set** — null is
   * "no hold applies here", which is a different fact from a hold that computed
   * to zero, and the column's shape constraint says the same thing in SQL.
   */
  holdbackRupees: number | null;
  holdbackUntil: Date | null;
};

/**
 * When this settlement's money actually reaches the professional, in full.
 *
 * ONE FUNCTION RATHER THAN A DATE AND A RULE APPLIED SEPARATELY, because the
 * settlement writes all three columns and they have to agree. `payoutDueAt` is
 * still the only place the hold times live; this wraps it.
 *
 * Computed at settlement and stored, never recomputed on read — the same reason
 * `payoutDueAt` is: somebody told a date must be paid on that date even if these
 * numbers move the next day.
 */
export function payoutPlan({
  settledAt,
  method,
  categorySlug,
  providerEarning,
}: {
  settledAt: Date;
  method: string;
  categorySlug: string;
  providerEarning: number;
}): PayoutPlan {
  const dueAt = payoutDueAt(settledAt, method);

  if (!holdsBack(categorySlug) || providerEarning <= 0) {
    return { dueAt, holdbackRupees: null, holdbackUntil: null };
  }

  /*
   * FLOORED, so the held part can never exceed the quarter published. The
   * rounding remainder goes to the professional in the first tranche, which is
   * the direction that needs no explaining to them.
   */
  const holdbackRupees = Math.floor(
    (providerEarning * PAYOUT_RULES.guaranteeHoldbackBps) / 10_000,
  );

  /*
   * A JOB SO SMALL THE QUARTER ROUNDS TO NOTHING holds nothing, and says so with
   * null rather than 0. Zero would mean "held, and it came to nothing"; null
   * means "no hold here". Splitting a payout to defer zero rupees would be a
   * second date on a screen for no money at all.
   */
  if (holdbackRupees <= 0) {
    return { dueAt, holdbackRupees: null, holdbackUntil: null };
  }

  return {
    dueAt,
    holdbackRupees,
    holdbackUntil: new Date(
      dueAt.getTime() + PAYOUT_RULES.holdbackDays * 24 * 3_600_000,
    ),
  };
}

/** How many days sooner digital arrives. What the screen actually says. */
export function daysSoonerWithDigital(): number {
  return Math.round(
    (PAYOUT_RULES.cashHoldHours - PAYOUT_RULES.digitalHoldHours) / 24,
  );
}
