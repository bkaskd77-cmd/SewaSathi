/**
 * The guarantee: what we promise after the work is done, and who pays for it.
 *
 * THE SENTENCE THAT STARTED THIS. The cash confirmation screen tells every
 * customer "your guarantee covers up to the amount you enter". That line is
 * load-bearing — it is what makes blind cash entry fair, because it is what a
 * customer loses by going along with an under-reported figure. It lived in the
 * message catalogue and nowhere else: no scope, no window per trade, nothing a
 * professional had agreed to, and no rule about who pays. This file is that
 * rule.
 *
 * THE ASYMMETRY EVERYTHING HERE IS BUILT ON. A re-do costs us close to
 * nothing, because the labour belongs to the professional whose defect it was.
 * A refund costs us real money. So the re-do can be generous and A REFUND IS
 * NEVER AUTOMATIC — see `claimOutcome`.
 *
 * WHEN THE MONEY HAS ALREADY GONE OUT. The window here runs 30 to 90 days; the
 * payout hold runs 24 hours to 7 days. So for most of the window there is no
 * payout left to withhold, and an earlier draft of this file claimed otherwise.
 * Three cases, and only one of them moves money at all:
 *
 *   1. The original professional goes back themselves. Nothing is paid to
 *      anybody — they spend their own morning — so there is nothing to
 *      recover. This is the common case and the one the policy steers toward.
 *   2. Somebody else has to attend. That second professional did real work and
 *      is paid in full; the amount becomes a debt the first one owes, netted
 *      off their FUTURE earnings by `applyRedoRecovery` in
 *      `lib/payments/payout.ts`, capped so no single week goes to zero.
 *   3. They never work for us again, and it is written off. That is the true
 *      cost of offering a guarantee and it is bounded — roughly the commission
 *      from three or four jobs, each time it happens.
 *
 * WE NEVER CHASE A PAID-OUT PROFESSIONAL FOR CASH. There is no card on file,
 * no direct debit and no wage to garnish, so backward recovery would select
 * against the wrong people: the honest ones feel robbed and leave, the rest
 * stop taking our jobs and keep the money. Forward netting is the whole
 * mechanism.
 *
 * THE HOLE THIS CLOSES. The obvious version of a guarantee — "second failure
 * goes to somebody else, third one is a refund" — hands the customer a
 * deterministic route to free work, repeatable on every booking, by reporting
 * a *different* problem each time in the same trade. It is the same class of
 * mistake as under-reporting on the provider side: a rule whose payoff is
 * worth gaming. The answer is that THE VISIT IS THE VERIFICATION. Every claim
 * sends somebody, the person standing there records what they found, and that
 * verdict decides who pays. A blocked sink after a fixed tap is a new plumbing
 * job, not a claim, and it is priced like one.
 *
 * Pure and dependency-free, for the same reason as `lib/booking/cancellation.ts`
 * and `lib/payments/pricing.ts`: it decides money, so it has to be readable in
 * one screen and testable without a database.
 *
 * The claim table, the claim button and the verdict capture are Phase 11. What
 * exists now is the promise, stated precisely enough to publish.
 */

/**
 * What "putting it right" means for a trade.
 *
 * `redo`    — we send somebody back to fix the same fault.
 * `reclean` — cleaning: we send somebody back to do the part that was missed.
 * `report`  — movers: the window is for *reporting* transit damage, not for
 *             the damage appearing. After it, nobody can say it happened in
 *             the van.
 */
export type GuaranteeKind = "redo" | "reclean" | "report";

export type Guarantee = {
  /** The window, in whole days. 2 means 48 hours exactly. */
  days: number;
  kind: GuaranteeKind;
  /**
   * Message key under `common.guaranteeWindows`, so the window is written once
   * per language rather than assembled from a number and a noun — Nepali does
   * not build "30-day" the way English does.
   */
  labelKey: GuaranteeLabelKey;
};

export type GuaranteeLabelKey = "d30" | "d90" | "h48";

/**
 * The window per category, and the reasoning, because one number across ten
 * trades is the mistake — meaningless for cleaning, arbitrary for painting.
 */
