/**
 * What each step of the published enforcement ladder actually costs.
 *
 * `/providers/standards` is the specification and this file is the
 * implementation of it. Five steps are published, in both languages, linked
 * from `/providers/join` before anybody signs up — and until 20261017000001 the
 * database could express exactly one of them. `removed_at` was step 5 and
 * nothing in the tree wrote it; steps 3 and 4 had no state at all. A ladder
 * published with no rungs is this repository's most-recorded sin standing in
 * front of the person deciding whether to trust us with their livelihood.
 *
 * PURE, AND EVERY SURFACE ASKS IT RATHER THAN RE-DERIVING THE TEST. That is
 * `lib/provider/measured.ts`'s arrangement and it exists for the same reason:
 * the catalogue, the open-job policy, the payment method and the payout run each
 * have to know what step 4 means, and four copies of `step >= 4` drift the first
 * time somebody reads the page differently. `countsAsEvidence` was written twice
 * for the length of one commit and that was enough.
 *
 * STEPS 1 AND 2 CARRY NO STATE, deliberately. Step 1 is a private message and
 * step 2 is list position, which `withdrawalRankingPenalty` already computes
 * from `provider_stats` — giving either a column would create a second place
 * that decides something already decided, and a step 2 somebody could set by
 * hand would be a ranking penalty with no measurement behind it.
 *
 * ONE ORDERED NUMBER RATHER THAN THREE FLAGS, because the page is ordered: step
 * 4 includes step 3's effects and step 5 includes both. Flags would admit
 * "payouts held but still offered open jobs", a state the page does not describe
 * and nobody could explain to the professional it was applied to.
 */

/** The steps that carry state. 1 and 2 are not stored — see the header. */
export const ENFORCEMENT_STEPS = [3, 4, 5] as const;

export type EnforcementStep = (typeof ENFORCEMENT_STEPS)[number];

/** Null is "no step in force", and here that is measured rather than absent. */
export type Enforcement = EnforcementStep | null;

export function isEnforcementStep(value: unknown): value is EnforcementStep {
  return (ENFORCEMENT_STEPS as readonly unknown[]).includes(value);
}

/**
 * Step 3: "you stop being offered jobs from the open pool — customers who ask
 * for you by name still reach you."
 *
 * The second half is the part that is easy to lose. A step that also blocked a
 * customer booking somebody by name would be step 4 wearing step 3's label, and
 * the professional would read the page, accept step 3, and find their repeat
 * customers unable to reach them.
 */
export function closesOpenPool(step: Enforcement): boolean {
  return step !== null && step >= 3;
}

/**
 * Step 3: "New jobs settle by eSewa or Khalti only."
 *
 * NEW JOBS, which is why this is asked when a booking is created and when a
 * method is chosen, never at settlement. A job agreed as cash before the step
 * was raised settles as cash: changing how an existing booking pays would be
 * changing the deal after it was struck, and the money rules in this product
 * are forward-only everywhere else for the same reason.
 */
export function forcesDigitalSettlement(step: Enforcement): boolean {
  return step !== null && step >= 3;
}

/**
 * Step 4: "Your listing stops appearing while the review runs."
 *
 * Step 3 deliberately does NOT hide the listing — the page says by-name
 * customers still reach them, and a hidden listing is how they stop being able
 * to.
 */
export function hidesListing(step: Enforcement): boolean {
  return step !== null && step >= 4;
}

/**
 * Step 4: "money already earned waits rather than being paid out. It is not
 * taken. If the review clears you, it is released in full with an apology."
 *
 * HELD, NEVER DEDUCTED. The hold reason is its own value in
 * `PAYOUT_HELD_REASONS` rather than reusing `no_destination` or `negative`,
 * because the professional's own screen prints that reason and "we are reviewing
 * your account" and "we do not know where to send it" are not the same sentence
 * to be told.
 */
export function holdsPayout(step: Enforcement): boolean {
  return step !== null && step >= 4;
}

/**
 * Step 5: "the listing is removed permanently."
 *
 * Paired with `removed_at` by `providers_removed_is_step_five`, so the column
 * four other modules already read cannot disagree with this one.
 */
export function isRemoved(step: Enforcement): boolean {
  return step === 5;
}

/**
 * May a customer book this professional by name right now?
 *
 * Composed from the two above rather than written as its own comparison, so a
 * change to what step 4 means reaches this in one edit. `blocked` at step 4 and
 * 5 and NOT at step 3 is the published distinction stated once.
 */
export function blocksDirectBooking(step: Enforcement): boolean {
  return hidesListing(step) || isRemoved(step);
}

/**
 * The lift. Every step is reversible except the one the page says is permanent.
 *
 * STEP 5 IS NOT LIFTED, and refusing it here rather than in the screen is the
 * difference between a rule and a habit: the page says "removed permanently" and
 * "where a customer was overcharged, they are refunded first". Somebody who
 * should come back re-applies, which `provider_applications` already handles and
 * which leaves a record of the second decision. Quietly clearing step 5 would
 * erase the first one.
 */
export function canLift(step: Enforcement): boolean {
  return step !== null && step !== 5;
}
