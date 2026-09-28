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

/*
 * From the module's public entry, which the linter insisted on and which is the
 * right import anyway: `@/lib/auth` is the ISOMORPHIC surface — route rules and
 * phone formatting, deliberately free of `server-only`, because merging it with
 * `session` would pull server code into the client bundle. So this file stays
 * as dependency-free as its header promises.
 */
import { checkNepaliMobile } from "@/lib/auth";

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

/**
 * The number the SMS probe should actually send, or why it cannot.
 *
 * `checkSmsDelivery` used to pass `SMS_HEALTH_NUMBER` to Supabase exactly as
 * typed. Every real sign-in does not: it goes through `checkNepaliMobile`, which
 * returns `+977XXXXXXXXXX`, and `sendOtp` sends that. So unless the variable
 * happened to be written in that one form, the probe was sending a string the
 * product never sends — testing a path nobody uses, on the one check that
 * exists to prove the path everybody uses.
 *
 * **AND THE FAILURE POINTED AT THE WRONG DEPENDENCY.** A misformatted variable
 * came back as `auth.sms: down` carrying the provider's complaint, which reads
 * as "the gateway is broken" when the truth is a typo in Vercel. That is the
 * sign-in outage's exact shape with the blame inverted, on the endpoint built to
 * stop people looking in the wrong place.
 *
 * **UNPARSEABLE IS `skipped`, NEVER `down`.** `servesCustomers` turns everything
 * but `ok` and `skipped` into a 503, and a number we cannot read means we did not
 * look — no customer is affected by that. `checkTriageFallback` made this exact
 * mistake once: right reasoning, wrong state, a working product paged.
 *
 * It reuses `checkNepaliMobile` rather than restating the rule. A second phone
 * validator is the one-list-written-twice shape this repository has already paid
 * for in `CRON_JOBS` and `LOGGABLE_REASONS`.
 */
export type SmsProbeTarget =
  | { ok: true; e164: string }
  | { ok: false; reason: string };

export function smsProbeTarget(raw: string | undefined): SmsProbeTarget {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: false, reason: "unset" };

  const check = checkNepaliMobile(trimmed);
  if (!check.ok) return { ok: false, reason: check.reason };

  return { ok: true, e164: check.e164 };
}
