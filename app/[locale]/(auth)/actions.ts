"use server";

import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
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
  await createClient().auth.signOut();
  redirect({ href: "/", locale });
}
