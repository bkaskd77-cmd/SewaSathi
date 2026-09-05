import "server-only";

import { cache } from "react";

import providerSeed from "@/lib/data/seed/providers.json";
import reviewSeed from "@/lib/data/seed/reviews.json";
import {
  describeError,
  markDataSource,
  rethrowFrameworkSignal,
} from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import {
  pickAlternatives,
  type Alternative,
} from "@/lib/data/recommendations";
import { createClient } from "@/lib/supabase/server";

/**
 * Providers, their stats and their reviews.
 *
 * Same arrangement as the categories: the database is the runtime source of
 * truth, and `seed/providers.json` is both what seeds it and what answers when
 * Supabase is unconfigured or unreachable. A list of professionals is the one
 * screen that must never be a stack trace.
 *
 * Stats live in their own table because Phase 9 recomputes them from finished
 * bookings with a trigger. Nothing here writes them.
 */

/**
 * AUTHORED TODAY, NOT OBSERVED. `providers.availability` is a column somebody
 * set when the listing was written; nothing moves it when a professional
 * accepts three jobs in an hour or stops opening the app. It ranks and filters
 * as though it were live, which is the one thing to remember about it.
 *
 * Phase 10 makes it real — derived from accepted-and-unfinished jobs, the
 * working-hours config and last-seen — and the column stays as the
 * professional's own declared ceiling rather than the whole answer.
 */
export type Availability = "now" | "today" | "scheduled";
export type IdDocumentStatus = "verified" | "pending" | "not_submitted";
/** What was actually checked, rather than one vague "verified" badge. */
export type VerificationCheck = "id" | "background" | "skill";

export type ProviderStats = {
  ratingAvg: number;
  ratingCount: number;
  jobsCompleted: number;
  /** Percent of accepted jobs finished. */
  completionRate: number;
  avgResponseMinutes: number;
  lastActiveMinutesAgo: number;
  /**
   * Jobs accepted, ever. The denominator a withdrawal rate needs: one
   * withdrawal in two hundred and one in three are not the same person.
   */
  jobsAccepted: number;
  /** Accepted a job and then pulled out. See `withdrawalPenalty` in ranking. */
  withdrawals: number;
};

export type Provider = {
  id: string;
  displayName: string;
  bio: string;
  photoUrl: string | null;
  categories: string[];
  serviceAreas: string[];
  yearsExperience: number;
  isVerified: boolean;
  idDocumentStatus: IdDocumentStatus;
  checks: VerificationCheck[];
  availability: Availability;
  /** Starting price for a visit, NPR. */
  baseRate: number;
  stats: ProviderStats;
};

export type Review = {
  id: string;
  providerId: string;
  author: string;
  rating: number;
  comment: string;
  daysAgo: number;
};

/** DEVELOPMENT DATA. Replaced by real provider onboarding in Phase 10. */
const SEED_PROVIDERS = providerSeed as Array<
  Omit<Provider, "photoUrl" | "stats"> & {
    photoUrl?: string | null;
    // The reliability counters are written by the database, never authored, so
    // the seed does not carry them. A fresh clone with no keys therefore reads
    // every professional as having withdrawn from nothing — which is true of a
    // product that has taken no bookings.
    stats: Omit<Provider["stats"], "jobsAccepted" | "withdrawals">;
  }
>;
const SEED_REVIEWS = reviewSeed as Review[];

export type ProviderFilters = {
  category: string;
  /** Ward key, e.g. "lalitpur-4". */
  area?: string | null;
  availability?: Availability | "any" | null;
  verifiedOnly?: boolean;
  minRating?: number | null;
  /** Starting price ceiling, NPR. */
  maxRate?: number | null;
};

function seedProviders(): Provider[] {
  return SEED_PROVIDERS.map((provider) => ({
    ...provider,
    photoUrl: provider.photoUrl ?? null,
    stats: { ...provider.stats, jobsAccepted: 0, withdrawals: 0 },
  }));
}

function matches(provider: Provider, filters: ProviderFilters): boolean {
  if (!provider.categories.includes(filters.category)) return false;
  if (filters.area && !provider.serviceAreas.includes(filters.area)) {
    return false;
  }
  if (filters.availability === "now" && provider.availability !== "now") {
    return false;
  }
  if (
    filters.availability === "today" &&
    provider.availability === "scheduled"
  ) {
    return false;
  }
  if (filters.verifiedOnly && !provider.isVerified) return false;
  if (filters.minRating && provider.stats.ratingAvg < filters.minRating) {
    return false;
  }
  if (filters.maxRate && provider.baseRate > filters.maxRate) return false;
  return true;
}

