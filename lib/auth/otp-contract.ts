/**
 * What an OTP attempt can come back as, and the one rule a screen needs.
 *
 * ISOMORPHIC ON PURPOSE. The sender moved to the server in Phase 9 — the
 * browser used to call Supabase directly, which meant our own rate limits
 * never ran and only the provider's defaults stood between an attacker and a
 * flood of paid SMS. But the login form still has to render the outcome, so
 * the *shape* of an outcome and the judgement about it live here, where both
 * sides can import them, and the sending lives in `otp.ts`, which is now
 * server-only.
 *
 * Nothing in this file talks to anything. That is what makes it safe on both
 * sides.
 */

/**
 * `error` is a key into `auth.errors`, never a sentence.
 *
 * Provider wording is for us, not for someone standing in a wet kitchen — and
 * it is only ever written in English. Mapping to a key is what lets the form
 * show the same message in Nepali without any of this knowing a locale exists.
 */
export type OtpError =
  | "tooManyRequests"
  | "codeExpiredOrInvalid"
  | "codeExpired"
  | "codeInvalid"
  | "smsFailed"
  | "requestNewCode"
  | "generic";

export type OtpOutcome =
  | { ok: true }
  | {
      ok: false;
      error: OtpError;
      retryAfterSeconds?: number;
      /**
       * The provider's own wording, verbatim.
       *
       * Never shown to a customer — `error` is what the form renders. It is
       * carried so the dev badge can print it, because the alternative is
       * asking somebody to read a network response in DevTools on a phone.
       */
      detail?: string;
    };

/** Verification additionally reports whether this is a brand-new account. */
export type VerifyOutcome =
  | {
      ok: true;
      isNewUser: boolean;
      /**
       * Does this account have work waiting on the other side of the product?
       *
       * Read from `profiles.role` by the server action AFTER the session
       * exists, never by this module — `otp.ts` talks to an SMS gateway and
       * nothing else. It only chooses where somebody lands when they asked for
       * nowhere in particular: an explicit `?next=` always wins, so a
       * professional who tapped "book" and then signed in still arrives at
       * their own booking.
       *
       * Optional because the send path has no session to read it from.
       */
      worksHere?: boolean;
    }
  | { ok: false; error: OtpError; detail?: string };

/**
 * Is this failure ours, and unfixable by the person in front of us?
 *
 * The difference decides whether the login screen offers a phone number.
 * Telling somebody to ring support when they have simply mistyped a digit is
 * worse than useless — it teaches them the product is broken when it is not.
 * Telling them nothing when the gateway is genuinely down is worse still: for
 * a plumbing emergency at nine at night, a dead login is the whole business
 * failing, and that is exactly what happened in production.
 *
 * `tooManyRequests` is deliberately absent. It resolves on its own, and the
 * form already says how long to wait.
 */
export function strandsCustomer(error: OtpError): boolean {
  return error === "smsFailed" || error === "generic";
}
