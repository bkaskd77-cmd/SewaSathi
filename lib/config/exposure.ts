/**
 * How work is spread across professionals — the pure judgements.
 *
 * WHY THIS IS NOT IN `lib/data/concentration.ts`. That module is `server-only`
 * because it reads bookings, and a pure function written inside it is a
 * function no unit test can reach. That has now happened FOUR times in this
 * product — `claimRateWorthReading`, the triage classifications, `middleOf`,
 * and this — and every time the fix was the move rather than a mock. The
 * precedent is `lib/config/guarantee.ts` beside `lib/data/claim-signals.ts`:
 * the rule lives where it can be tested, the read lives where it can reach the
 * database.
 *
 * It will grow. When rotation among near-ties is decided, the margin it needs
 * is a constant that belongs here — argued about as a number, beside the
 * function that reads the concentration it responds to.
 */

/**
 * The top professional's share of something, as a percentage, or null when
 * there is nothing to take a share of.
 *
 * NULL RATHER THAN ZERO, AND RATHER THAN 100. A category nobody has booked is
 * not 0% concentrated — it is unread, and printing 0% reads as the good news
 * this measurement exists to question. Rule 6 in its usual shape: with no
 * evidence, say so rather than reporting the flattering end of the scale.
 *
 * ONE OUT OF ONE STILL RETURNS 100, deliberately. Refusing to would be a
 * threshold — a claim about how many bookings make a reading worth having — and
 * nobody has the rows to make that claim. The denominator travels beside the
 * figure everywhere it is shown, so a reader can see it rests on one booking.
 */
export function topShare(top: number, total: number): number | null {
  if (total <= 0) return null;
  return (top / total) * 100;
}
