/**
 * The ceiling on what an SMS attack can cost us before it stops.
 *
 * WHAT THE PER-NUMBER AND PER-IP LIMITS DO NOT COVER. `lib/server/rate-limit.ts`
 * caps one number at 3 a minute and one network at 10, which stops a person
 * hammering the login form. It does nothing against the attack that actually
 * costs money: a distributed attacker with a thousand IPs requesting one code
 * each to numbers they earn revenue on. Every one of those requests is inside
 * every limit we have, and the first thing that notices is the invoice.
 *
 * This is called International Revenue Share Fraud, and the defence is not a
 * tighter per-user limit — it is a ceiling on the whole platform's spending,
 * enforced before the message is sent and visible before the bill arrives.
 *
 * THREE CONTROLS, and the first is by far the strongest:
 *
 *   1. WE ONLY EVER DIAL A NEPALI MOBILE. `checkNepaliMobile` already refuses
 *      anything that is not +977 and ten digits beginning 97 or 98, which
 *      removes the entire international premium-rate surface — you cannot earn
 *      revenue share on a number we will not call. It is re-checked here
 *      rather than trusted, because this is the last gate before money is
 *      spent and a single caller skipping validation would be enough.
 *   2. A GLOBAL VELOCITY CEILING. Not per number, per platform. It is the only
 *      limit a distributed attacker cannot spread their way around.
 *   3. A COST ALERT BEFORE THE CEILING. A ceiling that is hit silently is an
 *      outage nobody has been told about — every customer trying to sign in
 *      hits a wall while the team finds out from a dashboard they are not
 *      looking at.
 *
 * FAILING CLOSED HERE IS DELIBERATE and is the opposite of the rate limiter's
 * choice. The rate limiter fails OPEN because locking everybody out over a
 * third party's bad minute trades a certain outage for a possible abuse. This
 * ceiling is not about a bad minute: reaching it means either the platform has
 * grown past its own numbers, which is a good problem answered by editing one
 * object here, or something is wrong. Both want a person, now.
 *
 * Pure so the thresholds can be argued about as numbers.
 */

import { checkNepaliMobile } from "@/lib/auth";

/**
 * The numbers, and the arithmetic behind each.
 *
 * SIZED FOR LAUNCH, NOT FOR HOPE. A few hundred users, perhaps a tenth signing
 * in on a given day, about 1.2 sends each because some people mistype: call it
 * thirty sends in the busiest hour. Three hundred is ten times that, which is
 * headroom for a launch week going far better than expected and still nowhere
 * near a bill worth worrying about.
 *
 * The daily figure is the one that bounds the damage. Two thousand messages at
 * roughly Rs 2 each is about Rs 4,000 — the most a sustained attack can cost
 * before it is stopped dead. Revisit both when real traffic exists; they are
 * here as one object so that is an edit rather than an archaeology exercise.
 */
export const SMS_BUDGET = {
  /** Platform-wide sends in a rolling hour. */
  perHourGlobal: 300,
  /** Platform-wide sends in a rolling day. This is the one that bounds the bill. */
  perDayGlobal: 2000,
  /** Rs per message, for the alert's arithmetic. An estimate, not an invoice. */
  rupeesPerMessage: 2,
  /**
   * Warn at these fractions of each ceiling.
   *
   * Half a day's budget is early enough that somebody can look before anything
   * breaks; four fifths of an hour's is late enough not to cry wolf on a busy
   * morning.
   */
  alertAtDayFraction: 0.5,
  alertAtHourFraction: 0.8,
} as const;

export type SmsSendVerdict =
  | { ok: true }
  | {
      ok: false;
      /**
       * `prefix`      — not a Nepali mobile. Never billable, never sent.
       * `hourCeiling` — the platform's hourly ceiling.
       * `dayCeiling`  — the platform's daily ceiling.
       */
      reason: "prefix" | "hourCeiling" | "dayCeiling";
      detail: string;
    };

/**
 * May this message be sent at all?
 *
 * `globalLastHour` and `globalToday` are counts across the whole platform, not
 * for one caller — that is the entire point. They come from the shared store
 * (`lib/server/rate-limit.ts`), because a per-instance counter would give a
 * distributed attacker one ceiling per serverless instance.
 */
export function judgeSmsSend(input: {
  e164: string;
  globalLastHour: number;
  globalToday: number;
}): SmsSendVerdict {
  const phone = checkNepaliMobile(input.e164);
  if (!phone.ok) {
    return {
      ok: false,
      reason: "prefix",
      detail:
        "Not a Nepali mobile number. We never send to any other destination, which is what removes the international premium-rate surface entirely.",
    };
  }

  if (input.globalToday >= SMS_BUDGET.perDayGlobal) {
    return {
      ok: false,
      reason: "dayCeiling",
      detail: `The platform has sent ${input.globalToday} messages today, at the ceiling of ${SMS_BUDGET.perDayGlobal}.`,
    };
  }

  if (input.globalLastHour >= SMS_BUDGET.perHourGlobal) {
    return {
      ok: false,
      reason: "hourCeiling",
      detail: `The platform has sent ${input.globalLastHour} messages in the last hour, at the ceiling of ${SMS_BUDGET.perHourGlobal}.`,
    };
  }

  return { ok: true };
}

export type SmsAlert = {
  level: "warn" | "ceiling";
  window: "hour" | "day";
  sent: number;
  limit: number;
  /** Rough spend so far in this window, in rupees. */
  estimatedRupees: number;
};

/**
 * Should somebody be told, and how loudly?
 *
 * Returns the most serious alert or null. Deliberately separate from
 * `judgeSmsSend` so the check that decides whether to send has no reason to
 * ever be skipped for being noisy, and so the alert can be raised from the
 * health endpoint as well as from the send path.
 */
export function smsBudgetAlert(input: {
  globalLastHour: number;
  globalToday: number;
}): SmsAlert | null {
  const rupees = (count: number) => count * SMS_BUDGET.rupeesPerMessage;

  if (input.globalToday >= SMS_BUDGET.perDayGlobal) {
    return {
      level: "ceiling",
      window: "day",
      sent: input.globalToday,
      limit: SMS_BUDGET.perDayGlobal,
      estimatedRupees: rupees(input.globalToday),
    };
  }
  if (input.globalLastHour >= SMS_BUDGET.perHourGlobal) {
    return {
      level: "ceiling",
      window: "hour",
      sent: input.globalLastHour,
      limit: SMS_BUDGET.perHourGlobal,
      estimatedRupees: rupees(input.globalLastHour),
    };
  }
  if (
    input.globalToday >=
    SMS_BUDGET.perDayGlobal * SMS_BUDGET.alertAtDayFraction
  ) {
    return {
      level: "warn",
      window: "day",
      sent: input.globalToday,
      limit: SMS_BUDGET.perDayGlobal,
      estimatedRupees: rupees(input.globalToday),
    };
  }
  if (
    input.globalLastHour >=
    SMS_BUDGET.perHourGlobal * SMS_BUDGET.alertAtHourFraction
  ) {
    return {
      level: "warn",
      window: "hour",
      sent: input.globalLastHour,
      limit: SMS_BUDGET.perHourGlobal,
      estimatedRupees: rupees(input.globalLastHour),
    };
  }
  return null;
}
