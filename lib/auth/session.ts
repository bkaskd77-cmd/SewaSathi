import "server-only";

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
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
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
}
