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

export type OtpOutcome =
  { ok: true } | { ok: false; message: string; retryAfterSeconds?: number };

/** Verification additionally reports whether this is a brand-new account. */
export type VerifyOutcome =
  { ok: true; isNewUser: boolean } | { ok: false; message: string };

export async function sendOtp(e164: string): Promise<OtpOutcome> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });

  if (!error) return { ok: true };

  // Supabase surfaces its rate limit as a 429 with the wait time in the text.
  if (error.status === 429) {
    const seconds = Number(error.message.match(/(\d+)\s*second/)?.[1]);
    return {
      ok: false,
      message: "Too many requests. Wait a moment before trying again.",
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : 60,
    };
  }

  return { ok: false, message: friendlyError(error.message) };
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
    return { ok: false, message: friendlyError(error.message) };
  }

  const user = data.user;
  if (!user) {
    return {
      ok: false,
      message: "That didn't work. Please request a new code.",
    };
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
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("expired")) {
    return "That code has expired. Request a new one.";
  }
  if (m.includes("invalid") || m.includes("token")) {
    return "That code isn't right. Check it and try again.";
  }
  if (m.includes("sms") || m.includes("provider") || m.includes("send")) {
    return "We couldn't send the code just now. Try again in a moment.";
  }
  return "Something went wrong. Please try again.";
}
