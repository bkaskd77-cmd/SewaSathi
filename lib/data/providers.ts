import "server-only";

import { cache } from "react";

import providerSeed from "@/lib/data/seed/providers.json";
import reviewSeed from "@/lib/data/seed/reviews.json";
import {
  describeError,
  markDataSource,
  rethrowFrameworkSignal,
} from "@/lib/data/source";
import { hasRoom } from "@/lib/booking";
import { providerCapacity } from "@/lib/data/capacity";
import { hasSupabaseConfig } from "@/lib/env";
import {
  pickAlternatives,
  type Alternative,
} from "@/lib/data/recommendations";
import {
  providerState,
  servingWhen,
  type Availability,
  type BaseAvailability,
} from "@/lib/provider";
import { createPublicClient } from "@/lib/supabase/public";

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
 * OBSERVED NOW, NOT AUTHORED. It used to be a column somebody set when the
 * listing was written, and nothing moved it when a professional took three
 * jobs in an hour or stopped opening the app — it ranked and filtered as
 * though it were live when it was not.
 *
 * It is computed by `providerState` (lib/provider) from three facts, only one
 * of which we take anybody's word for: a trigger-maintained `on_job_since`,
 * and their own `busy_until` and `available_until`, both of which expire on
 * the clock. The stored column is the base underneath all three.
 *
 * Re-exported from `@/lib/provider` rather than declared here, because the
 * professional's dashboard renders the same states and a second copy of this
 * union would drift the first time one was edited.
 */
export type { Availability };

/**
 * What a customer can filter by, which is deliberately narrower.
 *
 * "Available now" is a promise that somebody can come now, so `on_job` and
 * `busy` are not offered as choices — they are answers, not questions.
 */
export type AvailabilityFilter = "now" | "today" | "scheduled";
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
  /**
   * How many replies that average is made of.
   *
   * Zero means nobody has ever timed them, which is NOT the same as being slow
   * — and the ranking scores it neutral for exactly that reason.
   */
  responseSamples: number;
  lastActiveMinutesAgo: number;
  /**
   * Jobs accepted, ever. The denominator a withdrawal rate needs: one
   * withdrawal in two hundred and one in three are not the same person.
   */
  jobsAccepted: number;
  /** Accepted a job and then pulled out. See `withdrawalRankingPenalty` — list position, never money. */
  withdrawals: number;
  /**
   * Times they offered to fit a customer in beside a job they already held.
   *
   * Small by construction — there is no standing setting and a customer cannot
   * ask — which is exactly why `hasOverbookRecord` puts a floor under the ratio
   * before it may touch ranking.
   */
  overbookOffers: number;
  /** Offers that then ran past the second customer's window. */
  overbookMisses: number;
  /**
   * Jobs where this professional was the customer's FIRST CHOICE.
   *
   * The denominator for whether they answer — the one thing the standards
   * publish as measured about availability. Only first-choice offers: an open
   * job broadcast to everybody is not an offer to anybody in particular, and
   * counting those would make a busy week look like ignoring people.
   */
  offersMade: number;
  /** Of those, the ones they accepted or declined before the hold lapsed. */
  offersAnswered: number;
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
  /**
   * Their declared window, carried alongside the state because a SLOT can fall
   * inside it. The state alone answers "can they come now"; `canServeAt` needs
   * this to answer "can they come at three".
   */
  busyUntil: string | null;
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
  /** The professional's one answer, once they have given it. */
  reply: string | null;
};

/** DEVELOPMENT DATA. Replaced by real provider onboarding in Phase 10. */
const SEED_PROVIDERS = providerSeed as Array<
  Omit<Provider, "photoUrl" | "stats"> & {
    photoUrl?: string | null;
    // The reliability counters are written by the database, never authored, so
    // the seed does not carry them. A fresh clone with no keys therefore reads
    // every professional as having withdrawn from nothing — which is true of a
    // product that has taken no bookings.
    stats: Omit<
      Provider["stats"],
      | "jobsAccepted"
      | "withdrawals"
      | "overbookOffers"
      | "overbookMisses"
      | "offersMade"
      | "offersAnswered"
    >;
  }
