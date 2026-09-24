/**
 * What a failed enrolment is allowed to say about itself.
 *
 * SEPARATE FROM `mfa.ts` BECAUSE THAT FILE IS `server-only`. This rule is
 * pure and has to be testable without a session, the same arrangement
 * `step-up.ts` has beside `admin-gate.ts` — and a pure function that cannot be
 * imported by a test is a pure function nobody checks.
 *
 * `enrollTotp` used to collapse every failure to one key, so the screen could
 * only ever say "That did not start. Try again." When it began failing in
 * production nobody could say why, which is the same shape as the day sign-in
 * broke: the product held the provider's message the whole time and printed
 * none of it.
 *
 * NEVER NULL, NEVER EMPTY. A blank badge on the screen that exists to explain
 * an error reads as "no error", which is the confusion this is here to remove
 * — `unknown` is never `ok`, one level down.
 */
export function describeEnrollError(error: unknown): string {
  if (!error || typeof error !== "object") return "no error returned";

  const { message, status } = error as { message?: unknown; status?: unknown };
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "no error returned";

  // The status is what tells a refusal apart from a gateway that never
  // answered, and it is the first thing worth knowing.
  return typeof status === "number" ? `${status} ${text}` : text;
}
