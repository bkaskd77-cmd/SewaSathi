"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * The only place the app talks to an SMS provider.
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
 * `error` is a key into `auth.errors`, never a sentence.
 *
 * Provider wording is for us, not for someone standing in a wet kitchen — and
 * it is only ever written in English. Mapping to a key here is what lets the
 * form show the same message in Nepali without this file knowing a locale
 * exists.
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
       * Never shown to a customer — `error` is what the form renders. This is
       * carried so the dev badge can print it, because the alternative is
       * asking somebody to open DevTools and read a network response, and that
       * turned out to be several rounds of back-and-forth for a message the
       * app already had in its hand. Same reasoning as the triage badge.
       */
      detail?: string;
    };

/** Verification additionally reports whether this is a brand-new account. */
export type VerifyOutcome =
  | { ok: true; isNewUser: boolean }
  | { ok: false; error: OtpError; detail?: string };

export async function sendOtp(e164: string): Promise<OtpOutcome> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });

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
): Promise<VerifyOutcome> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: e164,
    token,
    type: "sms",
  });

  if (error) {
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
