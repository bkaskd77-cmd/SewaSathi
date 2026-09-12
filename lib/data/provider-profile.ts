import "server-only";

import { getPriceBands } from "@/lib/ai/price-bands";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import {
  availabilityNow,
  availableUntil,
  bandForTrades,
  clampRate,
  minutesRemaining,
  type RateVerdict,
} from "@/lib/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Availability } from "@/types/supabase";

/**
 * The two things a professional may change about their own listing, and the
 * money the platform owes them.
 *
 * WRITES GO THROUGH THE SERVICE ROLE, and `providers` still has no update
 * policy. RLS is row-level: one update policy would make `is_verified`,
 * `standing`, `checks` and `removed_at` writable from a browser, which is the
 * exact class of bug `enforce_booking_immutability` exists to undo. It is
 * cheaper never to open it than to fence it off column by column, so this file
 * re-reads which listing belongs to the caller and writes the two columns it
 * is allowed to.
 *
 * THE RATE IS CLAMPED HERE AND NOWHERE ELSE ON THE SERVER. `clampRate` is
 * pure; this is the only caller that stores a result, and it stores what was
 * asked for alongside it, because a whole category pushing at a bound is our
 * mispricing rather than a list of people to be suspicious of.
 */

export type ProviderDashboard = {
  providerId: string;
  displayName: string;
  trades: string[];
  /** What the card shows right now, after the stamp has been read. */
  availability: Availability;
  /** Minutes left on "available now", for the sentence beside the switch. */
  availableFor: number | null;
  baseRate: number;
  /** The band their trades put them in. Null when no trade is recognised. */
  band: { low: number; high: number } | null;
  /** What they typed, when it differed from what we could store. */
  requestedRate: number | null;
  /** Settled jobs whose payout has not been released yet, in rupees. */
  owedRupees: number;
  /** Redo debt still outstanding. Netted forward, never chased. */
  outstandingRupees: number;
  jobsCompleted: number;
};

/** The listing linked to this profile, with everything the dashboard shows. */
export async function getProviderDashboard(
  profileId: string,
): Promise<ProviderDashboard | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const admin = createAdminClient();

    const { data: provider } = await admin
      .from("providers")
      .select(
        "id, display_name, base_rate, base_rate_requested, availability, available_until",
      )
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!provider) return null;
    const providerId = provider.id as string;

    const [{ data: trades }, { data: stats }, { data: owed }, { data: owing }] =
      await Promise.all([
        admin
          .from("provider_categories")
          .select("category_slug")
          .eq("provider_id", providerId),
        admin
          .from("provider_stats")
          .select("jobs_completed")
          .eq("provider_id", providerId)
          .maybeSingle(),
        // What is due but not yet released. `payout_due_at` is stamped at
        // settlement, so this is the professional's own arithmetic rather than
        // a promise we recompute every time the hold changes.
        admin
          .from("bookings")
          .select("provider_earning")
          .eq("provider_id", providerId)
          .eq("payment_status", "paid"),
        admin.rpc("provider_outstanding", { target: providerId }),
      ]);

    const tradeSlugs = ((trades ?? []) as { category_slug: string }[]).map(
      (row) => row.category_slug,
    );

    const bands = await getPriceBands();
    const band = bandForTrades(tradeSlugs, bands);

    const earnings = ((owed ?? []) as { provider_earning: number | null }[])
      .map((row) => Number(row.provider_earning ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);

    const requested = provider.base_rate_requested as number | null;

    return {
      providerId,
      displayName: provider.display_name as string,
      trades: tradeSlugs,
      availability: availabilityNow({
        availableUntil: provider.available_until as string | null,
        base: provider.availability as Availability,
      }),
      availableFor: minutesRemaining({
        availableUntil: provider.available_until as string | null,
      }),
      baseRate: Number(provider.base_rate ?? 0),
      band,
      requestedRate:
        requested != null && requested !== Number(provider.base_rate ?? 0)
          ? requested
          : null,
      owedRupees: earnings.reduce((total, n) => total + n, 0),
      outstandingRupees: Number(owing ?? 0),
      jobsCompleted: Number(stats?.jobs_completed ?? 0),
    };
  } catch (thrown) {
    console.error(`[provider-profile] read threw — ${describeError(thrown)}`);
    return null;
  }
}

export type RateWriteResult =
  | { ok: true; verdict: RateVerdict }
  | { ok: false; reason: string };

/**
 * Their starting price, forced into the published band.
 *
 * IT CLAMPS RATHER THAN REFUSING. A rate outside the band is usually somebody
 * pricing honestly for work we have banded badly, and refusing them teaches
 * them the product is wrong about their trade. The nearest legal figure is
 * stored, the screen says what happened, and the figure they actually typed is
 * kept so the pattern is readable per category.
 */
export async function setBaseRate(input: {
  profileId: string;
  rate: number;
}): Promise<RateWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };
  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    return { ok: false, reason: "notANumber" };
  }

  try {
    const admin = createAdminClient();

    const { data: provider } = await admin
      .from("providers")
      .select("id")
      .eq("profile_id", input.profileId)
      .maybeSingle();

    if (!provider) return { ok: false, reason: "noListing" };
    const providerId = provider.id as string;

    const { data: trades } = await admin
      .from("provider_categories")
      .select("category_slug")
      .eq("provider_id", providerId);

    const tradeSlugs = ((trades ?? []) as { category_slug: string }[]).map(
      (row) => row.category_slug,
    );

    const bands = await getPriceBands();
    const band = bandForTrades(tradeSlugs, bands);
    if (!band) return { ok: false, reason: "noTrade" };

    const verdict = clampRate({ rate: input.rate, band });

    const { error } = await admin
      .from("providers")
      .update({
        base_rate: verdict.rate,
        base_rate_requested: Math.round(input.rate),
      })
      .eq("id", providerId);

    if (error) {
      console.error(`[provider-profile] rate failed — ${describeError(error)}`);
      return { ok: false, reason: "generic" };
    }

    return { ok: true, verdict };
  } catch (thrown) {
    console.error(`[provider-profile] rate threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}

/**
 * The availability switch. On until the end of the working day.
 *
 * The stamp is computed here from `availableUntil`, never taken from the
 * caller — a professional who could name their own expiry would be back to a
 * flag that never decays, which is the thing this exists to prevent.
 */
export async function setAvailableNow(input: {
  profileId: string;
  on: boolean;
}): Promise<{ ok: boolean; until: string | null }> {
  if (!hasSupabaseConfig()) return { ok: false, until: null };

  try {
    const admin = createAdminClient();
    const until = availableUntil({ on: input.on });

    const { error } = await admin
      .from("providers")
      .update({ available_until: until ? until.toISOString() : null })
      .eq("profile_id", input.profileId);

    if (error) {
      console.error(
        `[provider-profile] availability failed — ${describeError(error)}`,
      );
      return { ok: false, until: null };
    }

    return { ok: true, until: until ? until.toISOString() : null };
  } catch (thrown) {
    console.error(
      `[provider-profile] availability threw — ${describeError(thrown)}`,
    );
    return { ok: false, until: null };
  }
}