type ProviderRow = {
  id: string;
  display_name: string;
  bio: string;
  photo_url: string | null;
  years_experience: number;
  is_verified: boolean;
  id_document_status: IdDocumentStatus;
  checks: VerificationCheck[] | null;
  availability: Availability;
  base_rate: number;
  service_areas: string[] | null;
  provider_categories: Array<{ category_slug: string }> | null;
  provider_stats: {
    rating_avg: number;
    rating_count: number;
    jobs_completed: number;
    completion_rate: number;
    avg_response_minutes: number;
    last_active_at: string | null;
    jobs_accepted: number | null;
    withdrawals: number | null;
  } | null;
};

function fromRow(row: ProviderRow): Provider {
  const stats = row.provider_stats;
  const lastActive = stats?.last_active_at
    ? Math.max(
        0,
        Math.round(
          (Date.now() - new Date(stats.last_active_at).getTime()) / 60000,
        ),
      )
    : 60 * 24;

  return {
    id: row.id,
    displayName: row.display_name,
    bio: row.bio,
    photoUrl: row.photo_url,
    categories: (row.provider_categories ?? []).map((c) => c.category_slug),
    serviceAreas: row.service_areas ?? [],
    yearsExperience: row.years_experience,
    isVerified: row.is_verified,
    idDocumentStatus: row.id_document_status,
    checks: row.checks ?? [],
    availability: row.availability,
    baseRate: row.base_rate,
    stats: {
      ratingAvg: Number(stats?.rating_avg ?? 0),
      ratingCount: stats?.rating_count ?? 0,
      jobsCompleted: stats?.jobs_completed ?? 0,
      completionRate: stats?.completion_rate ?? 0,
      avgResponseMinutes: stats?.avg_response_minutes ?? 120,
      lastActiveMinutesAgo: lastActive,
      jobsAccepted: stats?.jobs_accepted ?? 0,
      withdrawals: stats?.withdrawals ?? 0,
    },
  };
}

const SELECT =
  "id, display_name, bio, photo_url, years_experience, is_verified, id_document_status, checks, availability, base_rate, service_areas, provider_categories!inner(category_slug), provider_stats(rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at, jobs_accepted, withdrawals)";

/**
 * Providers in one category, filtered but not yet ranked.
 *
 * Ranking is deliberately left to lib/data/ranking.ts in JS: the weights are a
 * product decision we expect to tune weekly, and a named constant is easier to
 * argue about than an ORDER BY. At a few dozen providers per category the cost
 * is nothing; when it stops being nothing, this is the function that changes.
 */
export const listProviders = cache(
  async (filters: ProviderFilters): Promise<Provider[]> => {
    if (!hasSupabaseConfig()) {
      markDataSource("providers", "seed", "no Supabase URL or anon key");
      return seedProviders().filter((p) => matches(p, filters));
    }

    try {
      let query = createClient()
        .from("providers")
        .select(SELECT)
        .eq("provider_categories.category_slug", filters.category)
        .eq("is_active", true);

      if (filters.area) query = query.contains("service_areas", [filters.area]);
      if (filters.verifiedOnly) query = query.eq("is_verified", true);
      if (filters.availability === "now")
        query = query.eq("availability", "now");
      if (filters.availability === "today") {
        query = query.in("availability", ["now", "today"]);
      }
      if (filters.maxRate) query = query.lte("base_rate", filters.maxRate);

      const { data, error } = await query;
      if (error || !data) {
        markDataSource(
          "providers",
          "seed",
          error ? describeError(error) : "query returned no data",
        );
        return seedProviders().filter((p) => matches(p, filters));
      }

      markDataSource("providers", "database");
      const providers = (data as unknown as ProviderRow[]).map(fromRow);
      // Rating lives in the stats table, so it is filtered here rather than in
      // the query — one fewer join condition to get wrong.
      return filters.minRating
        ? providers.filter((p) => p.stats.ratingAvg >= (filters.minRating ?? 0))
        : providers;
    } catch (thrown) {
      rethrowFrameworkSignal(thrown);
      markDataSource("providers", "seed", describeError(thrown));
      return seedProviders().filter((p) => matches(p, filters));
    }
  },
);

