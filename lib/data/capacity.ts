import "server-only";

import { capacityFor, type HeldJob } from "@/lib/booking";
import { PROBATION } from "@/lib/verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseConfig } from "@/lib/env";

/**
 * Which windows a professional's time is already spoken for.
 *
 * WHY THIS READS UNDER THE SERVICE ROLE. A customer cannot see anybody else's
 * bookings and must not be able to — so the answer to "is Krishna free at two"
 * cannot come from a query the browser makes. It comes from here, and WHAT IS
 * RETURNED IS DELIBERATELY THIN: the start of a window, and nothing else. No
 * customer, no address, no description, no reference. A prospective customer
 * learns that a window is taken, which is what any calendar tells you, and
 * learns nothing about whose job it is or where.
 *
 * `enforce_slot_capacity` in Postgres is the rule that actually holds. This is
 * so a full row can be greyed out before somebody taps it, rather than letting
 * them fill in four screens and meet a refusal at the end.
 *
 * EACH WINDOW CARRIES ITS OWN LENGTH NOW. It used to return a bare start and
 * every job was assumed to be two hours, so a four-hour deep clean and a
 * forty-five-minute leak reserved the same block and a customer could be given
 * a slot inside a job already running. Still deliberately thin: a start and a
 * duration, never whose job it is or where.
 */

/** Statuses that still hold somebody's time — the same set the trigger uses. */
const HOLDS_TIME = ["pending", "accepted", "en_route", "in_progress"];

export type ProviderCapacity = {
  /** The windows already taken, as the flow's own `HeldJob` shape. */
  held: HeldJob[];
  /** How many they may hold at once, probation and any override applied. */
  capacity: number;
};

type Row = {
  provider_id: string | null;
  scheduled_for: string | null;
  created_at: string;
  status: string;
  estimated_working_minutes: number | null;
  provider_estimated_working_minutes: number | null;
};

/**
 * Held windows and a capacity for each of these listings.
 *
 * Returns an empty map rather than throwing when Supabase is unconfigured: a
 * fresh clone with no keys renders the whole product from the seed, and a
 * booking flow that refused to show anybody would be a worse failure than one
 * that cannot grey a row.
 */
export async function providerCapacity(
  providerIds: string[],
  categorySlug: string,
): Promise<Record<string, ProviderCapacity>> {
  const empty: Record<string, ProviderCapacity> = {};
  if (providerIds.length === 0 || !hasSupabaseConfig()) return empty;

  const supabase = createAdminClient();

  const [jobs, listings, category] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "provider_id, scheduled_for, created_at, status, estimated_working_minutes, provider_estimated_working_minutes",
      )
      .in("provider_id", providerIds)
      .in("status", HOLDS_TIME),
    supabase
      .from("providers")
      .select("id, max_concurrent_jobs, standing")
      .in("id", providerIds),
    supabase
      .from("categories")
      .select("max_concurrent_jobs")
      .eq("slug", categorySlug)
      .maybeSingle(),
  ]);

  /*
   * A read that failed must not read as "everybody is free". The trigger still
   * refuses the booking, so the cost of returning nothing is a row that looks
   * bookable and is not — annoying. The cost of the opposite, inventing a
   * capacity, is a customer told somebody is busy who is not.
   */
  if (jobs.error || listings.error) return empty;

  /*
   * Falls back to 1, the tightest useful number, rather than to the column
   * default. An unreadable category should refuse a second booking, not wave
   * it through; the trigger would refuse it anyway and the screen would have
   * promised otherwise.
   */
  const categoryLimit = category.data?.max_concurrent_jobs ?? 1;

  const held = new Map<string, HeldJob[]>();
  for (const row of (jobs.data ?? []) as Row[]) {
    if (!row.provider_id) continue;
    const list = held.get(row.provider_id) ?? [];
    list.push({
      // An as-soon-as-possible job starts when it was made, which is the same
      // reading the trigger takes.
      scheduledFor: row.scheduled_for ?? row.created_at,
      status: row.status,
      /*
       * HOW LONG THIS ONE ACTUALLY HOLDS. The professional's own figure first
       * — they have seen the job — then ours from the sub-band, then null,
       * which the rule reads as the two-hour hold every booking took before
       * durations existed. `workingMinutes` in lib/booking is the same
       * precedence and the SQL mirror of it is `booking_working_minutes`.
       */
      workingMinutes:
        row.provider_estimated_working_minutes ??
        row.estimated_working_minutes ??
        null,
    });
    held.set(row.provider_id, list);
  }

  const out: Record<string, ProviderCapacity> = {};
  for (const listing of listings.data ?? []) {
    out[listing.id] = {
      held: held.get(listing.id) ?? [],
      capacity: capacityFor({
        categoryLimit,
        providerLimit: listing.max_concurrent_jobs,
        // Probation caps whatever an admin set. A new listing has not shown it
        // can hold two jobs, let alone a firm's three.
        probationLimit:
          listing.standing === "provisional"
            ? PROBATION.maxConcurrentJobs
            : null,
      }),
    };
  }
  return out;
}
