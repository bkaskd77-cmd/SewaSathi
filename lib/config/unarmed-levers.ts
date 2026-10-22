/**
 * Every number in this product that is null because nobody has chosen it.
 *
 * WHY THIS FILE EXISTS, AND IT IS THE `money-assertions.ts` SHAPE. Three
 * constants say "null means unarmed, and nothing reads it" — and that claim has
 * already been false once in the way that costs something. `dispatchPauseFor`
 * sat beside `arrearsPauseRupees` with no caller anywhere and a comment reading
 * "the test asserts that a professional owing a fortune is still dispatched".
 * No such test existed. The sentence described a safety nobody had exercised,
 * which is this repository's most-repeated failure, on a lever that decides
 * whether somebody gets work.
 *
 * SO THE CLAIM IS DECLARED AND TESTED RATHER THAN COMMENTED.
 * `tests/unit/unarmed-levers.test.ts` reads the sources and asserts three
 * things per entry: the live value really is null, nothing outside the
 * declaring module reads the binding, and the stated blocker is still true. It
 * also fails on a FOURTH unarmed lever nobody has declared, which is the half
 * that matters — a list alone goes stale on the first new constant, and the
 * question "and what would arm this?" has to be asked when the constant is
 * invented rather than five phases later.
 *
 * WHAT IT IS NOT. It arms nothing and proposes no number. Every entry's `why`
 * says the same thing in different words: there is no sample to choose a figure
 * from, and a guess written down becomes the policy by accident the first time
 * somebody reads it off a screen. That is `tuning-floors.ts`' posture — reaching
 * a floor is permission to start the argument rather than its conclusion — and
 * it is why the honest deliverable here is a tested inventory rather than three
 * new rules.
 *
 * **AND "PICK A NUMBER" IS NEVER THE WHOLE BLOCKER.** That was the assumption
 * behind all three comments and it is wrong in all three cases, which is the
 * finding this file was written to record:
 *
 *   - `arrearsPauseRupees` would stop sending somebody work, and
 *     `/providers/standards` PUBLISHES the opposite: "Carrying a guarantee
 *     balance… does not move you down the list… no part of this page is
 *     triggered by it." Arming it rewrites a promise to every professional, so
 *     it is a copy decision with a constant attached rather than the reverse.
 *   - `maxFailedChecksPerPeriod` would be read against a count that **does not
 *     exist and by design cannot**: the three answers meaning "this is not
 *     evidence" are unstorable on `guarantee_claim_photos`, so a refused
 *     photograph leaves no row. Its own comment said "the count is kept and
 *     shown", which was a comment describing behaviour the code does not have.
 *   - `maxPaidClaimsPerPeriod` would be the first rule here that refuses a
 *     professional money automatically, and nothing publishes it. Its comment
 *     already said so; what it did not say is that there is therefore no
 *     one-line arming either.
 */

/**
 * What has to be true before a figure can be enforced.
 *
 * A CLOSED SET RATHER THAN PROSE, so the test can have a case per kind. Prose
 * is what the three comments already were, and prose is what nothing can check.
 */
export type ArmingBlocker =
  /**
   * Published copy says the opposite today. Arming means changing what we have
   * told people, in the same commit, which is a different size of act.
   */
  | "published-copy-contradicts"
  /**
   * There is nothing to read the number against. No column, no count, no row —
   * so arming starts with deciding what to record, which is its own argument.
   */
  | "nothing-to-count"
  /**
   * The rule would refuse somebody money or work with no published statement of
   * what triggers it or how it lifts. `/providers/standards`' own refusal:
   * deterrence nobody can read is a trap rather than a deterrent.
   */
  | "no-published-rule";

