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
  /**
   * The listing this account owns, if any.
   *
   * THE DOOR TO THE WORKING SIDE OPENS ON THIS, NOT ON THE ROLE. A role is
   * permission to reach a screen; a listing is the reason to. `admin` passes
   * `roleOpensProviderRoutes` so support can help a professional standing in
   * somebody's kitchen — but showing an admin with no listing a "My work" link
   * puts the wrong entity's door in their menu, which is exactly the blur this
   * separation exists to remove.
   */
  providerId: string | null;
  /**
   * The name on that listing, which is NOT always the name on the account.
   *
   * A provisioned or linked account can carry one name while the listing
   * carries another, and the working header said "Working as Bikas Khadka"
   * over a listing customers see as "Manoj Yadav". The name that matters on a
   * working surface is the one the customer is expecting at their door.
   */
  providerName: string | null;
};

/**
 * The signed-in user's profile, or null.
 *
 * Returns null rather than throwing when Supabase is unconfigured, so the
 * marketing pages still render on a fresh clone with no keys.
 *
 * MEMOISED PER REQUEST, and it matters more than it looks. This is an Auth API
 * call to verify the token and then two rows, and it is asked for by the site
 * header, by the page, and sometimes by a component inside the page. Every one
 * of those was paying for all of it again. React's `cache` gives one answer per
 * request and per visitor: the second and third callers get the first one's
 * result, and nobody's session can leak into anybody else's render because the
 * store is scoped to the request.
 *
 * TWO WAVES, NOT THREE. The listing lookup needs the user id, so it cannot
 * start before `getUser`, but it does not depend on the profile row — so the
 * two go together and the extra read costs nothing. A second `await` here
 * would have put a round trip on every signed-in page for one menu item.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  if (!hasSupabaseConfig()) return null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data }, { data: listing }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, preferred_language, role")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("providers")
      .select("id, display_name")
      .eq("profile_id", user.id)
      .maybeSingle(),
  ]);

  // The signup trigger creates the row, but a user who somehow predates it
  // should still get a usable header rather than a crash.
  return {
    id: user.id,
    fullName: (data?.full_name as string | null) ?? null,
    phone: (data?.phone as string | null) ?? user.phone ?? null,
    preferredLanguage:
      (data?.preferred_language as "en" | "ne" | undefined) ?? "en",
    role: (data?.role as SessionProfile["role"] | undefined) ?? "customer",
    providerId: (listing?.id as string | undefined) ?? null,
    providerName: (listing?.display_name as string | undefined) ?? null,
  };
});
