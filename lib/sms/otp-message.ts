/**
 * The sign-in code message: the one SMS every customer and professional gets.
 *
 * WHAT IT HAS TO DO, IN ORDER OF COST.
 *
 *   ONE CREDIT. Any Devanagari character switches the whole message to UCS-2,
 *   where a single SMS is 70 characters and anything longer is billed as
 *   several. Aakash's quote states it outright — "Nepali: 1 SMS Credit = 70
 *   characters" — and it is the same rule on every Nepali gateway. A warning
 *   added carelessly doubles the cost of every sign-in for ever, so
 *   `tests/unit/otp-message.test.ts` fails on any version over 70 at the
 *   longest code Supabase can issue.
 *
 *   THE CODE FIRST. A lock-screen preview shows the start of the message, and
 *   phones that offer to fill a code read it from there.
 *
 *   OUR NAME. On a shared sender the SENDER FIELD is the gateway's, not ours,
 *   so the body is the only place the customer can see who sent it. That is a
 *   label rather than proof — anybody can type it — which is the point of the
 *   next line.
 *
 *   NEVER SHARE IT, IN BOTH LANGUAGES. The common OTP scam is not a forged
 *   message; it is somebody phoning and asking the customer to read a real
 *   code aloud. The warning is the defence, and it is in both languages
 *   because the person being phoned may read only one of them.
 *
 * THE NEPALI REPEAT OF THE CODE WAS DROPPED TO MAKE ROOM. The previous message
 * (`… सजिलो काम कोड: 123456`) was 53 characters; adding the Nepali warning to
 * it reached 71 — one over, two credits each. Digits read the same in both
 * scripts, so the code is said once and the room goes to the warning.
 *
 * WRITTEN IN CODE RATHER THAN THE CATALOGUE because it is ONE bilingual message
 * rather than two translations — Supabase's hook gives us no locale, and
 * somebody signing in on a borrowed phone gets both. It is listed in
 * `scripts/ne-review-scope.mjs` as a document so the Nepali still reaches the
 * native read that blocks a launch.
 */
export function otpMessage(otp: string): string {
  return `${otp} is your SajiloKaam code. Never share it. कसैलाई नदिनुहोस्।`;
}
