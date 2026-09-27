import "server-only";

import { describeError, rethrowFrameworkSignal } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * The preferences a customer sets about themselves.
 *
 * ONE COLUMN SO FAR. Phase 10 makes this screen editable and the name and
 * language join it; the module exists now so the write has a boundary rather
 * than sitting in a page.
 *
 * THE ACTOR IS NAMED IN THE QUERY, never left to RLS. The policy on `profiles`
 * is `using ((select auth.uid()) = id)` and it is the floor, but a read for a
 * screen that belongs to one person names that person — the rule `listBookings`
 * broke, where a later admin policy silently widened an unscoped read.
 *
 * AND THE COLUMN GRANT IS WHAT BOUNDS THE WRITE. `20260927000005` revoked
 * table-wide UPDATE from `authenticated` and granted it back on three columns,
 * because until then this write's own policy would have let the caller set
 * `role = 'admin'` on the same row. A write here can only ever touch what that
 * grant names.
 */

/**
 * Whether this customer has asked to stay off the activity strip.
 *
 * NULL IS "WE COULD NOT ASK", not "they are fine with it". The screen renders a
 * toggle it cannot honour as unavailable rather than as off — the same reason a
 * failed catalogue read is its own screen and not an empty one.
 */
export async function readActivityOptOut(
  actorId: string,
): Promise<boolean | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const { data, error } = await createClient()
      .from("profiles")
      .select("hide_from_activity")
      .eq("id", actorId)
      .maybeSingle();

    if (error) {
      console.error(`[prefs] activity opt-out read — ${describeError(error)}`);
      return null;
    }
    if (!data) return null;
    return Boolean(data.hide_from_activity);
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    console.error(`[prefs] activity opt-out read threw — ${describeError(thrown)}`);
    return null;
  }
}

/**
 * Set it, and say whether it landed.
 *
 * `hidden` is the value asked for rather than a flip, so a double submit or a
 * stale page cannot toggle somebody back into a feed they just left.
 */
export async function setActivityOptOut(
  actorId: string,
  hidden: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unconfigured" };

  try {
    const { error } = await createClient()
      .from("profiles")
      .update({ hide_from_activity: hidden })
      .eq("id", actorId);

    if (error) {
      console.error(`[prefs] activity opt-out write — ${describeError(error)}`);
      return { ok: false, reason: describeError(error) };
    }
    return { ok: true };
  } catch (thrown) {
    rethrowFrameworkSignal(thrown);
    console.error(`[prefs] activity opt-out write threw — ${describeError(thrown)}`);
    return { ok: false, reason: describeError(thrown) };
  }
}
