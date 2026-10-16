import "server-only";

import { isFresh } from "@/lib/config/payout-policy";

import { getSessionProfile, type SessionProfile } from "./session";
import { mfaState, sessionAuthenticatedAt } from "./mfa";
import {
  stepUpBlocks,
  stepUpFor,
  STEP_UP_HOURS,
  type StepUpVerdict,
} from "./step-up";

/**
 * The one place that decides whether an admin surface opens.
 *
 * SHARED ON PURPOSE, AND THE OPPOSITE OF THE DUPLICATION THIS PROJECT WARNS
 * ABOUT. Six admin pages and eight admin actions each re-read
 * `profiles.role`; adding a second condition to all fourteen by hand is how
 * one of them ends up without it, and the one that ends up without it is the
 * hole. Every caller asks this instead.
 *
 * IT DOES NOT REDIRECT. A verdict is returned and the caller acts, because a
 * page and a server action have to answer differently: a page sends somebody
 * to a screen, an action returns a reason a form can render. A helper that
 * threw a redirect would be unusable from half its callers.
 */

export type AdminGate =
  | { ok: true; profile: SessionProfile }
  /** No session at all. The caller sends them to sign in. */
  | { ok: false; reason: "signedOut" }
  /** Signed in, not an admin. The caller answers 404, as it always has. */
  | { ok: false; reason: "notAdmin" }
  /** An admin who must set up or use a second factor first. */
  | {
      ok: false;
      reason: "stepUp";
      step: StepUpVerdict;
      profile: SessionProfile;
    };

/**
 * Role, then second factor, in that order.
 *
 * THE ORDER MATTERS FOR WHAT LEAKS. Asking about the factor first would tell a
 * signed-in customer that the admin screens exist and what guards them; a 404
 * tells them nothing, which is what `notFound()` has always been for here.
 *
 * THE MFA READ COSTS A ROUND TRIP AND ONLY ADMINS PAY IT. `getSessionProfile`
 * is `cache()`d per request, so the role is free by the time this runs; the
 * claims and factor list are only fetched once the role says admin.
 */
export async function adminGate(): Promise<AdminGate> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, reason: "signedOut" };
  if (profile.role !== "admin") return { ok: false, reason: "notAdmin" };

  const state = await mfaState();
  const step = stepUpFor({
    role: profile.role,
    hasFactor: state.hasFactor,
    verified: state.verified,
    verifiedAt: state.verifiedAt,
  });

  if (step === "ok" || step === "not-required") return { ok: true, profile };
  return { ok: false, reason: "stepUp", step, profile };
}

/**
 * The same decision for a server action, as a profile or null.
 *
 * An action has no screen to send anybody to, so every refusal collapses to
 * one answer: it did not happen. The distinction between "not an admin" and
 * "an admin whose code has expired" is a UI concern, and an action that leaked
 * it would be telling a caller which half of the gate they failed.
 */
export async function adminActor(): Promise<SessionProfile | null> {
  const gate = await adminGate();
  return gate.ok ? gate.profile : null;
}