export const GUARANTEE_WINDOWS: Record<string, Guarantee> = {
  // A repair that holds a month held. Failures show inside days, not weeks.
  plumbing: { days: 30, kind: "redo", labelKey: "d30" },
  electrical: { days: 30, kind: "redo", labelKey: "d30" },
  "appliance-repair": { days: 30, kind: "redo", labelKey: "d30" },
  "ac-servicing": { days: 30, kind: "redo", labelKey: "d30" },
  carpentry: { days: 30, kind: "redo", labelKey: "d30" },
  "water-tank-cleaning": { days: 30, kind: "redo", labelKey: "d30" },

  /*
   * Pest control sells a course, not a visit. Thirty days is the same window
   * as a repair, but the second visit there is the product rather than a
   * failure, and the copy says so — a customer told they are "making a claim"
   * for the follow-up they were always going to get is being told something
   * untrue about their own job.
   */
  "pest-control": { days: 30, kind: "redo", labelKey: "d30" },

  /*
   * Peeling and blistering take weeks to appear. Ninety days is normal in the
   * trade and cheap to honour: a bad paint job is obvious and rare.
   */
  painting: { days: 90, kind: "redo", labelKey: "d90" },

  /*
   * Forty-eight hours, and anything longer would be dishonest: a house gets
   * dirty again and that is not a defect. This window covers "they missed the
   * kitchen", which is the only cleaning complaint a guarantee can answer.
   */
  "home-cleaning": { days: 2, kind: "reclean", labelKey: "h48" },

  /*
   * Damage is found on unpacking. Two days to *report* it; after that nobody
   * can say the crack happened in our van rather than afterwards.
   */
  "movers-packers": { days: 2, kind: "report", labelKey: "h48" },
};

/**
 * The window for a category we do not recognise.
 *
 * A new category with no entry above gets the ordinary repair window rather
 * than no guarantee at all — a customer who was promised one on the payment
 * screen must not discover it was empty because somebody added a trade and
 * forgot this file. The test is exhaustive over the seed, so the fallback is
 * for data drift in production, not for use as a default.
 */
export const DEFAULT_GUARANTEE: Guarantee = {
  days: 30,
  kind: "redo",
  labelKey: "d30",
};