export const getProvider = cache(
  async (id: string): Promise<Provider | null> => {
    if (!hasSupabaseConfig()) {
      markDataSource("providers", "seed", "no Supabase URL or anon key");
      return seedProviders().find((p) => p.id === id) ?? null;
    }

    try {
      const { data, error } = await createClient()
        .from("providers")
        .select(
          SELECT.replace("provider_categories!inner", "provider_categories"),
        )
        .eq("id", id)
        .maybeSingle();

      if (error || !data) {
        markDataSource(
          "providers",
          "seed",
          error ? describeError(error) : "no row for that id",
        );
        return seedProviders().find((p) => p.id === id) ?? null;
      }

      markDataSource("providers", "database");
      return fromRow(data as unknown as ProviderRow);
    } catch (thrown) {
      rethrowFrameworkSignal(thrown);
      markDataSource("providers", "seed", describeError(thrown));
      return seedProviders().find((p) => p.id === id) ?? null;
    }
  },
);

export const getProviderReviews = cache(
  async (providerId: string): Promise<Review[]> => {
    const fallback = SEED_REVIEWS.filter(
      (review) => review.providerId === providerId,
    ).sort((a, b) => a.daysAgo - b.daysAgo);

    if (!hasSupabaseConfig()) {
      markDataSource("reviews", "seed", "no Supabase URL or anon key");
      return fallback;
    }

    try {
      const { data, error } = await createClient()
        .from("provider_reviews")
        .select("id, provider_id, author_name, rating, comment, created_at")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error || !data || data.length === 0) {
        markDataSource(
          "reviews",
          "seed",
          error ? describeError(error) : "query returned 0 rows",
        );
        return fallback;
      }

      markDataSource("reviews", "database");
      return data.map((row) => ({
        id: row.id as string,
        providerId: row.provider_id as string,
        author: row.author_name as string,
        rating: row.rating as number,
        comment: row.comment as string,
        daysAgo: Math.max(
          0,
          Math.round(
            (Date.now() - new Date(row.created_at as string).getTime()) /
              86_400_000,
          ),
        ),
      }));
    } catch (thrown) {
      rethrowFrameworkSignal(thrown);
      markDataSource("reviews", "seed", describeError(thrown));
      return fallback;
    }
  },
);

/** How many professionals each category has, for the catalogue. */
export const getCategoryCounts = cache(
  async (): Promise<Record<string, number>> => {
    const counts: Record<string, number> = {};

    if (!hasSupabaseConfig()) {
      markDataSource("providers", "seed", "no Supabase URL or anon key");
      for (const provider of seedProviders()) {
        for (const slug of provider.categories) {
          counts[slug] = (counts[slug] ?? 0) + 1;
        }
      }
      return counts;
    }

    try {
      const { data, error } = await createClient()
        .from("provider_categories")
        .select("category_slug");

      if (error) throw error;
      if (!data) throw new Error("provider_categories returned no data");

      markDataSource("providers", "database");
      for (const row of data) {
        const slug = row.category_slug as string;
        counts[slug] = (counts[slug] ?? 0) + 1;
      }
      return counts;
    } catch (thrown) {
      rethrowFrameworkSignal(thrown);
      markDataSource("providers", "seed", describeError(thrown));
      for (const provider of seedProviders()) {
        for (const slug of provider.categories) {
          counts[slug] = (counts[slug] ?? 0) + 1;
        }
      }
      return counts;
    }
  },
);

/**
 * Replacements for a job whose professional has gone.
 *
 * Deliberately reads the category WITHOUT an area filter and lets
 * `pickAlternatives` do the widening. Filtering by ward in the query would
 * make "nobody in your ward" and "nobody at all" the same empty list, and they
 * need completely different answers on screen: one is three names twenty
 * minutes away, the other is a phone number.
 */
export async function listAlternatives(input: {
  category: string;
  area?: string | null;
  urgency?: string | null;
  exclude?: readonly string[];
}): Promise<Alternative[]> {
  const providers = await listProviders({ category: input.category });
  return pickAlternatives(providers, {
    area: input.area,
    urgency: input.urgency,
    exclude: input.exclude,
  });
}