/**
 * The same decision again, for an action that moves money.
 *
 * TWO WINDOWS, AND THE SPLIT IS THE WHOLE POINT. `adminActor()` carries
 * `STEP_UP_HOURS` — eight hours, because admin work is batched and a code every
 * half hour teaches somebody to tap through approvals, which is the failure
 * `lib/payments/pricing.ts` names. That is the right window for reading a queue,
 * answering a review or publishing a page. It is the wrong one for releasing
 * somebody's money: an unlocked phone left on a desk is inside an eight-hour
 * window all afternoon, and these actions each move real rupees in one tap.
 *
 * THIS WAS A HOLE AND IT WAS FOUND BY AUDIT RATHER THAN BY A FAILURE. Payouts
 * had the fifteen-minute proof from the day they shipped, threaded as
 * `reauthenticatedAt` into `lib/data/payouts.ts`; the refund, no-show,
 * trip-debt, appeal and survey-fee decisions did not, although
 * `sendRefundToGateway` initiates a real transfer and `issueRefund` decides how
 * much of a customer's money goes back. Six money-moving actions behind the
 * batched-work window, for no reason beyond their having been written on
 * different days.
 *
 * ONE HELPER RATHER THAN SIX CHECKS, for the reason `adminGate` already states:
 * adding a second condition to six actions by hand is how one of them ends up
 * without it, and the one without it is the hole. The alternative shape —
 * threading `reauthenticatedAt` into every data-layer writer, as payouts does —
 * is better where the data layer must refuse on its own (a cron, a second
 * caller), and worse here: five of these writers have exactly one caller, and
 * five more parameters is five more places to pass null.
 * `tests/unit/admin-money-reauth.test.ts` is what makes the rule hold, by
 * reading the sources rather than trusting this comment.
 *
 * THE TWO REFUSALS STAY SEPARATE, unlike `adminActor`'s. There the collapse is
 * deliberate — an action must not tell a caller which half of the gate they
 * failed. Here `reauthNeeded` is only ever returned to somebody who has already
 * passed the role check and the eight-hour step-up, so it discloses nothing
 * they did not already know, and a screen that cannot tell the two apart is a
 * screen that says "that did not save" to an admin who needs to type six
 * digits.
 */
export type FreshAdminActor =
  | { ok: true; profile: SessionProfile }
  | { ok: false; reason: "notAdmin" | "reauthNeeded" };

export async function freshAdminActor(): Promise<FreshAdminActor> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "notAdmin" };

  /* Read from the session's `amr` claim, never from the form: a field, a
     parameter or a cookie would all be the browser's to set. Deliberately not
     `iat`, which resets on every silent refresh — a gate reading that would
     mean "recently active", which is exactly what a stolen session is. */
  if (!isFresh(await sessionAuthenticatedAt())) {
    return { ok: false, reason: "reauthNeeded" };
  }

  return { ok: true, profile };
}

/**
 * What the security screen needs, in one answer.
 *
 * THE PAGE ASKS THIS RATHER THAN COMPOSING IT. `mfa.ts` and `step-up.ts` are
 * private to this module, and a screen that reached into both would be a
 * second place that decides what "needs a code" means — which is exactly how
 * a gate and the screen that satisfies it drift apart. Here the two are one
 * function, so they cannot.
 *
 * `needsCode` is deliberately false for somebody with no factor: they need the
 * enrolment half, not the challenge half, and a screen told to ask for a code
 * from an account that has none would be a dead end with no way out of it.
 */
export async function securityState(): Promise<{
  hasFactor: boolean;
  needsCode: boolean;
  stepUpHours: number;
  role: string | null;
}> {
  const profile = await getSessionProfile();
  if (!profile) {
    return {
      hasFactor: false,
      needsCode: false,
      stepUpHours: STEP_UP_HOURS,
      role: null,
    };
  }

  const state = await mfaState();
  const step = stepUpFor({
    role: profile.role,
    hasFactor: state.hasFactor,
    verified: state.verified,
    verifiedAt: state.verifiedAt,
  });

  return {
    hasFactor: state.hasFactor,
    needsCode: state.hasFactor && stepUpBlocks(step),
    stepUpHours: STEP_UP_HOURS,
    role: profile.role,
  };
}

/*
 * The enrolment surface, re-exported rather than reached for.
 *
 * `mfa.ts` is the adapter and stays private, the same way `lib/payments`
 * keeps its gateways behind `index.ts`: a caller that could import it
 * directly would be a second place that knows the second factor is TOTP, and
 * the whole point of the adapter is that swapping it is one file.
 */
export { accessTokenLifetimeSeconds, enrollTotp, verifyTotp } from "./mfa";
export type { EnrollResult, VerifyResult } from "./mfa";

/** The window itself, for anything that reports it rather than enforces it. */
export { afterSecurity, STEP_UP_HOURS } from "./step-up";
