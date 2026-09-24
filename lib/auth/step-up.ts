/**
 * How long an admin's second factor counts for, and what to do when it does not.
 *
 * Pure and dependency-free, the same rule `lib/booking/cancellation.ts` and
 * `lib/payments/pricing.ts` follow: it decides access, so it has to be readable
 * in one screen and testable without a session.
 */

/** What a gate needs to know. Deliberately the shape `mfaState` returns. */
export type StepUpInput = {
  role: string;
  hasFactor: boolean;
  verified: boolean;
  verifiedAt: Date | null;
  now?: Date;
};

export type StepUpVerdict =
  /** Not an admin. Nothing here applies. */
  | "not-required"
  /** An admin who has never set up a second factor. Send them to enrol. */
  | "enrol"
  /** Enrolled, but this session has not used it, or used it too long ago. */
  | "challenge"
  /** Verified and inside the window. */
  | "ok";

/**
 * EIGHT HOURS, ABSOLUTE FROM VERIFICATION.
 *
 * WHY EIGHT AND NOT LESS. The admin work in this product is batched — three
 * queues and the application review, opened a few times a day, not
 * continuously. A code every thirty minutes means typing one a dozen times a
 * day, and somebody doing that stops reading the screen before they approve.
 * That is precisely the failure `lib/payments/pricing.ts` names when it
 * refuses to make a customer re-approve a figure they already agreed: it
 * "teaches them to tap through approvals". A gate that produces reflexive
 * tapping protects less than one that does not. Eight hours covers one working
 * day — verify in the morning, work the queues, done.
 *
 * WHY ABSOLUTE AND NOT SLIDING. A sliding window renews itself for ever on a
 * machine somebody left open, which is the exact scenario this exists for. An
 * absolute one ends the day it began: a laptop still open at six is no longer
 * admin-capable.
 *
 * WHY ONE TIER AND NOT A SHORTER ONE FOR DOCUMENTS. Two tiers is where a
 * reviewer stops knowing which gate they are behind, and document reads
 * already have the control that answers "who looked" — `recordDocumentAccess`
 * names every one of them in a log the application cannot edit. One constant;
 * tightening it is one line.
 */
export const STEP_UP_HOURS = 8;

/**
 * Does this person need to do something before the admin screens open?
 *
 * AN ADMIN WITH NO FACTOR IS SENT TO ENROL, NEVER BLOCKED, and that is the
 * whole reason this can ship before anybody has enrolled. Enforcement keys on
 * "has a factor and has not used it", so the account that needs to set one up
 * can always reach the screen that sets it up. Returning `enrol` rather than
 * `challenge` is what keeps the only admin in the product from being locked
 * out by the commit that protects them.
 *
 * A MISSING TIMESTAMP IS TREATED AS EXPIRED. `amr` should carry one, but a
 * claim that is absent is not evidence the window is open — the same rule as
 * `unknown is never ok`, applied where guessing wrong grants access.
 */
export function stepUpFor(input: StepUpInput): StepUpVerdict {
  if (input.role !== "admin") return "not-required";
  if (!input.hasFactor) return "enrol";
  if (!input.verified) return "challenge";
  if (!input.verifiedAt) return "challenge";

  const now = (input.now ?? new Date()).getTime();
  const age = now - input.verifiedAt.getTime();
  if (!Number.isFinite(age)) return "challenge";

  return age < STEP_UP_HOURS * 60 * 60 * 1000 ? "ok" : "challenge";
}

/** Does this verdict mean the admin screens stay shut? */
export function stepUpBlocks(verdict: StepUpVerdict): boolean {
  return verdict === "enrol" || verdict === "challenge";
}

/**
 * Where somebody goes once this screen has done its job.
 *
 * THE RETURN TRIP, WHICH DID NOT EXIST. `/admin` bounces an un-enrolled admin
 * to `/account/security?next=/admin`, and the screen ignored the parameter
 * entirely: somebody who set up their authenticator was left sitting there
 * with no way back, having never been told why they had been sent. Carrying
 * `next` and then dropping it is worse than never carrying it — the product
 * asked for something, got it, and did nothing with it.
 *
 * NULL MEANS STAY, and it is the answer for every state but one. Returning
 * before the gate would actually let them through just means arriving and
 * being bounced back here, which reads as the button having failed. So both
 * halves have to be true: a factor exists, and this session has proved it.
 *
 * `next` IS ALREADY THROUGH `safeRedirect` BY THE TIME IT ARRIVES. This
 * function does no redirect validation of its own and must never start —
 * `lib/auth/routes.ts` is the one place that decides whether a path is safe to
 * send anybody to, and a second opinion on that is how the two come to
 * disagree. "/" is what `safeRedirect` returns for nothing-was-asked-for, so
 * it means they opened their own settings and nobody sent them.
 *
 * Pure, like everything else in this file, so the rule is tested without a
 * session.
 */
export function afterSecurity(input: {
  /** Already through `safeRedirect`; "/" means they did not say. */
  next: string;
  hasFactor: boolean;
  needsCode: boolean;
}): string | null {
  if (input.next === "/") return null;
  if (!input.hasFactor || input.needsCode) return null;
  return input.next;
}
