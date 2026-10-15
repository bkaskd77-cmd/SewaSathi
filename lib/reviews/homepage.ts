/**
 * Which published reviews may appear on the front page, and why one may not.
 *
 * THE HOMEPAGE IS A CHOSEN SURFACE AND THE LISTING IS NOT. Every published
 * review stays on the professional's page for ever, whatever it says — that is
 * `countsTowardAverage`'s rule and nothing here touches it. This decides what
 * goes on the one page that is read by strangers, indexed, and understood as
 * what we are claiming about ourselves. `lib/mock/activityFeed.ts` held that
 * slot with invented customers; the strip replaced it with real finished jobs,
 * and this is the same move for what people actually said.
 *
 * FOUR REASONS A REVIEW IS NOT THERE, and only one of them is a person's
 * decision:
 *
 *   1. **Not published.** Sealed is the author's alone — `sealed()` is the rule
 *      and this never second-guesses it.
 *   2. **The customer opted out of the activity strip.** One switch on
 *      `/account` covers both surfaces. Somebody who said "do not put my
 *      finished jobs on your homepage" did not mean "but my words are fine":
 *      the review carries their first name and their city, which is strictly
 *      more than the strip does.
 *   3. **It has no words.** A star with no sentence is a rating, not testimony,
 *      and `submitReview` accepts an empty comment on purpose — rating without
 *      writing is a real thing a customer may do. The wall quotes people, so
 *      there has to be something to quote. Found by reading the live row: the
 *      one published review in production is a 5 with an empty comment, and
 *      every test in the suite had given its fixtures words.
 *   4. **The text carries a phone number, an email address or a link.**
 *      Derived, never stored — see `lib/text/contacts.ts`.
 *   5. **A person hid it**, with a code and a sentence, audited.
 *
 * THERE IS NO SIXTH, AND IN PARTICULAR THERE IS NO RATING FILTER. Nothing in
 * this module reads `rating`, so a one-star review is exactly as eligible as a
 * five-star one and the wall is whatever the last few customers said. That is
 * the structural half of "never hidden for being negative": the mechanism
 * cannot express it. A floor on stars would turn the wall into a claim nobody
 * made — and it would be the `0.0` bug in reverse, a surface showing evidence
 * selected to agree with itself.
 *
 * Pure and dependency-free, like `rules.ts` beside it: the data layer, the
 * admin screen and the tests all ask the same questions.
 */

import { contactKinds, type ContactKind } from "@/lib/text";

import { hasWords } from "./rules";

/**
 * How many eligible reviews before the wall appears at all.
 *
 * EIGHT, THE SAME AS `ACTIVITY_FLOOR`, and borrowed rather than invented for
 * the reason that constant already states: one entry reads as "this is all that
 * has ever happened here", which is worse than silence. A wall of two reviews
 * is a smaller claim about nothing, not a humbler version of a wall of twelve.
 *
 * SEPARATE CONSTANT, NOT AN IMPORT OF THAT ONE. `ACTIVITY_FLOOR` is in
 * `lib/config/platform.ts` and this is a different question about a different
 * kind of evidence — tying them would mean a change to the strip's floor
 * silently moved the review wall's. The number is the same today and the
 * reasoning is written down twice on purpose.
 */
export const HOMEPAGE_REVIEW_FLOOR = 8;

/** Never more than this on screen, however many are eligible. */
export const HOMEPAGE_REVIEW_MAX = 6;

/**
 * Why a person took a review off the homepage.
 *
 * TWO CODES, AND THE SET IS THE POINT. Neither of them can mean "it was
 * negative", and no third is coming that could — `price`, `unfair`, `disputed`
 * and `low` are all refused for the same reason `CUSTOMER_FLAGS` refuses a
 * "wanted a discount" flag: a list that cannot express retaliation is a
 * stronger guarantee than a policy saying nobody will. `tests/unit/
 * homepage-reviews.test.ts` asserts there never is one.
 *
 * A CODE BESIDE THE SENTENCE, not instead of it. The sentence is what a person
 * reads back in six months; the code is what makes "how often is this used and
 * for what" answerable at all — `booking_refusals.reason_code`'s lesson, where
 * prose alone could not be counted. Both are required here, which is the
 * opposite of that column: there, skipping was allowed because forcing a choice
 * would push everybody onto `other`; here there is no `other` and the action is
 * a staff decision about somebody's published words, so it is not skippable.
 */
export const HOMEPAGE_HIDE_CODES = [
  /** Abuse, threats, or somebody else's private details. */
  "abusive",
  /** Not about the work — a test, an unrelated complaint, or nothing at all. */
  "irrelevant",
] as const;

export type HomepageHideCode = (typeof HOMEPAGE_HIDE_CODES)[number];

export function isHomepageHideCode(value: string): value is HomepageHideCode {
  return (HOMEPAGE_HIDE_CODES as readonly string[]).includes(value);
}

/** What the rule is asked about. Deliberately NOT the rating. */
export type HomepageCandidate = {
  publishedAt: string | null;
  comment: string;
  /** `profiles.hide_from_activity` on the review's own customer. */
  authorOptedOut: boolean;
  /** `provider_reviews.homepage_hidden_at`. */
  hiddenAt: string | null;
};

export type HomepageRefusal =
  | "notPublished"
  | "authorOptedOut"
  | "noWords"
  | "hiddenByStaff"
  | ContactKind;

export type HomepageVerdict =
  | { shows: true }
  | { shows: false; why: HomepageRefusal };

/**
 * May this review go on the front page?
 *
 * THE ORDER IS THE ANSWER SOMEBODY READS, so it runs cheapest-truth first:
 * sealed before anything (there is nothing to discuss about a review that is
 * not public yet), the opt-out before the text (a customer's choice outranks
 * our judgement of their words), then the derived contact rule, then the staff
 * decision LAST — because a review hidden by a person who could have left it
 * alone is the one fact worth reporting on the admin screen, and reporting
 * "contains a phone number" about a review somebody deliberately hid would hide
 * the decision behind an accident.
 */
export function showsOnHomepage(review: HomepageCandidate): HomepageVerdict {
  if (!review.publishedAt) return { shows: false, why: "notPublished" };
  if (review.authorOptedOut) return { shows: false, why: "authorOptedOut" };

  /*
   * EMPTY AFTER TRIMMING, AND DELIBERATELY NO LENGTH BAR. "Good work" is nine
   * characters and adds little to a wall, and excluding it would be us
   * editorialising about whose words are good enough — which is the same
   * posture as the star filter this module refuses to have. The rule is only
   * that there is something to quote; a review with nothing in it would render
   * as an empty pair of quotation marks, which is the invented-content failure
   * one door along from `lib/mock/`.
   *
   * AND THAT LAST SENTENCE WAS A PREDICTION THAT CAME TRUE ONE SCREEN OVER:
   * `/admin/reviews` quoted the comment unconditionally and printed `“”` for
   * exactly these reviews. `hasWords` is why all three surfaces now ask one
   * question — this one, the public listing, and the staff screen that has to
   * tell the first two apart.
   */
  if (!hasWords(review.comment)) {
    return { shows: false, why: "noWords" };
  }

  const [contact] = contactKinds(review.comment);
  if (contact) return { shows: false, why: contact };

  if (review.hiddenAt) return { shows: false, why: "hiddenByStaff" };

  return { shows: true };
}
