"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { recordSecurityEvent } from "@/lib/audit";
import { checkNepaliMobile, roleOpensProviderRoutes } from "@/lib/auth";
import type { OtpOutcome, VerifyOutcome } from "@/lib/auth";
import { sendOtp, verifyOtp } from "@/lib/auth/otp";
import { getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out on the server.
 *
 * Deliberately not a client-side `supabase.auth.signOut()`: the account menu
 * lives in the site header, so importing the browser Supabase client there
 * pulled ~70 KB of supabase-js into the landing page bundle — a page most
 * visitors reach logged out and which never needs the client at all.
 * A server action keeps that code on the server and clears the cookie
 * properly on the way out.
 *
 * The redirect is the locale-aware one: signing out of the Nepali site should
 * land on the Nepali homepage, not switch the reader's language for them.
 */
export async function signOutAction() {
  const locale = (await getLocale()) as Locale;

  // Read before the session is destroyed — afterwards there is nobody to
  // attribute it to, and an unattributed sign-out is not worth recording.
  const profile = await getSessionProfile();

  await createClient().auth.signOut();

  if (profile) {
    await recordSecurityEvent({
      kind: "auth.signedOut",
      actorId: profile.id,
      actorRole: profile.role,
      subjectType: "profile",
      subjectId: profile.id,
    });
  }

  redirect({ href: "/", locale });
}


/**
 * Requesting a code, from the server.
 *
 * The browser used to call Supabase directly, which meant none of our rate
 * limits ran — the top finding of the Phase 9 audit. This is the door they run
 * behind now. It deliberately does almost nothing itself: the number is
 * validated with the same function the form uses, the network is read from the
 * request rather than accepted from the caller, and every ceiling lives in
 * `sendOtp` so a future caller cannot skip them by calling it another way.
 *
 * A BAD NUMBER GETS THE SAME SHAPE AS A GOOD ONE. Nothing in the response
 * distinguishes "no such account" from "code sent", because `signInWithOtp`
 * creates the account when there is none — so this cannot be used to test
 * whether somebody is a customer of ours.
 */
export async function requestOtpAction(phone: string): Promise<OtpOutcome> {
  const check = checkNepaliMobile(phone);
  if (!check.ok) return { ok: false, error: "generic" };

  return sendOtp(check.e164, { ip: callerIp() });
}

/**
 * Submitting the code.
 *
 * This is where the session is created, and it has to happen in a server
 * action rather than a Server Component: `verifyOtp` writes the auth cookies,
 * and only an action or a route handler may. The attempt ceiling and its
 * lockout are inside `verifyOtp` for the same reason as above.
 */
export async function verifyOtpAction(
  phone: string,
  token: string,
): Promise<VerifyOutcome> {
  const check = checkNepaliMobile(phone);
  if (!check.ok) return { ok: false, error: "generic" };

  const code = token.trim();
  // Shape only. Whether it is the RIGHT code is Supabase's to answer, and
  // answering it differently here would be a second oracle.
  if (!/^\d{4,8}$/.test(code)) return { ok: false, error: "codeInvalid" };

  const outcome = await verifyOtp(check.e164, code, { ip: callerIp() });
  if (!outcome.ok) return outcome;

  /*
   * WHERE THEY LAND, when they did not say.
   *
   * The session exists by this point, so the role is read here rather than in
   * `otp.ts` — that file is the SMS adapter and a profiles query does not
   * belong in it. A professional signing in with no destination in mind wants
   * their jobs; sending them to the customer homepage made the working half of
   * the product something they had to go looking for.
   */
  let worksHere = false;
  try {
    const profile = await getSessionProfile();
    worksHere = roleOpensProviderRoutes(profile?.role ?? null);
  } catch {
    // A failed read is "not a professional". They are signed in either way,
    // and the menu carries the door.
    worksHere = false;
  }

  return { ...outcome, worksHere };
}

/**
 * The network this request came from, for the per-IP ceiling.
 *
 * Read from the request on the server. A caller-supplied value would make the
 * limit opt-in, which is the same as not having one.
 */
function callerIp(): string {
  const forwarded = headers().get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