export function guaranteeFor(categorySlug: string): Guarantee {
  return GUARANTEE_WINDOWS[categorySlug] ?? DEFAULT_GUARANTEE;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the window closes for a job finished at `completedAt`. */
export function guaranteeExpiresAt(
  categorySlug: string,
  completedAt: Date | string,
): Date {
  const from = completedAt instanceof Date ? completedAt : new Date(completedAt);
  return new Date(from.getTime() + guaranteeFor(categorySlug).days * DAY_MS);
}

export function isWithinGuarantee(
  categorySlug: string,
  completedAt: Date | string,
  now: Date = new Date(),
): boolean {
  const from = completedAt instanceof Date ? completedAt : new Date(completedAt);
  if (Number.isNaN(from.getTime())) return false;
  // The moment the window closes is outside it. A boundary has to fall on one
  // side and the published number is the promise, not the promise plus a day.
  return now.getTime() < guaranteeExpiresAt(categorySlug, from).getTime();
}

/* ------------------------------------------------------------------ *
 * The visit is the verification
 * ------------------------------------------------------------------ */

export const CLAIM_VERDICTS = [
  /** The fault that was fixed has come back. */
  "sameFault",
  /** A real problem, but not the one that was fixed. A new job. */
  "differentProblem",
  /** Nothing found wrong. */
  "nothingWrong",
  /** The customer or somebody else caused it after we left. */
  "customerCaused",
] as const;

export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

/** Who the visit is billed to. */
export type ClaimPayer = "provider" | "customer";

export type ClaimOutcome = {
  payer: ClaimPayer;
  /** The customer pays nothing for this visit. */
  free: boolean;
  /**
   * How a refund can happen at all. Always `"person"`.
   *
   * There is no verdict, and no combination of verdicts, that produces money
   * back without a human deciding it. That is the whole anti-farming design:
   * the generous half of this policy is labour we do not pay for, and the
   * expensive half never runs on its own.
   */
  refund: "person";
};

/**
 * The table the whole policy reduces to.
 *
 * An honest customer with a genuinely recurring fault never pays. Somebody
 * fishing for free work pays the normal price for the visit — and knows that
 * before we dispatch anyone, because the booking screen says so in the
 * sentence they agree to.
 */
/**
 * THE CONFLICT OF INTEREST IN THIS TABLE, NAMED SO IT IS NOT FORGOTTEN.
 *
 * On the common path the professional who returns is the one who did the
 * original job — and `differentProblem` is the verdict that gets them paid.
 * They are judging their own work with money on the answer. That is exactly
 * the shape of under-reporting on the settlement side: not a reason to
 * distrust anybody, and every reason not to leave it unmeasured.
 *
 * The answer is the same as it was there: do not police the verdict, measure
 * the pattern. Phase 11 records the verdict against the attending
 * professional, and a run of return visits that come back
 * disproportionately `differentProblem` — against the rate for their trade,
 * never against a fixed number — becomes an input to the leakage score, which
 * starts at "you are told, privately". One verdict is never a signal; the
 * genuinely honest case, a real second fault, is common.
 *
 * Deliberately NOT published on `/providers/standards` yet. Naming a signal we
 * do not compute would be a claim we cannot stand behind, which is what
 * LAUNCH-BLOCKERS.md exists to prevent. It goes on the page in the phase that
 * builds it.
 */
export function claimOutcome(verdict: ClaimVerdict): ClaimOutcome {
  const payer: ClaimPayer = verdict === "sameFault" ? "provider" : "customer";
  return { payer, free: payer === "provider", refund: "person" };
}

/** The half of `claimOutcome` most callers actually want. */
export function whoPays(verdict: ClaimVerdict): ClaimPayer {
  return claimOutcome(verdict).payer;
}

/* ------------------------------------------------------------------ *
 * What it never covers
 * ------------------------------------------------------------------ */

/**
 * Keys, not sentences, so the published copy and the eventual claim form read
 * the same list and cannot drift apart.
 *
 * `consequential` is the important one. "Guarantee" with no scope reads as
 * *everything*, including the water damage from the pipe that failed again —
 * unbounded liability on a 15% commission. It is excluded in plain words on a
 * page anybody can read, not in legal ones at the bottom of the terms.
 */
export const EXCLUSIONS = [
  "differentFault",
  "consequential",
  "customerDamage",
  "suppliedParts",
  "wearItems",
  "declinedWork",
  "thirdPartyWork",
] as const;

export type Exclusion = (typeof EXCLUSIONS)[number];

/* ------------------------------------------------------------------ *
 * Who may claim, decided before anybody looks
 * ------------------------------------------------------------------ */

/**
 * Two claims per booking, then it is support only.
 *
 * Not a punishment: a third visit on one job means something is wrong that a
 * dispatch loop is not going to fix, and a person should be looking at it.
 */
export const MAX_CLAIMS_PER_BOOKING = 2;

export type ClaimRequest = {
  categorySlug: string;
  /** The booking's status. Only a finished job can have gone wrong. */
  status: string;
  /**
   * Whether the job was actually paid for. There is nothing to guarantee on a
   * figure that was never recorded — which is exactly what the sentence on the
   * cash screen tells the customer.
   */
  settled: boolean;
  completedAt: Date | string | null;
  /** Claims on this booking that are still open. */
  openClaims: number;
  /** Claims ever made on this booking, open or closed. */
  totalClaims: number;
  now?: Date;
};

export type ClaimEligibility =
  | { allowed: true; guarantee: Guarantee }
  | {
      allowed: false;
      reason:
        | "notCompleted"
        | "notSettled"
        | "outsideWindow"
        | "claimOpen"
        | "limitReached";
    };

export function claimIsAllowed(request: ClaimRequest): ClaimEligibility {
  if (request.status !== "completed") {
    return { allowed: false, reason: "notCompleted" };
  }
  if (!request.settled) return { allowed: false, reason: "notSettled" };
  if (request.openClaims > 0) return { allowed: false, reason: "claimOpen" };
  if (request.totalClaims >= MAX_CLAIMS_PER_BOOKING) {
    return { allowed: false, reason: "limitReached" };
  }
  if (
    !request.completedAt ||
    !isWithinGuarantee(
      request.categorySlug,
      request.completedAt,
      request.now ?? new Date(),
    )
  ) {
    return { allowed: false, reason: "outsideWindow" };
  }

  return { allowed: true, guarantee: guaranteeFor(request.categorySlug) };
}
