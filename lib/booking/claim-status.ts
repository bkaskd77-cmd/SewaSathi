/**
 * A guarantee claim, from "it has gone wrong again" to who pays for the visit.
 *
 * THE VISIT IS THE VERIFICATION, and this machine exists to make that literal.
 * `lib/config/guarantee.ts` sets out the promise and the verdict table; what
 * was missing was the sequence, and the sequence is where the anti-farming
 * design either holds or leaks. A claim cannot be resolved from a description
 * typed into a box — it has to be *attended*, by somebody who stood in the
 * room, before any verdict exists at all. So `attended` is not an optional
 * waypoint on the way to `resolved`: it is the only route.
 *
 * WHY NOT LET SUPPORT CLOSE A CLAIM DIRECTLY. Because the expensive half of
 * the policy is a refund and the cheap half is a re-do, and a path that skips
 * the visit is a path where somebody talks their way to the expensive half. It
 * would also quietly recreate the hole the whole guarantee is shaped to avoid:
 * a deterministic route to free work for anybody willing to describe a
 * different problem each time.
 *
 * `withdrawn` exists because customers change their minds — the tap started
 * working, they found the real cause, they would rather not. Ending it must be
 * one tap, and it must not count against them: `claimIsAllowed` reads
 * `totalClaims`, so a withdrawn claim burning one of two would punish somebody
 * for being honest.
 *
 * Pure, and paired with `claim_transition_allowed` in SQL. Two implementations
 * of one machine escalate differently depending on who asked, and the
 * difference stays invisible until it matters — which is why
 * `npm run check:transitions` parses both.
 */

export const CLAIM_STATUSES = [
  /** Raised by the customer, nobody dispatched yet. */
  "open",
  /** A professional is on their way to look. */
  "dispatched",
  /** Somebody stood in the room and recorded what they found. */
  "attended",
  /** Verdict applied, and who pays is settled. */
  "resolved",
  /** The customer ended it themselves. */
  "withdrawn",
  /** Support closed it without a visit. Never produces a payment. */
  "rejected",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * THE ONLY ROUTE TO `resolved` IS THROUGH `attended`.
 *
 * Read the table for that one property first. Everything else here is
 * bookkeeping; that edge is the policy.
 *
 * `rejected` is reachable from `open` and `dispatched` but NOT from
 * `attended` — once somebody has been and looked, there is a verdict, and the
 * verdict decides. Letting support overrule a person who was in the room would
 * make the visit theatre.
 */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  open: ["dispatched", "withdrawn", "rejected"],
  dispatched: ["attended", "open", "withdrawn", "rejected"],
  attended: ["resolved"],
  resolved: [],
  withdrawn: [],
  rejected: [],
};

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isClaimClosed(status: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[status].length === 0;
}

/**
 * Does this claim still count against the two-per-booking limit?
 *
 * A withdrawn claim does not. Somebody who raised a claim and then found the
 * real cause themselves has done us a favour, and charging them one of their
 * two for it teaches the opposite lesson.
 *
 * A rejected one does count. It consumed a decision, and without this the
 * limit is unbounded for anybody willing to be refused repeatedly.
 */
export function countsAgainstLimit(status: ClaimStatus): boolean {
  return status !== "withdrawn";
}

export function isClaimStatus(value: string): value is ClaimStatus {
  return (CLAIM_STATUSES as readonly string[]).includes(value);
}
