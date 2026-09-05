import "server-only";

import { cache } from "react";

import { hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type SessionProfile = {
  id: string;
  fullName: string | null;
  phone: string | null;
  preferredLanguage: "en" | "ne";
  role: "customer" | "provider" | "admin";
};

/**
 * The signed-in user's profile, or null.
 *
 * Returns null rather than throwing when Supabase is unconfigured, so the
 * marketing pages still render on a fresh clone with no keys.
 *
 * MEMOISED PER REQUEST, and it matters more than it looks. This is two network
 * calls — an Auth API call to verify the token, then a `profiles` row — and it
 * is asked for by the site header, by the page, and sometimes by a component
 * inside the page. Every one of those was paying for both calls again. React's
 * `cache` gives one answer per request and per visitor: the second and third
 * callers get the first one's result, and nobody's session can leak into
 * anybody else's render because the store is scoped to the request.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  if (!hasSupabaseConfig()) return null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, preferred_language, role")
    .eq("id", user.id)
    .maybeSingle();

  // The signup trigger creates the row, but a user who somehow predates it
  // should still get a usable header rather than a crash.
  return {
    id: user.id,
    fullName: (data?.full_name as string | null) ?? null,
    phone: (data?.phone as string | null) ?? user.phone ?? null,
    preferredLanguage:
      (data?.preferred_language as "en" | "ne" | undefined) ?? "en",
    role: (data?.role as SessionProfile["role"] | undefined) ?? "customer",
  };
});
