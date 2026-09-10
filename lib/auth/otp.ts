import "server-only";

import { createHash } from "node:crypto";

import { judgeSmsSend, smsBudgetAlert } from "@/lib/abuse";
import { recordSecurityEvent } from "@/lib/audit";
import { checkRateLimit, countGlobalSms } from "@/lib/server/rate-limit";
import { createClient } from "@/lib/supabase/server";

import type { OtpError, OtpOutcome, VerifyOutcome } from "./otp-contract";

/**
 * The only place the app talks to an SMS provider, and now the only place it
 * is allowed to be called from.
 *
 * IT USED TO RUN IN THE BROWSER. `"use client"` meant every OTP request went
 * from the visitor's phone straight to Supabase, so none of our rate limits
 * ran — the only thing between an attacker and a flood of paid SMS was the
 * provider's own defaults. That was the top finding of the Phase 9 audit and
 * this file is the fix: the send and the verify happen on our server, behind
 * limits we set and can see, and the browser reaches them through a server
 * action.
 *
 * THREE CEILINGS, and each answers a different attack:
 *
 *   otp:number   one phone number. Every send is an SMS we pay for, and a
 *                person who genuinely did not get the code needs two or three
 *                tries, not thirty. This is the bill.
 *   otp:ip       one network. Looser, because a family or an office is one
 *                IP and locking a building out of signing in is worse than
 *                the flood it prevents. This is the number-space walker.
 *   otp:attempt  wrong codes against one number. Ten an hour against a
 *                million possibilities is not a guessing attack any more.
 *                This is the brute force, and it is the one with a lockout.
 *
 * THE NUMBER IS NEVER THE KEY. Rate-limit keys are hashed, because they end up
 * in a third party's Redis and a list of keys would otherwise be a list of
 * every phone number that has tried to sign in.
 *
 * NO ANSWER REVEALS WHETHER A NUMBER IS REGISTERED. `signInWithOtp` creates
 * the user when there is none, so "send" behaves identically either way, and
 * every failure below returns the same shape whatever the reason. An attacker
 * cannot use this to build a list of our customers.
 *
 * Today this is Supabase Auth's built-in phone OTP, which gives us real JWT
 * sessions, expiry and rate limiting without hand-rolling any of it.
 *
 * Supabase's default SMS providers (Twilio, MessageBird, Vonage) have patchy
 * deliverability to NTC and Ncell. When we move to a Nepal-native gateway —
 * Sparrow SMS or Aakash SMS — that is a Supabase project setting plus, if we
 * end up sending ourselves, a new implementation of `sendOtp`/`verifyOtp`
 * behind these same two signatures. Nothing outside this file should know
 * which provider is in play, so keep provider types out of the exports.
 */

/**
 * A phone number, reduced to something safe to use as a counter key.
 *
 * The keys reach a third party's Redis. A list of them must not be a list of
 * every number that has tried to sign in to this product.
 */
function keyFor(e164: string): string {
  return createHash("sha256").update(e164).digest("hex").slice(0, 32);
}

