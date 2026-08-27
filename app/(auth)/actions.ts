"use server";

import { redirect } from "next/navigation";

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
 */
export async function signOutAction() {
  await createClient().auth.signOut();
  redirect("/");
}
