/**
 * Which health states take the endpoint down, and what a fired fallback means.
 *
 * WHY THIS IS A FILE AND NOT THREE LINES INSIDE THE ROUTE. `/api/health` is the
 * one URL that answers "can this serve a customer right now", and it had **no
 * test of any kind** — so the rule deciding 200 against 503 had never been
 * asserted, only read. It was wrong, and it was wrong in the direction that
 * pages somebody at 3am about a product that is working perfectly.
 *
 * Pure and dependency-free so it can be tested without a network, a database or
 * a running Next. Same reason `lib/provider/measured.ts` and
 * `lib/config/exposure.ts` sit outside the modules that use them: a judgement
 * living inside a `server-only` route handler is a judgement nothing can check.
 */

export type HealthState = "ok" | "down" | "unknown" | "skipped";

export type HealthCheck = {
  name: string;
  state: HealthState;
  detail: string;
};

/**
 * Does the product serve a customer right now?
 *
 * **`unknown` counts as a failure, and that is deliberate.** Sign-in was broken
 * for a day because a dependency in somebody else's dashboard was never
 * verified, and a check that cannot see its subject must not read as working.
 * So an unverifiable *configuration* dependency takes the endpoint to 503, on
 * purpose.
 *
 * The corollary is the part that was missed: **a state must only be `unknown`
 * or `down` when a customer is actually affected.** Everything else belongs in
 * a detail line on an `ok`. `checkTriage` had already written that down —
 * "`ok` is computed across every check to decide 200 or 503, so `unknown` would
 * 503 a working product" — and `checkTriageFallback`, three hundred lines
 * lower in the same file, chose `unknown` while its comment claimed the choice
 * avoided exactly that.
 */
export function servesCustomers(
  checks: readonly Pick<HealthCheck, "state">[],
): boolean {
  return checks.every(
    (check) => check.state === "ok" || check.state === "skipped",
  );
}

/**
 * The state for `triage.fallback` when triages ARE falling back on a live key.
 *
 * THE BUG THIS CONSTANT IS. It was `unknown`, under a comment reading "`unknown`
 * rather than `down` when it fires — the product answered every one of those
 * people, which is the whole design, so nothing is broken for a customer and a
 * 503 would be a lie." Every word of the reasoning is right and the state does
 * not deliver it: `servesCustomers` treats `unknown` and `down` identically, so
 * the 503 the comment refused was served anyway.
 *
 * It fired in production. A key was set, four triages in an hour were answered
 * by the keyword matcher, and `/api/health` returned 503 — while every one of
 * those four customers got an answer, which is what the fallback is FOR. Any
 * uptime monitor pointed at that URL would have paged for a working product,
 * and the next person to trust a 503 from it would have been right not to.
 *
 * `ok` with the rate named in the detail is the resolution the sibling checks
 * already use: `sms.gateway` and `triage.model` both report `ok` and say in
 * their own words what is unproven and which call would prove it. A number
 * nobody can act on is not an outage; it is a number, and it belongs beside
 * the others.
 */
export const FALLBACK_FIRING_STATE: HealthState = "ok";

/**
 * A read that FAILED is a different thing from a read that found fallbacks.
 *
 * Not being able to read the triage log is genuinely unverifiable — the
 * original meaning of `unknown` — so it keeps it and keeps its 503. The
 * distinction is the whole rule: not looking must never read as working, and
 * looking and finding something harmless must never read as broken.
 */
export const FALLBACK_UNREADABLE_STATE: HealthState = "unknown";