>;
const SEED_REVIEWS = reviewSeed as Review[];

export type ProviderFilters = {
  category: string;
  /** Ward key, e.g. "lalitpur-4". */
  area?: string | null;
  availability?: AvailabilityFilter | "any" | null;
  verifiedOnly?: boolean;
  minRating?: number | null;
  /** Starting price ceiling, NPR. */
  maxRate?: number | null;
};

function seedProviders(): Provider[] {
  return SEED_PROVIDERS.map((provider) => ({
    ...provider,
    photoUrl: provider.photoUrl ?? null,
    stats: {
      ...provider.stats,
      jobsAccepted: 0,
      withdrawals: 0,
      overbookOffers: 0,
      overbookMisses: 0,
      offersMade: 0,
      offersAnswered: 0,
    },
  }));
}

function matches(provider: Provider, filters: ProviderFilters): boolean {
  if (!provider.categories.includes(filters.category)) return false;
  if (filters.area && !provider.serviceAreas.includes(filters.area)) {
    return false;
  }
  /*
   * "Available now" means CAN COME NOW, so it admits exactly one state.
   * Somebody on a job and somebody who has declared themselves busy are both
   * honest answers to a different question, and letting either through would
   * make the filter a lie for the customer who most depends on it.
   */
  if (filters.availability === "now" && provider.availability !== "now") {
    return false;
  }
  /*
   * "Today" admits somebody currently on a job — a professional finishing at
   * 3pm genuinely can come later today, and dropping them would penalise the
   * exact behaviour the platform exists to produce. It excludes a declared
   * busy window, because they have said otherwise themselves.
   */
  if (
    filters.availability === "today" &&
    (provider.availability === "scheduled" || provider.availability === "busy")
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
  /** The stored base, not the answer. See `providerState`. */
  availability: BaseAvailability;
  /** The "available now" stamp, theirs to set and the clock's to expire. */
  available_until: string | null;
  /** Their own "not today", with an end on it. */
  busy_until: string | null;
  /** Ours, written by a trigger while a job of theirs is en route or underway. */
  on_job_since: string | null;
  base_rate: number;
  service_areas: string[] | null;
  provider_categories: Array<{ category_slug: string }> | null;
  provider_stats: {
    rating_avg: number;
    rating_count: number;
    jobs_completed: number;
    completion_rate: number;
    avg_response_minutes: number;
    response_samples: number | null;
    last_active_at: string | null;
    jobs_accepted: number | null;
    withdrawals: number | null;
    overbook_offers: number | null;
    overbook_misses: number | null;
    offers_made: number | null;
    offers_answered: number | null;
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
    /*
     * THREE FACTS, ONE ANSWER, AND THE VERIFIED ONE WINS.
     *
     * The stored column is only the base. `on_job_since` is ours and overrides
     * everything; `busy_until` and `available_until` are theirs. Computed on
     * read rather than swept by a cron, so there is no job that can stop
     * running one night and leave somebody who is on the way to a house at the
     * top of an emergency search. `providerState` is the single rule and the
     * professional's own dashboard calls it with the same row.
     */
    availability: providerState({
      onJobSince: row.on_job_since,
      busyUntil: row.busy_until,
      availableUntil: row.available_until,
      base: row.availability,
    }),
    busyUntil: row.busy_until,
    baseRate: row.base_rate,
    stats: {
      ratingAvg: Number(stats?.rating_avg ?? 0),
      ratingCount: stats?.rating_count ?? 0,
      jobsCompleted: stats?.jobs_completed ?? 0,
      completionRate: stats?.completion_rate ?? 0,
      avgResponseMinutes: stats?.avg_response_minutes ?? 120,
      responseSamples: stats?.response_samples ?? 0,
      lastActiveMinutesAgo: lastActive,
      jobsAccepted: stats?.jobs_accepted ?? 0,
      withdrawals: stats?.withdrawals ?? 0,
      overbookOffers: stats?.overbook_offers ?? 0,
      overbookMisses: stats?.overbook_misses ?? 0,
      offersMade: stats?.offers_made ?? 0,
      offersAnswered: stats?.offers_answered ?? 0,
    },
  };
}

const SELECT =
  "id, display_name, bio, photo_url, years_experience, is_verified, id_document_status, checks, availability, available_until, busy_until, on_job_since, base_rate, service_areas, provider_categories!inner(category_slug), provider_stats(rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, response_samples, last_active_at, jobs_accepted, withdrawals, overbook_offers, overbook_misses, offers_made, offers_answered)";

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
      let query = createPublicClient()
        .from("providers")
        .select(SELECT)
        .eq("provider_categories.category_slug", filters.category)
        .eq("is_active", true);

      if (filters.area) query = query.contains("service_areas", [filters.area]);
      if (filters.verifiedOnly) query = query.eq("is_verified", true);
      /*
       * THE AVAILABILITY FILTER WIDENS IN SQL AND NARROWS IN JS.
       *
       * "Available now" is two facts that live in different columns — the
       * stored base and a stamp that expires — and no index can express
       * "whichever is true at this instant". So the query asks for anything
       * that could qualify and `matches` below decides, against exactly the
       * value the card will show. Narrowing here as well would be a second
       * rule about availability, and the point of the decay is that there is
       * only one.
       */
      const now = new Date().toISOString();
      if (filters.availability === "now") {
        query = query.or(`availability.eq.now,available_until.gt.${now}`);
      }
      if (filters.availability === "today") {
        query = query.or(
          `availability.in.(now,today),available_until.gt.${now}`,
        );
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
      const providers = (data as unknown as ProviderRow[])
        .map(fromRow)
        // Availability is judged against the computed value, so a lapsed stamp
        // drops out here rather than being shown as "now". Rating lives in the
        // stats table and is filtered the same way — one fewer join condition
        // to get wrong.
        .filter((provider) =>
          matches(provider, {
            category: filters.category,
            availability: filters.availability,
            minRating: filters.minRating,
          }),
        );
      return providers;
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
      const { data, error } = await createPublicClient()
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
      const { data, error } = await createPublicClient()
        .from("provider_reviews")
        .select(
          "id, provider_id, author_name, rating, comment, created_at, reply_text, published_at",
        )
        .eq("provider_id", providerId)
        /*
         * PUBLISHED ONLY, and the RLS policy says the same thing — belt and
         * braces on the one query where getting it wrong would break the seal
         * in public. A sealed review is the author's alone until both sides are
         * in or the fortnight passes.
         */
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
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
        reply: (row.reply_text as string | null) ?? null,
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
      const { data, error } = await createPublicClient()
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
  /** The booking's slot, so an emergency is judged against now and a scheduled
   * job against the time it is actually for. */
  scheduledFor?: string | null;
}): Promise<Alternative[]> {
  const providers = await listProviders({ category: input.category });

  /*
   * Whose window is already taken, asked once for the whole list rather than
   * per candidate. Somebody who cannot be booked is not a replacement, and
   * this list is read by a customer who has already been let down once.
   */
  const capacity = await providerCapacity(
    providers.map((p) => p.id),
    input.category,
  );
  const when = servingWhen({
    urgency: input.urgency,
    scheduledFor: input.scheduledFor,
  });
  const full = new Set(
    providers
      .filter((provider) => {
        const seat = capacity[provider.id];
        if (!seat) return false;
        return !hasRoom({
          jobs: seat.held,
          scheduledFor: when,
          capacity: seat.capacity,
        });
      })
      .map((provider) => provider.id),
  );

  return pickAlternatives(providers, {
    area: input.area,
    urgency: input.urgency,
    exclude: input.exclude,
    scheduledFor: input.scheduledFor,
    full,
  });
}
