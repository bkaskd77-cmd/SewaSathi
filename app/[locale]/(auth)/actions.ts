"use server";

import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { recordSecurityEvent } from "@/lib/audit";
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
