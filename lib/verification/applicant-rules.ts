import { normaliseDigits } from "./match-keys";

/**
 * Rules about the *person* applying, as opposed to their paperwork.
 *
 * Everything here was found by walking the form rather than by reading it, and
 * each one had the same shape: a field the product collected, showed to a
 * reviewer, and never checked. A number in a box is not a fact until something
 * asks whether it can be true.
 */

/* ------------------------------------------------------------------ *
 * Comparing two phone numbers
 * ------------------------------------------------------------------ */

/**
 * The same number written two ways has to compare equal, or every rule below
 * is trivially defeated by typing `+977` in front of one of them.
 *
 * `normaliseDigits` first, because Devanagari numerals are entered by real
 * people on real phones and `९८` is `98`. Then the country code and any
 * leading zero come off, which is what makes `+9779843119897`,
 * `9779843119897` and `9843119897` one number rather than three.
 */
export function nationalDigits(input: string | null | undefined): string {
  if (!input) return "";
  let digits = normaliseDigits(input).replace(/\D/g, "");
  if (digits.startsWith("977")) digits = digits.slice(3);
  return digits.replace(/^0+/, "");
}

/** Two numbers, however they were typed, are the same number. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = nationalDigits(a);
  return left.length > 0 && left === nationalDigits(b);
}

/* ------------------------------------------------------------------ *
 * Age
 * ------------------------------------------------------------------ */

/**
 * NOBODY UNDER EIGHTEEN IS SENT INTO A STRANGER'S HOUSE.
 *
 * The form collected a date of birth, printed it on the reviewer's screen, and
 * checked nothing. An application giving 2008 was accepted and approved, which
 * would have put a seventeen-year-old alone in customers' homes, handling
 * their own money and carrying our guarantee.
 *
 * Eighteen because that is the ordinary threshold for employment and for
 * entering a contract, and because the safeguarding question is not really a
 * legal one: the exact number is worth a lawyer's confirmation (it sits with
 * the other legal review already on the launch blockers), but shipping *no*
 * number was never defensible.
 *
 * IT IS A REFUSAL, NOT A FLAG. Most of this phase deliberately raises things
 * for a human to weigh rather than blocking them, because a rule that guesses
 * wrong costs somebody honest their livelihood. This one is different: there
 * is no reviewer judgement that makes a sixteen-year-old acceptable, so
 * letting it reach the queue only creates a chance of it being waved through.
 */
export const MINIMUM_AGE = 18;

export type AgeVerdict =
  | { ok: true; age: number }
  | { ok: false; reason: "missing" | "unreadable" | "future" | "tooYoung"; age?: number };

/** Whole years, counting the birthday rather than the year alone. */
export function ageOn(dateOfBirth: string, asOf: Date = new Date()): number | null {
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  let age = asOf.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = asOf.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function judgeAge(
  dateOfBirth: string | null | undefined,
  asOf: Date = new Date(),
): AgeVerdict {
  if (!dateOfBirth) return { ok: false, reason: "missing" };

  const age = ageOn(dateOfBirth, asOf);
  if (age === null) return { ok: false, reason: "unreadable" };
  if (age < 0) return { ok: false, reason: "future" };
  if (age < MINIMUM_AGE) return { ok: false, reason: "tooYoung", age };

  return { ok: true, age };
}

/* ------------------------------------------------------------------ *
 * References
 * ------------------------------------------------------------------ */

/**
 * TWO REFERENCES MEANS TWO PEOPLE.
 *
 * The form asked for two and accepted the same number twice — and accepted the
 * applicant's own number as both. That is not a weak reference, it is no
 * reference: the entire value of the step is that somebody who is not the
 * applicant will answer a call and vouch for them.
 *
 * Refused rather than flagged, because unlike most of this phase there is no
 * reading of the evidence that rescues it. A reviewer looking at two identical
 * numbers learns nothing a rule could not have told them at the moment it was
 * typed, and telling somebody at the moment they type it is far kinder than
 * rejecting their application three days later.
 */
export type ReferenceVerdict =
  | "ok"
  | "sameAsApplicant"
  | "alreadyListed"
  | "sameAsPayout";

export function judgeReference(input: {
  /** The number being added. */
  phone: string;
  /** The number they signed in with. */
  applicantPhone: string | null | undefined;
  /** Numbers already on this application. */
  existing: ReadonlyArray<string>;
  /** Where their money is going. */
  payoutAccount?: string | null;
}): ReferenceVerdict {
  if (samePhone(input.phone, input.applicantPhone)) return "sameAsApplicant";
  if (input.existing.some((phone) => samePhone(phone, input.phone))) {
    return "alreadyListed";
  }
  /*
   * A REFEREE WHO HOLDS THE WALLET IS NOT AN INDEPENDENT REFEREE.
   *
   * The payout number is allowed to be somebody else's — usually a spouse or a
   * son — and that is fine on its own. It stops being fine when the same
   * person is also the one vouching for the work, because then the two checks
   * that were supposed to be independent are one person with an interest in
   * the answer. Refused rather than flagged: a second referee costs the
   * applicant nothing, and there is no reading of this that makes it evidence.
   */
  if (samePhone(input.phone, input.payoutAccount)) return "sameAsPayout";
  return "ok";
}

/* ------------------------------------------------------------------ *
 * Where the money goes
 * ------------------------------------------------------------------ */

/**
 * A PAYOUT NUMBER THAT IS NOT THEIRS IS ALLOWED, AND SAID OUT LOUD.
 *
 * Plenty of tradespeople in Nepal do not hold their own wallet — it is a
 * spouse's, a son's, a parent's — and that is more common the older and the
 * less formally banked somebody is, which is precisely the supply this
 * platform exists to reach. Requiring the payout number to match the sign-in
 * number would exclude them, so it is not required.
 *
 * But it is not nothing either. Money leaving to a number the platform never
 * sent a code to is the one place where "we verified this person" stops being
 * true of the destination, and it is the shape of both a family arrangement
 * and somebody being paid into an account they do not control. So the
 * difference is surfaced as a FACT ON THE REVIEWER'S SCREEN rather than
 * hidden behind a number that looks like every other number.
 *
 * `false` when either is missing: an absent payout account is a different
 * problem, and claiming a mismatch we cannot demonstrate would teach the
 * reviewer to ignore the line.
 */
export function payoutIsSomebodyElses(input: {
  payoutAccount: string | null | undefined;
  applicantPhone: string | null | undefined;
}): boolean {
  if (!input.payoutAccount || !input.applicantPhone) return false;
  if (nationalDigits(input.payoutAccount).length === 0) return false;
  return !samePhone(input.payoutAccount, input.applicantPhone);
}
