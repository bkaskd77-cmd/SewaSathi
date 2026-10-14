/**
 * Does this text carry a way to reach somebody off SajiloKaam?
 *
 * WHY IT EXISTS. A published review is testimony and stays on the professional's
 * page whatever it says — that is `countsTowardAverage`'s rule and it does not
 * move. The HOMEPAGE is a different surface: it is chosen, it is read by
 * strangers and search engines, and a customer who wrote "call me on 98…" at the
 * end of a glowing review did not consent to that number being published on the
 * front page of a marketplace. Neither did the professional whose number a
 * customer helpfully included.
 *
 * SO IT HIDES RATHER THAN REDACTS. A review with a number in it is simply not
 * eligible for the homepage; the text is never rewritten. Redaction would mean
 * publishing an altered version of somebody's words under their first name,
 * which is worse than publishing nothing — and a star-rating testimonial with a
 * hole in the middle reads as censorship of the review rather than of the digits.
 *
 * IT ERRS TOWARD HIDING, AND THE TWO ERRORS ARE NOT SYMMETRIC. A false negative
 * puts a real phone number on a public page; a false positive costs one
 * testimonial out of a wall that needs eight before it renders at all, and the
 * review still appears on the listing. So where a rule has to choose — a date
 * written `12 10 2026` reads as a seven-digit run — it chooses to hide.
 *
 * DEVANAGARI DIGITS COUNT, which `\d` does not match. `९८४१२३४५६७` is a Nepali
 * mobile number typed by somebody using their own keyboard layout, and a rule
 * written in ASCII would have been blind to exactly the readers this product
 * says are a first-class path. Same lesson as `foldNepali`, one character class
 * over: the input is normalised so the rule does not have to be authored twice.
 *
 * Pure, dependency-free and isomorphic — the review form will warn the author
 * before they submit, and that runs in the browser.
 */

/** `०१२३४५६७८९` → `0123456789`. Nothing else is touched. */
export function foldDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) =>
    String(d.charCodeAt(0) - 0x0966),
  );
}

/**
 * A run of seven or more digits, separated by what a person puts in a phone
 * number and nothing else.
 *
 * SEVEN, because the shortest thing worth hiding is a Kathmandu landline
 * (`4123456`). A Nepali mobile is ten.
 *
 * THE SEPARATOR LIST IS THE WHOLE PRECISION OF THIS RULE. Space, hyphen, dot,
 * and the brackets around a dialling code — all of which appear inside written
 * numbers. A COMMA AND A SLASH ARE NOT SEPARATORS, deliberately: `Rs 1,500 and
 * Rs 2,000` and `12/10/2026` would otherwise both read as long digit runs, and
 * those are the two things customers write about most.
 */
const PHONE = /\d(?:[\s.\-()+]{0,2}\d){6,}/;

/** An address, in the only shape that is unambiguous in prose. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * A link, and a bare domain only where the suffix is one people actually use.
 *
 * NOT `\w+\.[a-z]{2,}`, which was the first version and flags ordinary prose:
 * somebody who writes "he fixed the tap.Thanks" with no space has not published
 * a website. The suffix list is what makes a bare domain safe to flag, and a
 * scheme or a `www.` needs no list at all because nothing else is written that
 * way.
 */
const LINK =
  /(?:https?:\/\/|www\.)\S+|[A-Za-z0-9-]{2,}\.(?:com|net|org|np|io|co|me|info|biz|xyz|app|in|uk|edu|gov)\b/i;

export type ContactKind = "phone" | "email" | "link";

/**
 * Which of the three it carries, in a fixed order, or an empty list.
 *
 * THE KINDS ARE RETURNED RATHER THAN A BOOLEAN so the admin screen can say WHY
 * a review is not on the homepage. A review that is silently absent and one
 * that was hidden by a person must not look alike — `proposalSuppressedBy`'s
 * rule, and here the absence has no row behind it at all, so the reason has to
 * be derivable or it does not exist.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH, so the next reader does not assume it
 * does: a social handle (`@ram`), because a bare `@word` is ordinary in prose
 * and flagging it would hide real reviews; a number written in words; and a
 * domain under a suffix not in the list above. Widening any of those is a
 * judgement about false positives, not a bug fix.
 */
export function contactKinds(text: string): ContactKind[] {
  const folded = foldDigits(text);
  const found: ContactKind[] = [];

  if (PHONE.test(folded)) found.push("phone");
  if (EMAIL.test(folded)) found.push("email");
  if (LINK.test(folded)) found.push("link");

  return found;
}

/** Shorthand for the one question most callers have. */
export function containsContactDetails(text: string): boolean {
  return contactKinds(text).length > 0;
}