export async function sendOtp(
  e164: string,
  context: { ip?: string | null } = {},
): Promise<OtpOutcome> {
  const numberKey = keyFor(e164);

  // Both ceilings are consumed, so somebody cannot spend the per-network
  // budget without also spending the number's.
  const [byNumber, byNetwork] = await Promise.all([
    checkRateLimit("otp:number", numberKey),
    checkRateLimit("otp:ip", context.ip ?? "unknown"),
  ]);

  if (!byNumber.ok || !byNetwork.ok) {
    const retryAfterSeconds = !byNumber.ok
      ? byNumber.retryAfterSeconds
      : (byNetwork as { retryAfterSeconds: number }).retryAfterSeconds;

    await recordSecurityEvent({
      kind: "auth.otpRequested",
      actorRole: "anonymous",
      subjectType: "profile",
      // The hash, not the number: this table is read by people too.
      subjectId: numberKey,
      detail: { refused: "rateLimited", scope: !byNumber.ok ? "number" : "ip" },
      requestIp: context.ip ?? null,
    });

    return { ok: false, error: "tooManyRequests", retryAfterSeconds };
  }

  /*
   * THE FOURTH CEILING, and the only one an attacker cannot spread around.
   *
   * The three above are all keyed by a caller, so a distributed attacker with
   * a thousand IPs asking for one code each to numbers they earn revenue on
   * sits comfortably inside every one of them. That is toll fraud, and the
   * first thing that notices it is the invoice. This one is keyed by nobody:
   * it counts what the whole platform has spent this hour and today, and it
   * refuses before the send rather than reporting after it.
   *
   * Counted here, immediately before the message, so nothing between the
   * check and the send can slip past it. See `lib/abuse/sms-budget.ts` for the
   * numbers and the arithmetic behind them.
   */
  const spend = await countGlobalSms();
  const budget = judgeSmsSend({
    e164,
    globalLastHour: spend.lastHour,
    globalToday: spend.today,
  });

  if (!budget.ok) {
    await recordSecurityEvent({
      kind: "auth.otpRequested",
      actorRole: "anonymous",
      subjectType: "profile",
      subjectId: numberKey,
      detail: {
        refused: budget.reason,
        detail: budget.detail,
        // Whether the count is platform-wide or only this instance's. A
        // per-instance count of a platform ceiling is barely a count at all,
        // and that has to be visible rather than assumed.
        shared: spend.shared,
      },
      requestIp: context.ip ?? null,
    });

    /*
     * FAILS CLOSED, unlike the per-caller limits, and deliberately.
     *
     * Those fail open because locking every customer out over a third party's
     * bad minute trades a certain outage for a possible abuse. This is not a
     * bad minute: hitting a platform ceiling means either we have outgrown our
     * own numbers, which is one edit in SMS_BUDGET, or something is wrong.
     * Both want a person now, and neither wants the messages to keep going.
     */
    return { ok: false, error: "tooManyRequests", retryAfterSeconds: 600 };
  }

  const alert = smsBudgetAlert({
    globalLastHour: spend.lastHour,
    globalToday: spend.today,
  });
  if (alert) {
    // A ceiling hit silently is an outage nobody has been told about. This is
    // the line that arrives before the bill does.
    console.warn(
      `[sms-budget] ${alert.level}: ${alert.sent} of ${alert.limit} this ${alert.window}, about Rs ${alert.estimatedRupees}.`,
    );
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });

  await recordSecurityEvent({
    kind: "auth.otpRequested",
    actorRole: "anonymous",
    subjectType: "profile",
    subjectId: numberKey,
    detail: { sent: !error },
    requestIp: context.ip ?? null,
  });

  if (!error) return { ok: true };

  // Supabase surfaces its rate limit as a 429 with the wait time in the text.
  const detail = `${error.status ?? "?"}: ${error.message}`;

  if (error.status === 429) {
    const seconds = Number(error.message.match(/(\d+)\s*second/)?.[1]);
    return {
      ok: false,
      error: "tooManyRequests",
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : 60,
      detail,
    };
  }

  return { ok: false, error: classifyError(error.message), detail };
}

export async function verifyOtp(
  e164: string,
  token: string,
  context: { ip?: string | null } = {},
): Promise<VerifyOutcome> {
  const numberKey = keyFor(e164);

  /*
   * THE LOCKOUT, and it is the one ceiling that has to bite hard.
   *
   * A six-digit code has a million possibilities and Supabase's are valid for
   * minutes. Unlimited guesses against one number is the only actually
   * dangerous attack in this flow, and it is cheap: no SMS is sent, so nothing
   * else in the system notices. Ten an hour makes it arithmetic rather than a
   * strategy.
   *
   * Consumed BEFORE the attempt rather than only on failure, so an attacker
   * cannot spend the budget on guesses that happen to be right.
   */
  const attempt = await checkRateLimit("otp:attempt", numberKey);
  if (!attempt.ok) {
    await recordSecurityEvent({
      kind: "auth.otpFailed",
      actorRole: "anonymous",
      subjectType: "profile",
      subjectId: numberKey,
      detail: { refused: "lockedOut" },
      requestIp: context.ip ?? null,
    });
    return { ok: false, error: "tooManyRequests" };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: e164,
    token,
    type: "sms",
  });

  if (error) {
    await recordSecurityEvent({
      kind: "auth.otpFailed",
      actorRole: "anonymous",
      subjectType: "profile",
      subjectId: numberKey,
      detail: { reason: classifyError(error.message) },
      requestIp: context.ip ?? null,
    });
    return {
      ok: false,
      error: classifyError(error.message),
      detail: `${error.status ?? "?"}: ${error.message}`,
    };
  }

  const user = data.user;
  if (!user) {
    return { ok: false, error: "requestNewCode" };
  }

  await recordSecurityEvent({
    kind: "auth.signedIn",
    actorId: user.id,
    actorRole: "customer",
    subjectType: "profile",
    subjectId: user.id,
    requestIp: context.ip ?? null,
  });

  // A profile row exists from the signup trigger; `full_name` is what
  // onboarding fills in, so an empty one means we have not met this person yet.
  const supabase2 = createClient();
  const { data: profile } = await supabase2
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return { ok: true, isNewUser: !profile?.full_name };
}

/** Provider wording is for us, not for someone standing in a wet kitchen. */
function classifyError(message: string): OtpError {
  const m = message.toLowerCase();
  // Supabase returns one message — "Token has expired or is invalid" — for
  // both a mistyped code and a stale one, so picking either word is a coin
  // flip that sends people down the wrong path. Cover both, briefly.
  if (m.includes("expired") && m.includes("invalid")) {
    return "codeExpiredOrInvalid";
  }
  if (m.includes("expired")) {
    return "codeExpired";
  }
  if (m.includes("invalid") || m.includes("token")) {
    return "codeInvalid";
  }
  if (m.includes("sms") || m.includes("provider") || m.includes("send")) {
    return "smsFailed";
  }
  return "generic";
}