export type UnarmedLever = {
  /** The exported binding, exactly as a reader would import it. */
  name: string;
  /** Where it is declared, as an import specifier. */
  module: string;
  /** The live path a figure would reach. Named so arming is not re-argued. */
  wouldActIn: string;
  /** What must be true first. Never only "pick a number" — see the header. */
  blockedBy: ArmingBlocker;
  /**
   * For `published-copy-contradicts`: the file and the phrase that says the
   * opposite. The test asserts the phrase is still there, so arming the lever
   * without changing the copy is a contradiction a run catches rather than a
   * professional does.
   */
  contradicts?: { path: string; phrase: string };
  /**
   * For `nothing-to-count`: the migration and the constraint proving the record
   * is absent. Read out of the file, so a later migration that starts storing
   * refusals makes this entry go red and the blocker gets re-read.
   */
  absentRecord?: { path: string; phrase: string };
  /** Why it is not a number today, in one paragraph. */
  why: string;
};

export const UNARMED_LEVERS: readonly UnarmedLever[] = [
  {
    name: "arrearsPauseRupees",
    module: "@/lib/config/payout-policy",
    wouldActIn:
      "lib/provider/fit.ts (jobFit) or lib/booking/dispatch.ts — whichever surface stops offering work",
    blockedBy: "published-copy-contradicts",
    contradicts: {
      path: "lib/content/pages/standards.ts",
      phrase:
        "it does not move you down the list, it is not one of the five steps below, and no part of this page is triggered by it",
    },
    why:
      "A figure here stops sending a professional new work at some level of " +
      "arrears, and `/providers/standards` publishes, under *What is never a " +
      "signal*, that carrying a guarantee balance does none of that. The two " +
      "cannot both hold. The published version is also the better one on its " +
      "own terms: the balance arises from a refund or a re-do and comes off " +
      "future earnings at a quarter of each payout, so withholding work as " +
      "well would remove the only mechanism that clears it — which is the " +
      "backward-recovery trap the payout rules already refuse, selecting " +
      "against exactly the people who would have paid it off. So this is not " +
      "a constant waiting for a number. It is a constant waiting for somebody " +
      "to decide the published promise was wrong.",
  },
  {
    name: "maxPaidClaimsPerPeriod",
    module: "@/lib/abuse/trip",
    wouldActIn: "settleNoShowClaim in lib/data/customer-risk.ts",
    blockedBy: "no-published-rule",
    why:
      "A cap would refuse a professional the Rs 350 trip payment for a real " +
      "wasted trip once they had claimed often enough — the first rule here " +
      "that takes money off somebody automatically, and nothing anywhere " +
      "publishes it. `/providers/standards` exists precisely because a " +
      "threshold people can only find by tripping it is a trap: the honest " +
      "leave and the rest learn it by experiment. There are two claims in the " +
      "product's whole history, so any figure would be a guess frozen as a " +
      "standard, and guessing low means somebody who had a bad month goes " +
      "unpaid for trips they really made. The claim rate with its denominator " +
      "is on `/admin/claims` instead and a person decides, which is what a " +
      "sample of two supports. Arming it is a published paragraph, a rule, a " +
      "caller and a test in one commit.",
  },
  {
    name: "maxFailedChecksPerPeriod",
    module: "@/lib/photos/evidence",
    wouldActIn:
      "openGuaranteeClaim in lib/data/claims.ts, where a photograph is judged",
    blockedBy: "nothing-to-count",
    absentRecord: {
      path: "supabase/migrations/20261008000002_claim_evidence.sql",
      phrase:
        "The three answers that mean \"this is not evidence\" cannot be stored",
    },
    why:
      "It would count refused photographs from one account over " +
      "`FAILED_CHECK_PERIOD_DAYS`, and **a refused photograph leaves no row**. " +
      "That is `guarantee_claim_photos`' own design and the right one: the " +
      "three answers meaning \"this is not evidence\" are unstorable there, so " +
      "the file is declined at upload and nothing about it is kept. This " +
      "constant's comment said \"the count is kept and shown\", which was a " +
      "comment describing behaviour the code does not have — the class this " +
      "repository keeps recording, on a lever that would gate a payment. " +
      "Arming it therefore starts one step earlier than picking a number: " +
      "somebody has to decide whether to record a fact about a photograph we " +
      "deliberately refuse to keep, and the likelier answer is to count the " +
      "DOUBTS, which are stored — a stale clock, a near-duplicate, a picture " +
      "matching the booking's own. Those are already shown to the person " +
      "deciding, per claim, and nothing aggregates them per account.",
  },
];
